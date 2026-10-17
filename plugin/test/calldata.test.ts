import { decodeFunctionData, erc20Abi, keccak256, stringToBytes } from "viem";
import { describe, expect, it } from "vitest";

import { approveProposal } from "../src/lib/approve.js";
import { tabEscrowAbi } from "../src/lib/escrowAbi.js";
import { USDC } from "../src/lib/constants.js";
import { transferCalldata } from "../src/tools/pay.js";
import { reviewSeconds, termsHash } from "../src/tools/deal.js";
import { ESCROW, ME, proposalOf } from "./helpers.js";
import { encodeFunctionData } from "viem";

describe("calldata", () => {
  it("USDC transfer round-trips through decodeFunctionData", () => {
    const data = transferCalldata(ME, 2_000_417n);
    const decoded = decodeFunctionData({ abi: erc20Abi, data });
    expect(decoded.functionName).toBe("transfer");
    expect(decoded.args).toEqual([ME, 2_000_417n]);
    expect(data.slice(0, 10)).toBe("0xa9059cbb");
  });

  it("approve proposal is exact-amount to the escrow, value 0, on USDC", () => {
    const result = approveProposal(ESCROW, 3_000_000n, "a deal", "retry");
    const tx = proposalOf(result);
    expect(tx.to.toLowerCase()).toBe(USDC.toLowerCase());
    expect(tx.value).toBe("0");
    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });
    expect(decoded.functionName).toBe("approve");
    expect(decoded.args).toEqual([ESCROW, 3_000_000n]);
  });

  it("createDeal args round-trip", () => {
    const hash = termsHash("Logo, 3 concepts");
    expect(hash).toBe(keccak256(stringToBytes("Logo, 3 concepts")));
    const data = encodeFunctionData({ abi: tabEscrowAbi, functionName: "createDeal", args: [ME, 3_000_000n, 1_800_000_000n, reviewSeconds(48), ESCROW, hash] });
    const decoded = decodeFunctionData({ abi: tabEscrowAbi, data });
    expect(decoded.functionName).toBe("createDeal");
    expect(decoded.args).toEqual([ME, 3_000_000n, 1_800_000_000n, 172_800n, ESCROW, hash]);
  });

  it("review window clamps to contract bounds", () => {
    expect(reviewSeconds(0.0167)).toBe(60n);
    expect(reviewSeconds(720)).toBe(2_592_000n);
    expect(reviewSeconds(1)).toBe(3600n);
  });
});
