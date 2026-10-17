"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, ExternalLink, Hourglass, Share, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import { useState } from "react";
import { erc20Abi, getAddress, type Address } from "viem";
import { useAccount, useConfig, useReadContract } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { base } from "wagmi/chains";
import { Dice } from "@/components/illustrations";
import { Avatar } from "@/components/pay/avatar";
import { PayWithAgentButton } from "@/components/pay/growth";
import { ShareSheet } from "@/components/pay/share-sheet";
import { SparkleBurst } from "@/components/pay/sparkles";
import { StatusIsland } from "@/components/pay/status-island";
import { AddressChip } from "@/components/address";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill, type Tone } from "@/components/ui/pill";
import { useNow } from "@/components/use-now";
import { WalletGate } from "@/components/wallet/wallet-bar";
import { formatUsdc } from "@/lib/amount";
import { cn } from "@/lib/cn";
import { USDC_ADDRESS, txUrl } from "@/lib/constants";
import { fetchBet, type ClientBet } from "@/lib/escrow-client";
import { ARBITRATION_GRACE_S, MUTUAL_REFUND_DELAY_S, PRICE_REFUND_DELAY_S, type BetState } from "@/lib/escrow-types";
import { shortAddress } from "@/lib/text";
import { errorMessage, isUserRejection } from "@/lib/wallet-errors";
import { FlipCountdown } from "@/components/motion/flip-countdown";
import { ActionCard, TermsBox } from "./parts";
import { PriceChart } from "./price-chart";
import { useEscrowTx } from "./use-escrow-tx";
import { WithdrawCard } from "./withdraw-card";

const TONE: Record<BetState, Tone> = { None: "neutral", Open: "accent", Matched: "info", Settled: "success", Refunded: "neutral" };
const LABEL: Record<BetState, string> = { None: "Unknown", Open: "Open to join", Matched: "Matched", Settled: "Settled", Refunded: "Refunded" };
const FEED_HEARTBEAT_S = 1200;

