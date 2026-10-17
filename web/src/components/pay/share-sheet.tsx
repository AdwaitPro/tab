"use client";

import { Check, Link2, Share2 } from "lucide-react";
import { useSyncExternalStore } from "react";
import { TabQr } from "@/components/tab-qr";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/ui/copy-button";
import { Sheet } from "@/components/ui/sheet";

const subscribe = () => () => {};

export function ShareSheet({
  open,
  onClose,
  url,
  title,
  text,
}: {
  open: boolean;
  onClose: () => void;
  url: string;
  title: string;
  text: string;
}) {
  const { copied, copy } = useCopy();
  const canShare = useSyncExternalStore(
    subscribe,
    () => typeof navigator.share === "function",
    () => false,
  );
  return (
    <Sheet open={open} onClose={onClose} title="Share this Tab" description="Scan with a phone wallet or send the link">
      <div className="flex justify-center rounded-[24px] bg-surface-2 p-5">
        <TabQr value={url} size={232} label={`QR code for ${url}`} />
      </div>
      <p className="mt-3 truncate text-center font-mono text-[13px] text-muted" title={url}>
        {url.replace(/^https?:\/\//, "")}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" onClick={() => void copy(url)}>
          {copied ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button
          size="lg"
          disabled={!canShare}
          onClick={() => {
            navigator.share({ title, text, url }).catch(() => undefined);
          }}
        >
          <Share2 aria-hidden="true" /> Share
        </Button>
      </div>
    </Sheet>
  );
}
