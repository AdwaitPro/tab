// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AggregatorV3Interface} from "../../src/interfaces/AggregatorV3Interface.sol";

/// @dev Settable Chainlink aggregator with round history, used both as a price feed and as the L2 sequencer
///      uptime feed. Round ids follow the proxy encoding `phaseId << 64 | aggregatorRoundId`.
contract MockAggregator is AggregatorV3Interface {
    struct Round {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
    }

    uint8 public immutable override decimals;
    uint80 public latestRound;
    uint16 public phase = 1;
    bool public revertOnMissing;
    bool public revertOnPhaseId;
    mapping(uint80 roundId => Round) public rounds;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function description() external pure override returns (string memory) {
        return "mock";
    }

    /// @notice Appends a round in the current phase and makes it the latest.
    function set(int256 answer, uint256 startedAt, uint256 updatedAt) external returns (uint80 roundId) {
        uint80 base = uint80(phase) << 64;
        roundId = latestRound >= base ? latestRound + 1 : base + 1;
        rounds[roundId] = Round(answer, startedAt, updatedAt);
        latestRound = roundId;
    }

    /// @notice Simulates a Chainlink proxy phase change: the next round restarts at aggregator round 1.
    function newPhase() external {
        ++phase;
    }

    function setRevertOnMissing(bool value) external {
        revertOnMissing = value;
    }

    function setRevertOnPhaseId(bool value) external {
        revertOnPhaseId = value;
    }

    function phaseId() external view override returns (uint16) {
        if (revertOnPhaseId) revert("no phase");
        return phase;
    }

    function getRoundData(uint80 roundId) public view override returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[roundId];
        if (revertOnMissing && r.updatedAt == 0) revert("No data present");
        return (roundId, r.answer, r.startedAt, r.updatedAt, roundId);
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        return getRoundData(latestRound);
    }
}
