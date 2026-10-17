"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Clock,
  ExternalLink,
  Loader2,
  Share,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { erc20Abi, getAddress, parseEventLogs, type Address, type Hex } from "viem";
import {
  useAccount,
  useBalance,
  useDisconnect,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { base } from "wagmi/chains";
import { AddressChip } from "@/components/address";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { ConnectSheet } from "@/components/wallet/connect-sheet";
import { formatUsdc, formatUsdcExact } from "@/lib/amount";
import { fetchStatus, type ClientStatus } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { PAYBOX_DEPOSIT_URL, USDC_ADDRESS, txUrl } from "@/lib/constants";
import type { RequestRecord } from "@/lib/server/records";
import { shortAddress } from "@/lib/text";
import { errorMessage, isUserRejection } from "@/lib/wallet-errors";
import { CheckMark } from "./check-mark";
import { GrowthCard, PayWithAgentButton } from "./growth";
import { Magnetic } from "@/components/motion/magnetic";
import { Odometer } from "@/components/motion/odometer";
import { TiltCard } from "@/components/motion/tilt-card";
import { ShareSheet } from "./share-sheet";
import { SparkleBurst } from "./sparkles";
import { StatusIsland, type IslandState } from "./status-island";
import { Avatar } from "./avatar";
import { Perforation } from "./perforation";
import { TimeAgo } from "@/components/time-ago";

export interface RequestPayProps {
  request: RequestRecord;
  url: string;
  source: "db" | "payload";
}

type Phase =
  | "connect"
  | "wrong_network"
  | "self"
  | "loading_balance"
  | "insufficient"
  | "ready"
  | "signing"
  | "confirming"
  | "failed_tx"
  | "paid"
  | "expired";

const txKey = (id: string) => `tab:tx:${id}`;

function readStoredTx(id: string): Hex | null {
  try {
    const v = sessionStorage.getItem(txKey(id));
    return v && /^0x[0-9a-fA-F]{64}$/.test(v) ? (v as Hex) : null;
  } catch {
    return null;
  }
}

export function RequestPay({ request, url, source }: RequestPayProps) {
  const recipient = getAddress(request.recipient);
  const unique = BigInt(request.unique_atomic);
  const baseAmount = BigInt(request.amount_atomic);
  const matchingCode = unique - baseAmount;

  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();
  const [connectOpen, setConnectOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    // Restores an in-flight payment after a refresh; sessionStorage is browser-only.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTxHash(readStoredTx(request.id));
  }, [request.id]);

  const initialStatus: ClientStatus = {
    id: request.id,
    status: request.status,
    paid_tx: request.paid_tx,
    paid_at: request.paid_at,
    payer_address: request.payer_address,
    checked_at: request.created_at,
  };
  const statusQuery = useQuery({
    queryKey: ["request-status", request.id],
    queryFn: ({ signal }) => fetchStatus(request.id, signal),
    initialData: initialStatus,
    initialDataUpdatedAt: 0,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s === "paid" || s === "paid_late") return false;
      return txHash ? 2_500 : 6_000;
    },
  });
  const status = statusQuery.data;
  const firstCheckDone = statusQuery.dataUpdatedAt > 0;

  const onBase = chainId === base.id;
  const usdc = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: base.id,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });
  const eth = useBalance({ address, chainId: base.id, query: { enabled: Boolean(address) } });

  const { writeContractAsync, isPending: signing } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: txHash ?? undefined, chainId: base.id });

  /** The receipt is chain truth: a matching Transfer in our own tx means paid, even before the server catches up. */
  const receiptPaid = useMemo(() => {
    if (!receipt.data || receipt.data.status !== "success") return false;
    const logs = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.data.logs });
    return logs.some(
      (l) => l.address.toLowerCase() === USDC_ADDRESS.toLowerCase() && l.args.to === recipient && l.args.value === unique,
    );
  }, [receipt.data, recipient, unique]);

  const serverPaid = status.status === "paid" || status.status === "paid_late";
  const paid = serverPaid || receiptPaid;
  const paidTx = (status.paid_tx ?? (receiptPaid ? txHash : null)) as Hex | null;
  const payer = status.payer_address ?? (receiptPaid ? (address ?? null) : null);
  const paidAt = status.paid_at;

  const balance = usdc.data;
  const lowGas = eth.data !== undefined && eth.data.value === 0n;

  let phase: Phase;
  if (paid) phase = "paid";
  else if (txHash && receipt.data?.status === "reverted") phase = "failed_tx";
  else if (txHash) phase = "confirming";
  else if (signing) phase = "signing";
  else if (status.status === "expired") phase = "expired";
  else if (!isConnected || !address) phase = "connect";
  else if (!onBase) phase = "wrong_network";
  else if (getAddress(address) === recipient) phase = "self";
  else if (balance === undefined) phase = "loading_balance";
  else if (balance < unique) phase = "insufficient";
  else phase = "ready";

  useEffect(() => {
    if (paid) {
      try {
        sessionStorage.removeItem(txKey(request.id));
      } catch {
        // Storage unavailable: nothing to clean up.
      }
    }
  }, [paid, request.id]);

  useEffect(() => {
    if (source !== "db" || !address || paid || request.payer_address) return;
    if (getAddress(address) === recipient) return;
    // Best effort: lets the payer's agent list this under "you owe". Failure is harmless.
    void fetch(`/api/requests/${encodeURIComponent(request.id)}/payer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payer_address: address }),
    }).catch(() => undefined);
  }, [source, address, paid, request.id, request.payer_address, recipient]);

  async function pay() {
    setWriteError(null);
    try {
      const hash = await writeContractAsync({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "transfer",
        args: [recipient, unique],
        chainId: base.id,
      });
      try {
        sessionStorage.setItem(txKey(request.id), hash);
      } catch {
        // Storage unavailable: a refresh mid-confirmation falls back to server polling.
      }
      setTxHash(hash);
    } catch (error) {
      setWriteError(isUserRejection(error) ? "Cancelled in your wallet, nothing was sent" : errorMessage(error));
    }
  }

  const island: IslandState | null =
    phase === "signing"
      ? { kind: "signing" }
      : phase === "confirming"
        ? { kind: "confirming" }
        : phase === "paid" && txHash
          ? { kind: "paid", text: `Paid ${formatUsdc(baseAmount)} USDC` }
          : phase === "failed_tx"
            ? { kind: "error", text: "Transaction failed" }
            : null;

  const requester = request.requester_label;
  const memo = request.memo;

  if (phase === "paid") {
    return (
      <>
        <StatusIsland state={island} />
        <Receipt
          amount={baseAmount}
          unique={unique}
          recipient={recipient}
          payer={payer}
          paidAt={paidAt}
          tx={paidTx}
          memo={memo}
          requester={requester}
          late={status.status === "paid_late"}
        />
        <div className="mt-4 animate-rise" style={{ animationDelay: "500ms" }}>
          <GrowthCard />
        </div>
      </>
    );
  }

  return (
    <>
      <StatusIsland state={island} />
      <TiltCard className="animate-rise">
      <Card className="sheen-sweep overflow-hidden">
        <div className="px-6 pt-6 sm:px-7 sm:pt-7">
          <div className="flex items-center gap-3">
            <Avatar label={requester ?? recipient} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">
                {requester ? <UserText>{requester}</UserText> : shortAddress(recipient)}
                <span className="font-normal text-muted"> is asking</span>
              </p>
              <p className="text-[13px] text-subtle">
                {request.payer_label ? (
                  <>
                    for <UserText>{request.payer_label}</UserText> ·{" "}
                  </>
                ) : null}
                <TimeAgo iso={request.created_at} />
              </p>
            </div>
            <Button variant="ghost" size="icon" aria-label="Share this request" onClick={() => setShareOpen(true)}>
              <Share aria-hidden="true" />
            </Button>
          </div>

          <div className="mt-7 text-center">
            {memo && (
              <p className="mx-auto max-w-[32ch] text-[17px] leading-6 font-medium text-muted">
                <UserText>{memo}</UserText>
              </p>
            )}
            <p className="mt-2 flex items-baseline justify-center gap-2">
              <Odometer value={formatUsdc(baseAmount)} className="text-amount font-black tracking-[-0.045em]" />
              <span className="text-[20px] font-bold text-muted">USDC</span>
            </p>
            <p className="mt-2 text-[13px] text-subtle">
              <span className="tabular font-mono">{formatUsdc(baseAmount)}</span> +{" "}
              <span className="tabular font-mono">{formatUsdcExact(matchingCode)}</span> matching code
            </p>
            <div className="mt-3 flex justify-center">
              <StatusBadge status={status.status} phase={phase} payer={request.payer_label} />
            </div>
          </div>
        </div>

        <Perforation />

        <dl className="space-y-1 px-6 text-[15px] sm:px-7">
          <Row label="To">
            <AddressChip address={recipient} label="Recipient" />
          </Row>
          <Row label="Network">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <BaseDot /> Base
            </span>
          </Row>
          <Row label="Exact amount">
            <span className="tabular font-mono font-medium">{formatUsdcExact(unique)} USDC</span>
          </Row>
          <Row label="Expires">
            <span className="inline-flex items-center gap-1.5 text-muted">
              <Clock className="size-4" aria-hidden="true" />
              <TimeAgo iso={request.expires_at} />
            </span>
          </Row>
        </dl>

        <TrustNote source={source} signed={Boolean(request.signature)} recipient={recipient} />

        <div className="px-6 pt-5 pb-6 sm:px-7 sm:pb-7">
          <PrimaryAction
            phase={phase}
            unique={unique}
            balance={balance}
            switching={switching}
            firstCheckDone={firstCheckDone}
            checking={status.status === "checking"}
            onConnect={() => setConnectOpen(true)}
            onSwitch={() => switchChain({ chainId: base.id })}
            onPay={() => void pay()}
            onRetry={() => {
              setTxHash(null);
              try {
                sessionStorage.removeItem(txKey(request.id));
              } catch {
                // Storage unavailable.
              }
            }}
            txHash={txHash}
          />
          {(writeError || switchError) && (
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-[14px] leading-5 text-danger">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {writeError ?? (switchError ? errorMessage(switchError) : null)}
            </p>
          )}
          {phase === "ready" && lowGas && (
            <p className="mt-3 text-center text-[13px] text-pending">
              No ETH on Base for gas, add a little first
            </p>
          )}
          {isConnected && address && phase !== "confirming" && (
            <p className="mt-3 flex items-center justify-center gap-1 text-[13px] text-subtle">
              <Wallet className="size-3.5" aria-hidden="true" />
              <span className="font-mono">{shortAddress(address)}</span>
              {balance !== undefined && (
                <span>
                  · <span className="tabular font-mono">{formatUsdc(balance)}</span> USDC
                </span>
              )}
              <button type="button" onClick={() => disconnect()} className="ml-1 min-h-9 rounded-full px-2 font-semibold text-muted hover:text-fg">
                Disconnect
              </button>
            </p>
          )}
        </div>
      </Card>
      </TiltCard>

      <div className="mt-3">
        <PayWithAgentButton url={url} />
      </div>

      <ConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />
      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        url={url}
        title="Tab payment request"
        text={`${requester ?? "Someone"} requested ${formatUsdc(baseAmount)} USDC${memo ? ` · ${memo}` : ""}`}
      />
    </>
  );
}

/** Marks untrusted user-provided text: rendered as plain text, never as markup. */
function UserText({ children }: { children: string }) {
  return <bdi>{children}</bdi>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function BaseDot() {
  return <span className="inline-block size-3.5 rounded-full bg-[#0052ff]" aria-hidden="true" />;
}

function StatusBadge({ status, phase, payer }: { status: ClientStatus["status"]; phase: Phase; payer: string | null }) {
  if (phase === "confirming") return <Pill tone="info" dot>Confirming</Pill>;
  if (status === "checking") return <Pill tone="neutral">Checking Base…</Pill>;
  if (status === "expired") return <Pill tone="danger" dot>Expired</Pill>;
  return (
    <Pill tone="pending" dot>
      {payer ? <span>Waiting for <bdi>{payer}</bdi></span> : "Unpaid"}
    </Pill>
  );
}

function TrustNote({ source, signed, recipient }: { source: "db" | "payload"; signed: boolean; recipient: Address }) {
  if (signed && source === "db") {
    return (
      <p className="mx-6 mt-3 flex items-center gap-2 rounded-2xl bg-success-soft px-4 py-3 text-[14px] leading-5 text-success sm:mx-7">
        <BadgeCheck className="size-4 shrink-0" aria-hidden="true" />
        Signed by recipient <span className="font-mono">{shortAddress(recipient)}</span>
      </p>
    );
  }
  return (
    <p className="mx-6 mt-3 flex items-start gap-2 rounded-2xl bg-pending-soft px-4 py-3 text-[14px] leading-5 text-pending sm:mx-7">
      <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {source === "payload"
        ? "Unverified link, check the address with the sender before you pay"
        : "Unsigned request, check the address with the sender"}
    </p>
  );
}

function PrimaryAction(props: {
  phase: Phase;
  unique: bigint;
  balance: bigint | undefined;
  switching: boolean;
  firstCheckDone: boolean;
  checking: boolean;
  txHash: Hex | null;
  onConnect: () => void;
  onSwitch: () => void;
  onPay: () => void;
  onRetry: () => void;
}) {
  const amount = formatUsdcExact(props.unique);
  switch (props.phase) {
    case "connect":
      return (
        <Magnetic>
          <Button size="lg" block onClick={props.onConnect}>
            <Wallet aria-hidden="true" /> Connect wallet
          </Button>
        </Magnetic>
      );
    case "wrong_network":
      return (
        <Button size="lg" block onClick={props.onSwitch} disabled={props.switching}>
          {props.switching ? <Loader2 className="spin" aria-hidden="true" /> : <BaseDot />}
          {props.switching ? "Switching…" : "Switch to Base"}
        </Button>
      );
    case "self":
      return (
        <p className="rounded-2xl bg-surface-2 px-4 py-3 text-center text-[15px] text-muted">
          This is your request, share it with whoever owes you
        </p>
      );
    case "loading_balance":
      return (
        <Button size="lg" block disabled>
          <Loader2 className="spin" aria-hidden="true" /> Checking balance…
        </Button>
      );
    case "insufficient":
      return (
        <div className="space-y-3">
          <p className="text-center text-[14px] text-muted">
            You have <span className="tabular font-mono text-fg">{formatUsdc(props.balance ?? 0n)}</span> USDC on Base. This
            needs <span className="tabular font-mono text-fg">{amount}</span>.
          </p>
          <Button size="lg" block asChild>
            <a href={PAYBOX_DEPOSIT_URL} target="_blank" rel="noopener noreferrer">
              Get USDC <ArrowRight aria-hidden="true" />
            </a>
          </Button>
        </div>
      );
    case "ready":
      return (
        <div className="space-y-2">
          <Magnetic>
          <Button size="lg" block onClick={props.onPay} disabled={!props.firstCheckDone}>
            {!props.firstCheckDone ? (
              <>
                <Loader2 className="spin" aria-hidden="true" /> Checking Base…
              </>
            ) : (
              <>
                Pay <span className="tabular font-mono">{amount}</span> USDC
              </>
            )}
          </Button>
          </Magnetic>
          {props.checking && props.firstCheckDone && (
            <p className="text-center text-[13px] text-pending">
              Still checking Base, if you already paid give it a moment
            </p>
          )}
        </div>
      );
    case "signing":
      return (
        <Button size="lg" block disabled>
          <Loader2 className="spin" aria-hidden="true" /> Confirm in your wallet…
        </Button>
      );
    case "confirming":
      return (
        <div className="space-y-2 text-center">
          <Button size="lg" block disabled>
            <Loader2 className="spin" aria-hidden="true" /> Confirming on Base…
          </Button>
          {props.txHash && (
            <a
              href={txUrl(props.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-9 items-center gap-1 font-mono text-[13px] text-accent-ink hover:underline"
            >
              {shortAddress(props.txHash, 10, 8)} <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      );
    case "failed_tx":
      return (
        <div className="space-y-2">
          <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-center text-[14px] text-danger">
            Transaction failed on Base, no USDC moved
          </p>
          <Button size="lg" block variant="secondary" onClick={props.onRetry}>
            Try again
          </Button>
        </div>
      );
    case "expired":
      return (
        <p className="rounded-2xl bg-surface-2 px-4 py-3 text-center text-[15px] text-muted">
          This request expired, ask for a new link
        </p>
      );
    case "paid":
      return null;
  }
}

function Receipt(props: {
  amount: bigint;
  unique: bigint;
  recipient: Address;
  payer: string | null;
  paidAt: string | null;
  tx: Hex | null;
  memo: string | null;
  requester: string | null;
  late: boolean;
}) {
  return (
    <div className="tilt-scene">
    <Card className="flip-in paper-curl overflow-hidden" aria-live="polite">
      <div className="print-down">
      <div className="relative px-6 pt-8 pb-6 text-center sm:px-7">
        <div className="relative mx-auto w-fit">
          <CheckMark />
          <SparkleBurst />
        </div>
        <h1 className="mt-4 text-[26px] font-black tracking-[-0.03em]">
          {props.late ? (
            "Paid late"
          ) : (
            <>
              Paid <span className="serif-accent text-[30px] font-normal">in full</span>
            </>
          )}
        </h1>
        {props.memo && (
          <p className="mt-1 text-[15px] text-muted">
            <bdi>{props.memo}</bdi>
            {props.requester ? (
              <>
                {" "}· to <bdi>{props.requester}</bdi>
              </>
            ) : null}
          </p>
        )}
        <p className="relative mt-4 flex items-baseline justify-center gap-2">
          <Odometer value={formatUsdc(props.amount)} className="text-amount font-black tracking-[-0.045em]" delayMs={500} />
          <span className="text-[20px] font-bold text-muted">USDC</span>
          <PaidStamp />
        </p>
      </div>
      <Perforation />
      <dl className="space-y-1 px-6 pb-6 text-[15px] sm:px-7">
        <Row label="Amount sent">
          <span className="tabular font-mono">{formatUsdcExact(props.unique)} USDC</span>
        </Row>
        {props.payer && (
          <Row label="From">
            <AddressChip address={props.payer} label="Payer" />
          </Row>
        )}
        <Row label="To">
          <AddressChip address={props.recipient} label="Recipient" />
        </Row>
        {props.paidAt && (
          <Row label="Time">
            <TimeAgo iso={props.paidAt} />
          </Row>
        )}
        {props.tx && (
          <Row label="Transaction">
            <a
              href={txUrl(props.tx)}
              target="_blank"
              rel="noopener noreferrer"
              className={cn("inline-flex min-h-9 items-center gap-1 font-mono text-accent-ink hover:underline")}
            >
              {shortAddress(props.tx, 8, 6)} <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </Row>
        )}
      </dl>
      </div>
    </Card>
    </div>
  );
}

/** Rubber stamp with an ink-texture SVG filter; lands after the receipt prints. */
function PaidStamp() {
  return (
    <svg viewBox="0 0 200 84" className="stamp pointer-events-none absolute -top-[46%] left-[84%] w-[104px] text-success" aria-hidden="true">
      <defs>
        <filter id="ink" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.1" result="holes" />
          <feComposite in="SourceGraphic" in2="holes" operator="in" />
        </filter>
      </defs>
      <g filter="url(#ink)" opacity="0.88">
        <rect x="6" y="6" width="188" height="72" rx="14" fill="none" stroke="currentColor" strokeWidth="6" />
        <rect x="16" y="16" width="168" height="52" rx="8" fill="none" stroke="currentColor" strokeWidth="2" />
        <text x="100" y="56" textAnchor="middle" fontSize="40" fontWeight="900" letterSpacing="6" fill="currentColor" fontFamily="var(--font-satoshi), sans-serif">
          PAID
        </text>
      </g>
    </svg>
  );
}
