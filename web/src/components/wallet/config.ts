import { createConfig, fallback, http } from "wagmi";
import { base } from "wagmi/chains";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { PUBLIC_RPC_URLS } from "@/lib/constants";

const clientRpc = process.env.NEXT_PUBLIC_BASE_RPC_URL?.trim();

/** Base mainnet only. Injected first (Zerion, Rabby, MetaMask, in-app browsers), then Coinbase Wallet. */
export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [injected({ shimDisconnect: true }), coinbaseWallet({ appName: "Tab" })],
  transports: {
    [base.id]: fallback([...(clientRpc ? [http(clientRpc)] : []), ...PUBLIC_RPC_URLS.map((u) => http(u))]),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