function formatPrice(raw: string | bigint, decimals: number): string {
  const v = typeof raw === "bigint" ? raw : BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const cents = (v * 100n) / scale;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${whole}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export function BetView({ initial, escrow, url }: { initial: ClientBet; escrow: Address; url: string }) {
  const queryKey = ["bet", initial.id] as const;
  const { data: bet } = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchBet(initial.id, signal),
    initialData: initial,
    refetchInterval: 10_000,
  });
  const now = useNow();
  const config = useConfig();
  const { address } = useAccount();
  const tx = useEscrowTx(escrow, queryKey);
  const [shareOpen, setShareOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const me = address ? getAddress(address) : null;
  const id = BigInt(bet.id);
  const stake = BigInt(bet.stake_atomic);
  const isCreator = me === bet.creator;
  const isOpponent = bet.opponent !== null && me === bet.opponent;
  const isArbiter = bet.arbiter !== null && me === bet.arbiter;
  const joinBy = new Date(bet.join_by).getTime();
  const resolveAt = new Date(bet.resolve_at).getTime();
  const ready = now > 0;
  const isPrice = bet.kind === "Price";
  const canJoin =
    ready && bet.state === "Open" && now < joinBy && me !== null && !isCreator && !isArbiter && (bet.opponent === null || isOpponent);

  const allowance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: me ? [me, escrow] : undefined,
    chainId: base.id,
    query: { enabled: canJoin },
  });
  const approved = allowance.data !== undefined && allowance.data >= stake;

  async function approve() {
    setApproveError(null);
    setApproving(true);
    try {
      const hash = await writeContract(config, {
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [escrow, stake],
        chainId: base.id,
      });
      await waitForTransactionReceipt(config, { hash, chainId: base.id });
      await allowance.refetch();
    } catch (e) {
      setApproveError(isUserRejection(e) ? "Approval cancelled, nothing changed" : errorMessage(e));
    } finally {
      setApproving(false);
    }
  }

  const decimals = bet.feed_decimals ?? bet.price?.decimals ?? 8;
  const threshold = bet.threshold ? BigInt(bet.threshold) : null;
  const live = bet.price ? BigInt(bet.price.answer) : null;
  const aboveWins = live !== null && threshold !== null ? live >= threshold : null;
  const creatorWinning = aboveWins === null || bet.creator_above === null ? null : aboveWins === bet.creator_above;
  const asset = bet.price?.description.split("/")[0]?.trim() ?? "Price";

  const deadline =
    bet.state === "Open"
      ? { label: now < joinBy ? "Join closes in" : "Join window closed", at: joinBy }
      : bet.state === "Matched"
        ? { label: now < resolveAt ? "Resolves in" : "Ready to settle", at: resolveAt }
        : null;

  const busy = tx.pending !== null || approving;
  const actions: React.ReactNode[] = [];

  if (canJoin) {
    actions.push(
      <ActionCard key="join" title={`Join for ${formatUsdc(stake)} USDC`} consequence={`Locks your ${formatUsdc(stake)} USDC stake, winner takes ${formatUsdc(stake * 2n)} USDC`}>
        <ol className="mb-3 flex items-center gap-2 text-[13px] font-semibold" aria-label="Two steps">
          <li className={cn("flex items-center gap-1.5", approved ? "text-success" : "text-fg")}>
            <span className={cn("inline-flex size-5 items-center justify-center rounded-full text-[11px]", approved ? "bg-success-bright text-white" : "bg-accent text-accent-fg")}>
              {approved ? <Check className="size-3" strokeWidth={3} /> : "1"}
            </span>
            Approve exactly {formatUsdc(stake)}
          </li>
          <span className="h-px flex-1 bg-line-strong" aria-hidden="true" />
          <li className={cn("flex items-center gap-1.5", approved ? "text-fg" : "text-subtle")}>
            <span className={cn("inline-flex size-5 items-center justify-center rounded-full text-[11px]", approved ? "bg-accent text-accent-fg" : "bg-surface-3")}>2</span>
            Join
          </li>
        </ol>
        {approved ? (
          <Button block size="lg" disabled={busy} onClick={() => void tx.run({ functionName: "joinBet", args: [id] }, "Join bet")}>
            {tx.pending === "Join bet" ? "Joining…" : "Step 2: Join bet"}
          </Button>
        ) : (
          <Button block size="lg" disabled={busy || allowance.isLoading} onClick={() => void approve()}>
            {approving ? "Approving…" : `Step 1: Approve ${formatUsdc(stake)} USDC`}
          </Button>
        )}
      </ActionCard>,
    );
  }
  if (ready && isCreator && bet.state === "Open") {
    actions.push(
      <ActionCard key="cancel" title="Cancel bet" consequence={`Nobody joined yet, you get your ${formatUsdc(stake)} USDC back`} tone="warn">
        <Button block variant="secondary" disabled={busy} onClick={() => void tx.run({ functionName: "cancelUnjoined", args: [id] }, "Cancel bet")}>
          Cancel and refund me
        </Button>
      </ActionCard>,
    );
  }
  if (ready && bet.state === "Matched" && isPrice && now >= resolveAt) {
    const s = bet.settlement;
    if (s?.status === "found") {
      actions.push(
        <ActionCard key="settle" title="Settle with Chainlink" consequence={`Chainlink says ${formatPrice(s.answer, decimals)}, the winner gets ${formatUsdc(stake * 2n)} USDC`}>
          <Button block size="lg" disabled={busy} onClick={() => void tx.run({ functionName: "settlePrice", args: [id, BigInt(s.round_id)] }, "Settle")}>
            {tx.pending === "Settle" ? "Settling…" : "Settle bet"}
          </Button>
        </ActionCard>,
      );
    } else if (s?.status === "not-final") {
      const next = new Date(s.latest_updated_at).getTime() + FEED_HEARTBEAT_S * 1000;
      const mins = Math.max(1, Math.ceil((next - now) / 60_000));
      actions.push(
        <ActionCard key="wait" title="Oracle not final yet" consequence={`Waiting for Chainlink's next price, retry in about ${mins} min`} tone="warn">
          <Button block variant="secondary" disabled>
            Waiting for oracle
          </Button>
        </ActionCard>,
      );
    } else if (s) {
      actions.push(
        <p key="unprovable" className="rounded-2xl bg-pending-soft px-4 py-3 text-[14px] text-pending">
          The oracle can&apos;t settle this one ({s.reason}), both stakes refund 3 days after resolve time
        </p>,
      );
    }
  }
  if (ready && bet.state === "Matched" && !isPrice && now >= resolveAt && (isCreator || isOpponent)) {
    const mine = isCreator ? bet.creator_report : bet.opponent_report;
    actions.push(
      <ActionCard key="report" title="Report the winner" consequence="Same answer from both of you pays out right away, otherwise the arbiter decides or stakes refund after 7 days">
        {mine && (
          <p className="mb-2 text-[13px] text-muted">
            You picked <span className="font-mono">{shortAddress(mine)}</span>, you can still change it
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={busy} variant={mine === bet.creator ? "primary" : "secondary"} onClick={() => void tx.run({ functionName: "report", args: [id, getAddress(bet.creator)] }, "Report")}>
            {isCreator ? "I won" : "Creator won"}
          </Button>
          <Button disabled={busy || !bet.opponent} variant={mine === bet.opponent ? "primary" : "secondary"} onClick={() => bet.opponent && void tx.run({ functionName: "report", args: [id, getAddress(bet.opponent)] }, "Report")}>
            {isOpponent ? "I won" : "Opponent won"}
          </Button>
        </div>
      </ActionCard>,
    );
  }
  const conflict = bet.creator_report !== null && bet.opponent_report !== null && bet.creator_report !== bet.opponent_report;
  if (ready && bet.state === "Matched" && !isPrice && isArbiter && bet.opponent && (conflict || now >= resolveAt + ARBITRATION_GRACE_S * 1000)) {
    actions.push(
      <ActionCard key="arbitrate" title="Arbitrate" consequence={`Your call pays ${formatUsdc(stake * 2n)} USDC to the winner`}>
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={busy} onClick={() => void tx.run({ functionName: "arbitrate", args: [id, getAddress(bet.creator)] }, "Arbitrate")}>Creator wins</Button>
          <Button disabled={busy} onClick={() => bet.opponent && void tx.run({ functionName: "arbitrate", args: [id, getAddress(bet.opponent)] }, "Arbitrate")}>Opponent wins</Button>
        </div>
      </ActionCard>,
    );
  }
  const staleAt = resolveAt + (isPrice ? PRICE_REFUND_DELAY_S : MUTUAL_REFUND_DELAY_S) * 1000;
  if (ready && bet.state === "Matched" && now >= staleAt) {
    actions.push(
      <ActionCard key="stale" title="Refund both stakes" consequence="Nobody could settle it in time, anyone can send both stakes back" tone="warn">
        <Button block variant="secondary" disabled={busy} onClick={() => void tx.run({ functionName: "refundStale", args: [id] }, "Refund")}>
          Refund both
        </Button>
      </ActionCard>,
    );
  }

  const terminal = bet.state === "Settled" || bet.state === "Refunded";
  const sideLabel = (creatorSide: boolean) =>
    isPrice && threshold !== null && bet.creator_above !== null
      ? `${(creatorSide ? bet.creator_above : !bet.creator_above) ? "≥" : "<"} ${formatPrice(threshold, decimals)}`
      : null;

  return (
    <>
      <StatusIsland state={tx.island} />
      <Card className="animate-rise overflow-hidden">
        <div className="px-6 pt-6 sm:px-7">
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-semibold">
              {isPrice ? "Price bet" : "Event bet"} <span className="font-mono text-muted">#{bet.id}</span>
            </p>
            <div className="flex items-center gap-1">
              <Pill tone={TONE[bet.state]} dot>
                {LABEL[bet.state]}
              </Pill>
              <Button variant="ghost" size="icon" aria-label="Share this bet" onClick={() => setShareOpen(true)}>
                <Share aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <Side
              label="Creator"
              address={bet.creator}
              you={isCreator}
              side={sideLabel(true)}
              winning={bet.state === "Matched" && creatorWinning === true}
              won={bet.winner === bet.creator}
            />
            <div className="relative flex flex-col items-center">
              <Dice className="size-14" float rotate={10} />
              <p className="mt-1 text-[12px] font-semibold text-subtle">Pot</p>
              <p className="tabular text-[17px] font-bold">{formatUsdc(stake * 2n)}</p>
              {bet.state === "Settled" && <SparkleBurst />}
            </div>
            <Side
              label="Opponent"
              address={bet.opponent}
              you={isOpponent}
              side={sideLabel(false)}
              winning={bet.state === "Matched" && creatorWinning === false}
              won={bet.winner !== null && bet.winner === bet.opponent}
              open={bet.state === "Open"}
            />
          </div>
          <p className="mt-3 text-center text-[13px] text-muted">
            <span className="tabular font-mono">{formatUsdc(stake)}</span> USDC each
          </p>

          {isPrice && bet.price && threshold !== null && live !== null && (
            <PriceTicker
              asset={asset}
              price={formatPrice(live, decimals)}
              threshold={formatPrice(threshold, decimals)}
              above={aboveWins === true}
              live={live}
              thresholdRaw={threshold}
              history={bet.price.history.map((h) => BigInt(h.answer))}
              final={bet.state !== "Open" && bet.state !== "Matched"}
            />
          )}

          {deadline && ready && (
            <p className="mt-4 flex items-center justify-center gap-2 rounded-full bg-surface-2 px-4 py-2 text-[14px]">
              <Hourglass className="size-4 text-muted" aria-hidden="true" />
              <span className="text-muted">{deadline.label}</span>
              {deadline.at > now && <FlipCountdown ms={deadline.at - now} />}
            </p>
          )}
        </div>

        <div className="mt-5 space-y-4 border-t border-line px-6 py-5 sm:px-7">
          {bet.state === "Settled" && bet.winner && (
            <p className="flex items-center gap-2 rounded-2xl bg-success-soft px-4 py-3 text-[15px] font-semibold text-success">
              <Trophy className="size-5" aria-hidden="true" />
              {bet.winner === me ? "You won" : `${shortAddress(bet.winner)} won`} {formatUsdc(stake * 2n)} USDC
            </p>
          )}
          {bet.state === "Refunded" && (
            <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[14px] text-muted">Stakes returned, nobody won or lost</p>
          )}
          <TermsBox terms={bet.terms} hash={bet.terms_hash} />
          {!isPrice && (bet.creator_report || bet.opponent_report) && (
            <div className="grid grid-cols-2 gap-2 text-[13px]">
              <Report who="Creator says" winner={bet.creator_report} />
              <Report who="Opponent says" winner={bet.opponent_report} />
            </div>
          )}
          {bet.arbiter && (
            <p className="flex items-center justify-between text-[14px]">
              <span className="text-muted">Arbiter</span>
              <AddressChip address={bet.arbiter} label="Arbiter" />
            </p>
          )}
          {bet.created_tx && (
            <a href={txUrl(bet.created_tx)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 text-[13px] font-semibold text-accent-ink hover:underline">
              Creation transaction <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </div>

        {(!terminal || me) && (
          <div className="border-t border-line px-6 py-5 sm:px-7" aria-live="polite">
            <WalletGate prompt="Connect to join, settle or report">
              <WithdrawCard escrow={escrow} tx={tx} />
              {terminal ? null : actions.length > 0 ? (
                <div className="space-y-3">{actions}</div>
              ) : (
                <p className="rounded-2xl bg-surface-2 px-4 py-3 text-center text-[14px] text-muted">Nothing to do yet</p>
              )}
            </WalletGate>
            {(tx.error || approveError) && (
              <p role="alert" className="mt-3 flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-[14px] text-danger">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {tx.error ?? approveError}
              </p>
            )}
          </div>
        )}
      </Card>
      <div className="mt-3">
        <PayWithAgentButton url={url} />
      </div>
      <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} url={url} title="Tab bet" text={`Bet: ${formatUsdc(stake)} USDC each`} />
    </>
  );
}

function Side(props: {
  label: string;
  address: string | null;
  you: boolean;
  side: string | null;
  winning: boolean;
  won: boolean;
  open?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-[20px] p-3 text-center transition-[background-color,box-shadow] duration-500",
        (props.winning || props.won) && "bg-success-soft shadow-[0_0_0_2px_var(--success-bright),0_0_32px_-4px_var(--success-bright)]",
      )}
    >
      {props.address ? (
        <Avatar label={props.address} />
      ) : (
        <span className="inline-flex size-11 items-center justify-center rounded-full border-2 border-dashed border-line-strong text-[18px] font-bold text-subtle" aria-hidden="true">
          ?
        </span>
      )}
      <p className="mt-2 text-[12px] font-semibold text-subtle">
        {props.label}
        {props.you && " · You"}
      </p>
      <p className="font-mono text-[13px]">{props.address ? shortAddress(props.address, 5, 4) : props.open ? "Open seat" : "Nobody yet"}</p>
      {props.side && <p className="mt-1 text-[13px] font-semibold">{props.side}</p>}
      {(props.winning || props.won) && <p className="mt-1 text-[12px] font-bold text-success">{props.won ? "Won" : "Winning"}</p>}
    </div>
  );
}

function Report({ who, winner }: { who: string; winner: string | null }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-3">
      <p className="text-subtle">{who}</p>
      <p className="font-mono">{winner ? shortAddress(winner) : "Nobody yet"}</p>
    </div>
  );
}

