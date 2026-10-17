import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Ticket } from "@/components/illustrations";
import type { ReactNode } from "react";

export function PayCardSkeleton() {
  return (
    <Card className="overflow-hidden px-6 pt-6 pb-7 sm:px-7" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="mt-8 flex flex-col items-center gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-16 w-56 rounded-2xl" />
        <Skeleton className="h-3 w-44" />
      </div>
      <div className="mt-8 space-y-4">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-2/3" />
      </div>
      <Skeleton className="mt-8 h-14 w-full rounded-full" />
    </Card>
  );
}

export function MessageCard({
  title,
  body,
  art,
  action,
}: {
  title: string;
  body: string;
  art?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="animate-rise px-6 py-10 text-center sm:px-8">
      <div className="mx-auto flex justify-center">{art ?? <Ticket className="h-24 w-28" float rotate={-6} />}</div>
      <h1 className="mt-6 text-[24px] font-bold tracking-[-0.025em]">{title}</h1>
      <p className="mx-auto mt-2 max-w-[34ch] text-[15px] leading-6 text-muted">{body}</p>
      <div className="mt-6 flex justify-center">
        {action ?? (
          <Button variant="secondary" asChild>
            <Link href="/">What is Tab?</Link>
          </Button>
        )}
      </div>
    </Card>
  );
}
