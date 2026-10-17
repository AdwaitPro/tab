# Fonts

| Font | Use | Source | License |
|---|---|---|---|
| Satoshi 400/500/700/900 | Display, UI, big amounts (tabular figures) | Fontshare (Indian Type Foundry), files in `src/fonts/` and `assets/fonts/` (OG images) | ITF Free Font License (FFL): free for personal and commercial use, including web embedding. Fontshare's license page could not be fetched by script at build time; re-confirm at https://www.fontshare.com/licenses before a public launch |
| Instrument Serif Italic | One or two expressive words in headlines only | Google Fonts via `next/font/google` (self-hosted at build) | SIL Open Font License 1.1 |
| Geist Mono | Addresses, hashes, exact amounts | Google Fonts via `next/font/google` (self-hosted at build) | SIL Open Font License 1.1 |
| Geist Sans | OG image fallback text | `assets/fonts/` copied from the `geist` npm package | SIL Open Font License 1.1 |

All fonts are served from our own origin (no third-party font requests at runtime) with `font-display: swap` and preload.
