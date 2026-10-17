"use client";

import { MessageCard } from "@/components/pay/states";
import { Button } from "@/components/ui/button";

export default function PayError({ reset }: { error: Error; reset: () => void }) {
  return (
    <MessageCard
      title="Something went wrong"
      body="Nothing was sent from your wallet"
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
