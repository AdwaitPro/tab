# Demo video: script and shot list

**Target: about 90 seconds, 1080p, real time, Adwait's voice, burned-in captions**
Every transaction is real on Base mainnet. Use small amounts and never fake a screen.

## Before recording (about 10 min)
- [ ] Plugin submitted, then enabled in PayBox → Plugins → Unofficial plugins
- [ ] Claude Code open in a large terminal font (Cmd + a few times), connected to `paybox-adwait`
- [ ] Chrome window 1: https://tab-pay.vercel.app (landing), light mode
- [ ] Phone, or a narrow Chrome window with Zerion: plays **Meera**
- [ ] Second agent (optional): claude.ai with the PayBox connector for account `0xadff…`, plays **Aarav's agent**
- [ ] Screen recorder: QuickTime or Screen Studio, mic check
- [ ] Close notifications (Do Not Disturb)

## Script

| Time | Screen | Voice-over (Adwait) |
|---|---|---|
| 0:00 to 0:08 | Landing hero, demo animation playing | "Agents can trade. They still can't split a dinner bill. This is Tab. It makes PayBox multiplayer" |
| 0:08 to 0:20 | Claude Code: type *"Split dinner, 1.5 USDC, with Meera. I paid"* → Tab returns a link | "I just tell my agent. Tab creates a pay link with an exact amount it can verify on-chain" |
| 0:20 to 0:35 | Phone: open the link, show the preview card, connect Zerion, pay, card flips into the PAID receipt | "Meera doesn't need PayBox. She pays from any wallet in two taps, and the receipt is the chain itself" |
| 0:35 to 0:42 | Claude Code: *"Who still owes me?"* → "Meera paid · tx 0x…" | "My agent checks Base, not a database" |
| 0:42 to 1:02 | Claude Code: *"Bet Meera 0.5 USDC ETH is above X at <time>"* → PayBox approval window → passkey → bet page with live price race; Meera joins | "Bets lock both stakes in an ownerless contract. Chainlink settles it, with an on-chain proof of the first price after the deadline, so nobody can game the timing" |
| 1:02 to 1:15 | Claude Code: *"Hire Meera to design a logo, 1 USDC, pay on delivery"* → approve → deal page timeline → delivered → *"release it"* | "Deals pay on delivery. Every lock has a way out, even if someone disappears" |
| 1:15 to 1:25 | Optional: Aarav's separate agent pays a Tab link with a plain PayBox transfer | "Any agent can pay a Tab, even without the plugin" |
| 1:25 to 1:30 | Landing "Live on Base" strip, GitHub, contract | "Every link brings someone new into PayBox. Agents finally have each other. Tab, built on PayBox" |

## Settled bet shot (record separately, then cut in)
Create a price bet with `join_within_hours` about 0.2 and `resolve_at` about 25 minutes out. Meera joins right away. After the deadline, plus up to about 20 minutes for the Chainlink heartbeat, press **Settle** on the bet page. Record the winner being paid.

## X post
> Agents can trade. They still can't split a bill
>
> Meet Tab, multiplayer money for AI agents, built on @PayBox for the MoonPay hackathon
>
> 💸 Split and request with on-chain receipts
> 🤝 Escrowed deals that pay on delivery
> 🎲 Friendly bets settled by Chainlink
>
> Live on Base 👇
> [video] · tab-pay.vercel.app · github.com/AdwaitPro/tab

Before posting, check the official MoonPay and PayBox X handles from their site, and tag those.
