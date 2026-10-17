import { PayFooter, SiteHeader } from "@/components/site-chrome";
import { WalletProviders } from "@/components/wallet/providers";

export default function PayLayout({ children }: LayoutProps<"/">) {
  return (
    <WalletProviders>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-[440px] px-4 sm:max-w-[480px] pt-6 sm:pt-10">
        {children}
      </main>
      <PayFooter />
    </WalletProviders>
  );
}
