import { MessageCard } from "@/components/pay/states";
import { PayFooter, SiteHeader } from "@/components/site-chrome";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[440px] px-4 pt-10">
        <MessageCard
          title="Can't find this Tab"
          body="The link might be cut off, ask the sender for it again"
        />
      </main>
      <PayFooter />
    </>
  );
}
