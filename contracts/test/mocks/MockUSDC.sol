// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev 6-decimal ERC20 with a USDC-style blacklist (transfers to/from a blocked account revert) and an
///      opt-in mode where `transfer` to an account returns false instead of reverting.
contract MockUSDC is ERC20 {
    mapping(address account => bool) public blocked;
    mapping(address account => bool) public returnsFalse;

    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address account, bool value) external {
        blocked[account] = value;
    }

    function setReturnsFalse(address account, bool value) external {
        returnsFalse[account] = value;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (returnsFalse[to]) return false;
        return super.transfer(to, value);
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[from] && !blocked[to], "Blacklistable: account is blacklisted");
        super._update(from, to, value);
    }
}
