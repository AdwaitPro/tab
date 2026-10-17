import { Fragment } from "react";
import { cn } from "@/lib/cn";

/** Per-word masked reveal (translateY + rotateX), staggered 40ms. Plain text for assistive tech. */
export function RevealHeadline({ text, className, accent }: { text: string; className?: string; accent?: string[] }) {
  const words = text.split(" ");
  return (
    <h1 className={className} aria-label={text}>
      {words.map((w, i) => (
        <Fragment key={`${w}-${i}`}>
          <span className="word-mask" aria-hidden="true">
            <span className={cn("word", accent?.includes(w) && "serif-accent text-brand font-normal")} style={{ ["--i" as string]: i }}>
              {w}
            </span>
          </span>
          {i < words.length - 1 ? " " : ""}
        </Fragment>
      ))}
    </h1>
  );
}
