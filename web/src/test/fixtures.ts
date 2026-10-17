import { getAddress, type Address, type Hex } from "viem";
import type { TransferSource, UsdcTransfer } from "@/lib/chain/matching";

export const RECIPIENT: Address = "0xbEfF1786A7aD59a8D62d46eE8d31dfb9A7a73d2E";
export const PAYER: Address = getAddress("0xb7e0700000000000000000000000000000400a3b");

let seq = 0;
export function transfer(partial: Partial<UsdcTransfer> & { value: bigint; blockNumber: bigint }): UsdcTransfer {
  seq += 1;
  return {
    txHash: `0x${seq.toString(16).padStart(64, "0")}` as Hex,
    logIndex: 0,
    from: PAYER,
    to: RECIPIENT,
    ...partial,
  };
}

/** In-memory chain: returns transfers in range, can fail specific ranges, records queried ranges. */
export class FakeSource implements TransferSource {
  readonly queried: Array<[bigint, bigint]> = [];
  failFrom: bigint | null = null;
  headFails = false;

  constructor(
    public head: bigint,
    public transfers: UsdcTransfer[] = [],
  ) {}

  async headBlock(): Promise<bigint> {
    if (this.headFails) throw new Error("rpc down");
    return this.head;
  }

  async transfersTo(recipient: Address, from: bigint, to: bigint): Promise<UsdcTransfer[]> {
    this.queried.push([from, to]);
    if (this.failFrom !== null && to >= this.failFrom) throw new Error("rate limited");
    return this.transfers.filter(
      (t) => t.to.toLowerCase() === recipient.toLowerCase() && t.blockNumber >= from && t.blockNumber <= to,
    );
  }
}
