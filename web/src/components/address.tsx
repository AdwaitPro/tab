import { ArrowUpRight } from "lucide-react";
import { addressUrl } from "@/lib/constants";
import { shortAddress } from "@/lib/text";
import { CopyButton } from "./ui/copy-button";

/** Middle-truncated checksummed address with copy + explorer link. Full value stays available to AT. */
export function AddressChip({ address, label }: { address: string; label?: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-0.5">
      <a
        href={addressUrl(address)}
        target="_blank"
        rel="noopener noreferrer"
        className="group inline-flex min-h-9 items-center gap-1 rounded-full px-1.5 font-mono text-[14px] text-fg hover:bg-surface-2"
        title={address}
      >
        <span aria-hidden="true">{shortAddress(address)}</span>
        <span className="sr-only">{`${label ?? "Address"} ${address}, view on Basescan`}</span>
        <ArrowUpRight className="size-3.5 text-subtle transition-transform group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden="true" />
      </a>
      <CopyButton value={address} label={`Copy ${label ?? "address"}`} />
    </span>
  );
}
