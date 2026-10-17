// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/// @title TabEscrow
/// @notice Ownerless USDC escrow for two primitives: buyer/seller **Deals** and two-party **Bets**
///         (Chainlink-settled price bets and mutually-reported event bets).
/// @dev Design invariants:
///      - No owner, admin, pause, upgrade, sweep or fee. Every parameter is fixed at construction.
///      - `token.balanceOf(this) == Σ locked amounts` at all times (funds only enter via create/join and
///        only leave via terminal transitions, each of which zeroes the object's claim by changing state).
///      - Every lock has an exit that needs no counterparty cooperation (see the liveness notes per function).
///      - Checks-effects-interactions on every path, plus `nonReentrant` as defence in depth.
contract TabEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────── Types ───────────────────────────────────────────────

    /// @notice Lifecycle of a deal. `Released`, `Refunded` and `Resolved` are terminal.
    enum DealState {
        None,
        Funded,
        Delivered,
        Released,
        Refunded,
        Disputed,
        Resolved
    }

    /// @notice A buyer-funded escrow released to the seller on delivery.
    struct Deal {
        address buyer;
        address seller;
        /// @dev address(0) means no arbiter: disputes are disabled.
        address arbiter;
        /// @dev USDC atomic units (6 decimals).
        uint128 amount;
        /// @dev Seller must mark delivered strictly before this timestamp.
        uint64 deliverBy;
        /// @dev Seconds after delivery the buyer has to release or dispute before the seller may claim.
        uint64 reviewWindow;
        uint64 deliveredAt;
        DealState state;
        bytes32 termsHash;
        /// @dev When the deal entered Disputed (0 otherwise); starts the arbiter timeout.
        uint64 disputedAt;
    }

    /// @notice How a bet is resolved.
    enum BetKind {
        Price,
        Mutual
    }

    /// @notice Lifecycle of a bet. `Settled` and `Refunded` are terminal.
    enum BetState {
        None,
        Open,
        Matched,
        Settled,
        Refunded
    }

    /// @notice A symmetric two-party wager; each side locks `stake`, the winner receives `2 × stake`.
    struct Bet {
        address creator;
        /// @dev address(0) while open means anyone may join; set to the joiner on `joinBy`.
        address opponent;
        /// @dev Mutual bets only, optional (address(0) = none).
        address arbiter;
        uint128 stake;
        uint64 joinBy;
        uint64 resolveAt;
        BetKind kind;
        BetState state;
        /// @dev Price bets only: an allowlisted Chainlink feed.
        address feed;
        /// @dev Price bets only: in the feed's decimals.
        int256 threshold;
        /// @dev Price bets only: creator wins if price ≥ threshold when true, if price < threshold when false.
        bool creatorAbove;
        /// @dev Mutual bets only: the winner each party reported (address(0) = not reported yet).
        address creatorReport;
        address opponentReport;
        bytes32 termsHash;
    }

    // ───────────────────────────────────────────── Constants ─────────────────────────────────────────────

    /// @notice Basis-point denominator for `resolve`.
    uint16 public constant BPS = 10_000;
    /// @notice Bounds on a deal's review window.
    uint64 public constant MIN_REVIEW_WINDOW = 1 minutes;
    uint64 public constant MAX_REVIEW_WINDOW = 30 days;
    /// @notice After `disputedAt + DISPUTE_TIMEOUT` a disputed deal can be refunded to the buyer,
    ///         so an unresponsive arbiter cannot lock funds forever.
    uint256 public constant DISPUTE_TIMEOUT = 30 days;
    /// @notice Minimum gap between `joinBy` and `resolveAt`, so a late joiner cannot take a near-free option on a
    ///         price that is already (almost) known.
    uint256 public constant MIN_JOIN_GAP = 10 minutes;
    /// @notice After the L2 sequencer comes back up, prices are not trusted for this long (Chainlink guidance),
    ///         because feeds may not yet reflect the market and only L1-forced transactions could act on them.
    uint256 public constant SEQUENCER_GRACE_PERIOD = 1 hours;
    /// @notice A matched price bet that could not be settled by `resolveAt + PRICE_REFUND_DELAY` refunds both.
    uint256 public constant PRICE_REFUND_DELAY = 3 days;
    /// @notice A matched mutual bet still unresolved at `resolveAt + MUTUAL_REFUND_DELAY` refunds both.
    uint256 public constant MUTUAL_REFUND_DELAY = 7 days;
    /// @notice With fewer than two reports, the arbiter may rule only from `resolveAt + ARBITRATION_GRACE`,
    ///         giving both parties time to report first (and to agree, which needs no arbiter).
    uint256 public constant ARBITRATION_GRACE = 2 days;

    // ─────────────────────────────────────────── Immutable config ─────────────────────────────────────────

    /// @notice The only token this escrow holds (USDC). Fixed so fee-on-transfer/rebasing tokens cannot break accounting.
    IERC20 public immutable token;
    /// @notice Chainlink L2 sequencer uptime feed (answer 0 = up, 1 = down).
    AggregatorV3Interface public immutable sequencerUptimeFeed;

    /// @notice Max age in seconds of a price answer, per allowlisted feed. Zero means the feed is not allowed.
    mapping(address feed => uint32) public maxStaleness;

    // ─────────────────────────────────────────────── State ───────────────────────────────────────────────

    /// @notice Id the next created deal will receive. Ids start at 1 so 0 is never a valid id.
    uint256 public nextDealId = 1;
    /// @notice Id the next created bet will receive. Ids start at 1 so 0 is never a valid id.
    uint256 public nextBetId = 1;

    /// @notice USDC credited to an account whose direct payout failed (e.g. a blacklisted or reverting recipient).
    ///         Claimable with `withdraw`.
    mapping(address account => uint256) public owed;

    mapping(uint256 id => Deal) private _deals;
    mapping(uint256 id => Bet) private _bets;

    // ─────────────────────────────────────────────── Events ──────────────────────────────────────────────

    event DealCreated(
        uint256 indexed id,
        address indexed buyer,
        address indexed seller,
        address arbiter,
        uint128 amount,
        uint64 deliverBy,
        uint64 reviewWindow,
        bytes32 termsHash
    );
    event DealDelivered(uint256 indexed id, uint64 deliveredAt);
    event DealReleased(uint256 indexed id, uint128 amount);
    event DealClaimed(uint256 indexed id, uint128 amount);
    /// @param byDeadline true when refunded after a missed deadline/dispute timeout, false when the seller cancelled.
    event DealRefunded(uint256 indexed id, uint128 amount, bool byDeadline);
    event DealDisputed(uint256 indexed id, address indexed by);
    event DealResolved(uint256 indexed id, uint128 sellerAmount, uint128 buyerAmount);

    event BetCreated(
        uint256 indexed id,
        BetKind kind,
        address indexed creator,
        address indexed opponent,
        address arbiter,
        uint128 stake,
        uint64 joinBy,
        uint64 resolveAt,
        bytes32 termsHash
    );
    /// @notice Emitted alongside `BetCreated` for price bets (split out to keep each event's stack shallow).
    event PriceBetTerms(uint256 indexed id, address indexed feed, int256 threshold, bool creatorAbove);
    event BetJoined(uint256 indexed id, address indexed opponent);
    event BetCancelled(uint256 indexed id);
    event BetReported(uint256 indexed id, address indexed reporter, address winner);
    /// @param price the Chainlink answer used for price bets; 0 for mutual bets.
    /// @param roundId the Chainlink round that settled a price bet; 0 for mutual bets.
    event BetSettled(uint256 indexed id, address indexed winner, uint256 payout, int256 price, uint80 roundId);
    event BetRefunded(uint256 indexed id);
    /// @notice A direct payout failed and `amount` was credited to `to` in `owed` instead.
    event PayoutDeferred(address indexed to, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    // ─────────────────────────────────────────────── Errors ──────────────────────────────────────────────

    error ZeroAddress();
    error LengthMismatch();
    error DuplicateFeed(address feed);
    error InvalidStaleness();
    error InvalidAmount();
    error InvalidCounterparty();
    error InvalidArbiter();
    error InvalidDeadline();
    error InvalidReviewWindow();
    error InvalidState();
    error InvalidBps();
    error InvalidThreshold();
    error InvalidWinner();
    error NotBuyer();
    error NotSeller();
    error NotParty();
    error NotArbiter();
    error NotCreator();
    error NotInvited();
    error NoArbiter();
    error TooEarly();
    error TooLate();
    error JoinClosed();
    error WrongKind();
    error FeedNotAllowed();
    error SequencerDown();
    error InvalidPrice();
    error StalePrice();
    error PriceNotFinal();
    error RoundNotProvable();
    error NotFirstRound();
    error NothingOwed();
    error ArbitrationNotAllowed();

    // ───────────────────────────────────────────── Constructor ───────────────────────────────────────────

    /// @param usdc The escrowed token (USDC on Base).
    /// @param sequencerFeed Chainlink L2 sequencer uptime feed.
    /// @param feeds Allowlisted Chainlink price feeds for price bets.
    /// @param staleness Per-feed max answer age in seconds, same order as `feeds`.
    constructor(IERC20 usdc, address sequencerFeed, address[] memory feeds, uint32[] memory staleness) {
        if (address(usdc) == address(0) || sequencerFeed == address(0)) revert ZeroAddress();
        if (feeds.length != staleness.length) revert LengthMismatch();
        token = usdc;
        sequencerUptimeFeed = AggregatorV3Interface(sequencerFeed);
        for (uint256 i; i < feeds.length; ++i) {
            if (feeds[i] == address(0)) revert ZeroAddress();
            if (staleness[i] == 0) revert InvalidStaleness();
            if (maxStaleness[feeds[i]] != 0) revert DuplicateFeed(feeds[i]);
            maxStaleness[feeds[i]] = staleness[i];
        }
    }

    // ──────────────────────────────────────────────── Deals ──────────────────────────────────────────────

    /// @notice Lock `amount` USDC from the caller (buyer) for `seller`.
    /// @dev Requires a prior exact `approve(escrow, amount)`.
    /// @param seller Recipient on success; must differ from the buyer and be non-zero.
    /// @param amount USDC atomic units, > 0.
    /// @param deliverBy Timestamp (strictly in the future) before which the seller must mark delivered.
    /// @param reviewWindow Seconds in [MIN_REVIEW_WINDOW, MAX_REVIEW_WINDOW] the buyer has to review a delivery.
    /// @param arbiter Optional dispute resolver (address(0) disables disputes); must not be buyer or seller.
    /// @param termsHash Hash of the off-chain terms, for integrity only.
    /// @return id The new deal id.
    function createDeal(
        address seller,
        uint128 amount,
        uint64 deliverBy,
        uint64 reviewWindow,
        address arbiter,
        bytes32 termsHash
    ) external nonReentrant returns (uint256 id) {
        if (seller == address(0) || seller == msg.sender) revert InvalidCounterparty();
        if (amount == 0) revert InvalidAmount();
        if (deliverBy <= block.timestamp) revert InvalidDeadline();
        if (reviewWindow < MIN_REVIEW_WINDOW || reviewWindow > MAX_REVIEW_WINDOW) revert InvalidReviewWindow();
        if (arbiter == msg.sender || arbiter == seller) revert InvalidArbiter();

        id = nextDealId++;
        _deals[id] = Deal({
            buyer: msg.sender,
            seller: seller,
            arbiter: arbiter,
            amount: amount,
            deliverBy: deliverBy,
            reviewWindow: reviewWindow,
            deliveredAt: 0,
            state: DealState.Funded,
            termsHash: termsHash,
            disputedAt: 0
        });
        emit DealCreated(id, msg.sender, seller, arbiter, amount, deliverBy, reviewWindow, termsHash);

        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Seller signals delivery, starting the buyer's review window.
    /// @dev Only while Funded and strictly before `deliverBy`.
    function markDelivered(uint256 id) external nonReentrant {
        Deal storage d = _deals[id];
        if (msg.sender != d.seller) revert NotSeller();
        if (d.state != DealState.Funded) revert InvalidState();
        if (block.timestamp >= d.deliverBy) revert TooLate();

        // forge-lint: disable-next-line(unsafe-typecast) timestamps fit in uint64 for ~584 billion years
        d.deliveredAt = uint64(block.timestamp);
        d.state = DealState.Delivered;
        emit DealDelivered(id, d.deliveredAt);
    }

    /// @notice Buyer releases the full amount to the seller (Funded or Delivered).
    function release(uint256 id) external nonReentrant {
        Deal storage d = _deals[id];
        if (msg.sender != d.buyer) revert NotBuyer();
        if (d.state != DealState.Funded && d.state != DealState.Delivered) revert InvalidState();

        d.state = DealState.Released;
        emit DealReleased(id, d.amount);

        _payout(d.seller, d.amount);
    }

    /// @notice Seller claims after the review window elapsed without release or dispute.
    /// @dev Liveness for the seller: no buyer cooperation needed once delivered.
    function claim(uint256 id) external nonReentrant {
        Deal storage d = _deals[id];
        if (msg.sender != d.seller) revert NotSeller();
        if (d.state != DealState.Delivered) revert InvalidState();
        if (block.timestamp < uint256(d.deliveredAt) + d.reviewWindow) revert TooEarly();

        d.state = DealState.Released;
        emit DealClaimed(id, d.amount);

        _payout(d.seller, d.amount);
    }

    /// @notice Return the funds to the buyer.
    /// @dev Two liveness exits:
    ///      - Funded (never delivered) and `now ≥ deliverBy`: buyer only.
    ///      - Disputed and `now ≥ disputedAt + DISPUTE_TIMEOUT` (arbiter unresponsive): buyer or seller.
    function refund(uint256 id) external nonReentrant {
        Deal storage d = _deals[id];
        if (d.state == DealState.Funded) {
            if (msg.sender != d.buyer) revert NotBuyer();
            if (block.timestamp < d.deliverBy) revert TooEarly();
        } else if (d.state == DealState.Disputed) {
            if (msg.sender != d.buyer && msg.sender != d.seller) revert NotParty();
            if (block.timestamp < uint256(d.disputedAt) + DISPUTE_TIMEOUT) revert TooEarly();
        } else {
            revert InvalidState();
        }

        d.state = DealState.Refunded;
        emit DealRefunded(id, d.amount, true);

        _payout(d.buyer, d.amount);
    }

    /// @notice Seller declines a funded (not yet delivered) deal; the buyer is refunded in full.
    function cancelBySeller(uint256 id) external nonReentrant {
        Deal storage d = _deals[id];
        if (msg.sender != d.seller) revert NotSeller();
        if (d.state != DealState.Funded) revert InvalidState();

        d.state = DealState.Refunded;
        emit DealRefunded(id, d.amount, false);

        _payout(d.buyer, d.amount);
    }

    /// @notice Either party escalates to the arbiter. Freezes release/claim/refund until resolved or timed out.
    /// @dev Only while the outcome is still open: Funded before `deliverBy`, or Delivered within the review window.
    ///      Once those windows close the counterparty's exit (`refund` / `claim`) is already due and cannot be
    ///      blocked by a late dispute.
    function dispute(uint256 id) external nonReentrant {
        Deal storage d = _deals[id];
        if (msg.sender != d.buyer && msg.sender != d.seller) revert NotParty();
        if (d.arbiter == address(0)) revert NoArbiter();
        if (d.state == DealState.Funded) {
            if (block.timestamp >= d.deliverBy) revert TooLate();
        } else if (d.state == DealState.Delivered) {
            if (block.timestamp >= uint256(d.deliveredAt) + d.reviewWindow) revert TooLate();
        } else {
            revert InvalidState();
        }

        d.state = DealState.Disputed;
        // forge-lint: disable-next-line(unsafe-typecast) timestamps fit in uint64 for ~584 billion years
        d.disputedAt = uint64(block.timestamp);
        emit DealDisputed(id, msg.sender);
    }

    /// @notice Arbiter splits a disputed deal: `sellerBps / 10000` to the seller, the rest to the buyer.
    /// @dev Rounding favours the buyer (seller share rounds down).
    function resolve(uint256 id, uint16 sellerBps) external nonReentrant {
        Deal storage d = _deals[id];
        if (d.arbiter == address(0) || msg.sender != d.arbiter) revert NotArbiter();
        if (d.state != DealState.Disputed) revert InvalidState();
        if (sellerBps > BPS) revert InvalidBps();

        // forge-lint: disable-next-line(unsafe-typecast) bounded by d.amount (uint128) since sellerBps <= BPS
        uint128 sellerAmount = uint128((uint256(d.amount) * sellerBps) / BPS);
        uint128 buyerAmount = d.amount - sellerAmount;
        d.state = DealState.Resolved;
        emit DealResolved(id, sellerAmount, buyerAmount);

        if (sellerAmount != 0) _payout(d.seller, sellerAmount);
        if (buyerAmount != 0) _payout(d.buyer, buyerAmount);
    }

    // ──────────────────────────────────────────────── Bets ───────────────────────────────────────────────

    /// @notice Open a bet on a Chainlink price at `resolveAt`, locking `stake` from the caller.
    /// @param opponent Invited opponent, or address(0) for anyone.
    /// @param stake Per-side stake in USDC atomic units, > 0.
    /// @param joinBy Opponent must join strictly before this (future) timestamp.
    /// @param resolveAt Earliest settlement time; must be ≥ joinBy.
    /// @param feed Allowlisted Chainlink feed.
    /// @param threshold Price in feed decimals, > 0.
    /// @param creatorAbove Creator wins on price ≥ threshold if true (ties go to "above"), on price < threshold if false.
    /// @param termsHash Hash of the off-chain terms.
    /// @return id The new bet id.
    function createPriceBet(
        address opponent,
        uint128 stake,
        uint64 joinBy,
        uint64 resolveAt,
        address feed,
        int256 threshold,
        bool creatorAbove,
        bytes32 termsHash
    ) external nonReentrant returns (uint256 id) {
        if (maxStaleness[feed] == 0) revert FeedNotAllowed();
        if (threshold <= 0) revert InvalidThreshold();
        id = _openBet(BetKind.Price, opponent, address(0), stake, joinBy, resolveAt, termsHash);

        Bet storage b = _bets[id];
        b.feed = feed;
        b.threshold = threshold;
        b.creatorAbove = creatorAbove;
        emit PriceBetTerms(id, feed, threshold, creatorAbove);

        token.safeTransferFrom(msg.sender, address(this), stake);
    }

    /// @notice Open a bet on a real-world event, resolved by matching reports (or the optional arbiter).
    /// @param arbiter Optional tie-breaker; must not be the creator or the invited opponent.
    function createMutualBet(
        address opponent,
        uint128 stake,
        uint64 joinBy,
        uint64 resolveAt,
        address arbiter,
        bytes32 termsHash
    ) external nonReentrant returns (uint256 id) {
        if (arbiter != address(0) && (arbiter == msg.sender || arbiter == opponent)) {
            revert InvalidArbiter();
        }
        id = _openBet(BetKind.Mutual, opponent, arbiter, stake, joinBy, resolveAt, termsHash);

        token.safeTransferFrom(msg.sender, address(this), stake);
    }

    /// @notice Match an open bet by locking the same stake.
    /// @dev Caller must be the invited opponent (or anyone if open), not the creator nor the arbiter.
    function joinBet(uint256 id) external nonReentrant {
        Bet storage b = _bets[id];
        if (b.state != BetState.Open) revert InvalidState();
        if (block.timestamp >= b.joinBy) revert JoinClosed();
        if (msg.sender == b.creator || msg.sender == b.arbiter) revert InvalidCounterparty();
        if (b.opponent != address(0) && msg.sender != b.opponent) revert NotInvited();

        b.opponent = msg.sender;
        b.state = BetState.Matched;
        emit BetJoined(id, msg.sender);

        token.safeTransferFrom(msg.sender, address(this), b.stake);
    }

    /// @notice Creator withdraws an unmatched bet at any time (liveness exit when nobody joins).
    function cancelUnjoined(uint256 id) external nonReentrant {
        Bet storage b = _bets[id];
        if (msg.sender != b.creator) revert NotCreator();
        if (b.state != BetState.Open) revert InvalidState();

        b.state = BetState.Refunded;
        emit BetCancelled(id);

        _payout(b.creator, b.stake);
    }

    /// @notice Settle a matched price bet at the **first** feed round published at or after `resolveAt`.
    ///         Callable by anyone; the caller supplies the round id and the contract proves it is the first.
    /// @dev Proof: round `roundId` has `updatedAt ≥ resolveAt` and its predecessor `roundId − 1` (same Chainlink
    ///      phase, non-zero `updatedAt`) has `updatedAt < resolveAt`. The outcome is therefore fixed by the oracle
    ///      history, not by when someone calls. Off-chain, `shared/findSettlementRound.ts` locates the round.
    ///      Reverts (retry later) while the sequencer is down/in grace or no round exists yet past `resolveAt`;
    ///      `refundStale` is the fallback once `resolveAt + PRICE_REFUND_DELAY` passes.
    /// @param roundId The proxy round id (phaseId << 64 | aggregatorRoundId) of the first round at/after `resolveAt`.
    function settlePrice(uint256 id, uint80 roundId) external nonReentrant {
        Bet storage b = _bets[id];
        if (b.kind != BetKind.Price) revert WrongKind();
        if (b.state != BetState.Matched) revert InvalidState();
        if (block.timestamp < b.resolveAt) revert TooEarly();

        int256 price = _readSettlementPrice(b.feed, b.resolveAt, roundId);
        address winner = (b.creatorAbove ? price >= b.threshold : price < b.threshold) ? b.creator : b.opponent;
        _payWinner(id, b, winner, price, roundId);
    }

    /// @notice Creator or opponent reports the winner of a matched mutual bet. Matching reports pay out at once.
    /// @dev A report may be changed until the bet is final, so a party can concede after a conflict.
    ///      A lone report never auto-wins: silence leads to arbitration or a refund, not a forfeit.
    function report(uint256 id, address winner) external nonReentrant {
        Bet storage b = _bets[id];
        if (b.kind != BetKind.Mutual) revert WrongKind();
        if (b.state != BetState.Matched) revert InvalidState();
        if (block.timestamp < b.resolveAt) revert TooEarly();
        if (winner != b.creator && winner != b.opponent) revert InvalidWinner();

        if (msg.sender == b.creator) {
            b.creatorReport = winner;
        } else if (msg.sender == b.opponent) {
            b.opponentReport = winner;
        } else {
            revert NotParty();
        }
        emit BetReported(id, msg.sender, winner);

        if (b.creatorReport == b.opponentReport) _payWinner(id, b, winner, 0, 0);
    }

    /// @notice Arbiter decides a matched mutual bet when reports conflict, or when a report is still missing
    ///         at `resolveAt + ARBITRATION_GRACE`.
    function arbitrate(uint256 id, address winner) external nonReentrant {
        Bet storage b = _bets[id];
        if (b.kind != BetKind.Mutual) revert WrongKind();
        if (b.arbiter == address(0) || msg.sender != b.arbiter) revert NotArbiter();
        if (b.state != BetState.Matched) revert InvalidState();
        if (winner != b.creator && winner != b.opponent) revert InvalidWinner();

        bool conflict = b.creatorReport != address(0) && b.opponentReport != address(0);
        if (!conflict && block.timestamp < uint256(b.resolveAt) + ARBITRATION_GRACE) {
            revert ArbitrationNotAllowed();
        }

        _payWinner(id, b, winner, 0, 0);
    }

    /// @notice Refund both stakes of a matched bet that could not be resolved in time. Callable by anyone.
    /// @dev Price: from `resolveAt + PRICE_REFUND_DELAY`. Mutual: from `resolveAt + MUTUAL_REFUND_DELAY`.
    function refundStale(uint256 id) external nonReentrant {
        Bet storage b = _bets[id];
        if (b.state != BetState.Matched) revert InvalidState();
        uint256 delay = b.kind == BetKind.Price ? PRICE_REFUND_DELAY : MUTUAL_REFUND_DELAY;
        if (block.timestamp < uint256(b.resolveAt) + delay) revert TooEarly();

        b.state = BetState.Refunded;
        emit BetRefunded(id);

        _payout(b.creator, b.stake);
        _payout(b.opponent, b.stake);
    }

    // ────────────────────────────────────────────── Payouts ──────────────────────────────────────────────

    /// @notice Claim USDC credited to the caller after a failed direct payout.
    function withdraw() external nonReentrant {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert NothingOwed();

        owed[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);

        token.safeTransfer(msg.sender, amount);
    }

    // ──────────────────────────────────────────────── Views ──────────────────────────────────────────────

    /// @notice Full deal record (all-zero with state None for unknown ids).
    function getDeal(uint256 id) external view returns (Deal memory) {
        return _deals[id];
    }

    /// @notice Full bet record (all-zero with state None for unknown ids).
    function getBet(uint256 id) external view returns (Bet memory) {
        return _bets[id];
    }

    // ────────────────────────────────────────────── Internals ────────────────────────────────────────────

    function _openBet(
        BetKind kind,
        address opponent,
        address arbiter,
        uint128 stake,
        uint64 joinBy,
        uint64 resolveAt,
        bytes32 termsHash
    ) private returns (uint256 id) {
        if (opponent == msg.sender) revert InvalidCounterparty();
        if (stake == 0) revert InvalidAmount();
        if (joinBy <= block.timestamp || resolveAt < uint256(joinBy) + MIN_JOIN_GAP) revert InvalidDeadline();

        id = nextBetId++;
        Bet storage b = _bets[id];
        b.creator = msg.sender;
        b.opponent = opponent;
        b.arbiter = arbiter;
        b.stake = stake;
        b.joinBy = joinBy;
        b.resolveAt = resolveAt;
        b.kind = kind;
        b.state = BetState.Open;
        b.termsHash = termsHash;
        emit BetCreated(id, kind, msg.sender, opponent, arbiter, stake, joinBy, resolveAt, termsHash);
    }

    /// @dev Validates sequencer liveness, then proves `roundId` is the first round of `feed` at/after `resolveAt`
    ///      and that it landed within `maxStaleness` of `resolveAt` (so it genuinely represents that moment).
    function _readSettlementPrice(address feed, uint64 resolveAt, uint80 roundId) private view returns (int256) {
        (, int256 status, uint256 startedAt,,) = sequencerUptimeFeed.latestRoundData();
        // startedAt == 0 marks an uninitialised round on some L2 uptime feeds; treat as not up.
        if (status != 0 || startedAt == 0 || block.timestamp - startedAt <= SEQUENCER_GRACE_PERIOD) {
            revert SequencerDown();
        }

        (int256 answer, uint256 updatedAt) = _roundData(feed, roundId);
        if (answer <= 0 || updatedAt > block.timestamp) revert InvalidPrice();
        if (updatedAt < resolveAt) revert PriceNotFinal();

        // Only rounds of the proxy's current aggregator count: a superseded phase may be stale or deprecated.
        // forge-lint: disable-next-line(unsafe-typecast) intentional: bits 64..79 are the proxy phase id
        if (uint16(roundId >> 64) != _phaseId(feed)) revert RoundNotProvable();
        // The first round of a phase has no provable predecessor (ids are not contiguous across phases).
        // forge-lint: disable-next-line(unsafe-typecast) intentional: the low 64 bits are the aggregator round id
        if (uint64(roundId) <= 1) revert RoundNotProvable();
        (, uint256 prevUpdatedAt) = _roundData(feed, roundId - 1);
        if (prevUpdatedAt >= resolveAt) revert NotFirstRound();

        // Proven first round, but published too long after resolveAt to stand for it: final, never settleable.
        if (updatedAt - resolveAt > maxStaleness[feed]) revert StalePrice();
        return answer;
    }

    function _phaseId(address feed) private view returns (uint16) {
        try AggregatorV3Interface(feed).phaseId() returns (uint16 phase) {
            return phase;
        } catch {
            revert RoundNotProvable();
        }
    }

    /// @dev Reads a historical round; a missing round (revert or zero `updatedAt`) is unprovable, not fatal.
    function _roundData(address feed, uint80 roundId) private view returns (int256 answer, uint256 updatedAt) {
        try AggregatorV3Interface(feed).getRoundData(roundId) returns (uint80, int256 a, uint256, uint256 u, uint80) {
            (answer, updatedAt) = (a, u);
        } catch {
            revert RoundNotProvable();
        }
        if (updatedAt == 0) revert RoundNotProvable();
    }

    /// @dev Pays directly so the happy path stays one transaction; if the transfer fails (blacklisted or otherwise
    ///      rejecting recipient) the amount is credited to `owed` so one bad recipient can never block a
    ///      counterparty's payout or a state transition. State is already final when this runs (CEI).
    function _payout(address to, uint256 amount) private {
        // forge-lint: disable-next-line(reentrancy-no-eth) every caller is nonReentrant and already in a final state
        (bool ok, bytes memory ret) = address(token).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (ok && ret.length == 32 && abi.decode(ret, (bool))) return;
        owed[to] += amount;
        // forge-lint: disable-next-line(reentrancy-events) the call above is to the immutable USDC token only
        emit PayoutDeferred(to, amount);
    }

    function _payWinner(uint256 id, Bet storage b, address winner, int256 price, uint80 roundId) private {
        b.state = BetState.Settled;
        uint256 payout = uint256(b.stake) * 2;
        emit BetSettled(id, winner, payout, price, roundId);

        _payout(winner, payout);
    }
}