function PriceTicker(props: {
  asset: string;
  price: string;
  threshold: string;
  above: boolean;
  live: bigint;
  thresholdRaw: bigint;
  history: bigint[];
  final: boolean;
}) {
  const points = props.history.length > 0 && props.history[props.history.length - 1] === props.live ? props.history : [...props.history, props.live];
  return (
    <div className="mt-5 rounded-[20px] bg-surface-2 p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] font-semibold text-subtle">{props.asset} / USD · Chainlink</p>
        <p className={cn("flex items-center gap-1 text-[13px] font-semibold", props.above ? "text-success" : "text-danger")}>
          {props.above ? <TrendingUp className="size-4" aria-hidden="true" /> : <TrendingDown className="size-4" aria-hidden="true" />}
          {props.above ? "Above" : "Below"} line
        </p>
      </div>
      <p className="tabular mt-1 text-[32px] leading-tight font-bold tracking-[-0.03em]" aria-live="polite">
        {props.price}
      </p>
      <PriceChart points={points} threshold={props.thresholdRaw} above={props.above} />
      <p className="mt-2 flex justify-between text-[12px] text-subtle">
        <span>Line {props.threshold}</span>
        <span>{props.final ? "Final" : "Live from Chainlink"}</span>
      </p>
    </div>
  );
}
