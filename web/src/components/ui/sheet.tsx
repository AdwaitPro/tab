"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from "react";
import { cn } from "@/lib/cn";

/**
 * Native <dialog> (focus trap, Esc, inert background for free) styled as a bottom sheet on
 * phones and a floating panel on larger screens. The handle supports drag-to-dismiss.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    start.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (start.current === null) return;
    setDrag(Math.max(0, e.clientY - start.current));
  }
  function onPointerUp() {
    if (drag > 90) onClose();
    start.current = null;
    setDrag(0);
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="sheet-title"
      className={cn(
        "m-0 mt-auto w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 backdrop:backdrop-blur-[2px]",
        "sm:m-auto sm:max-w-[420px]",
      )}
    >
      {open && (
        <div
          className="sheet rounded-t-[28px] bg-surface px-5 pt-2 pb-[max(env(safe-area-inset-bottom),20px)] shadow-pop sm:rounded-[28px] sm:pb-6"
          style={drag ? { transform: `translateY(${drag}px)`, animation: "none" } : undefined}
        >
          <div
            className="mx-auto flex h-6 w-24 cursor-grab touch-none items-center justify-center sm:hidden"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-hidden="true"
          >
            <span className="h-1.5 w-10 rounded-full bg-line-strong" />
          </div>
          <div className="flex items-start justify-between gap-4 pt-2 sm:pt-3">
            <div>
              <h2 id="sheet-title" className="text-[20px] font-bold tracking-[-0.02em]">
                {title}
              </h2>
              {description && <p className="mt-1 text-[15px] leading-6 text-muted">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="press -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}
