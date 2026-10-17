---
format: 1920x1080
duration: 68s
message: "Tab makes PayBox multiplayer: agents settle money between people, verified on Base"
arc: Tension → Reveal → Magic moment (sentence to links to pay page) → How proof works → Range (deals, bets) → Proof stats → Growth → CTA
audience: MoonPay / PayBox hackathon judges and crypto-native builders on X
mode: autonomous
music: warm minimal electronic tech launch, confident, light pulse, uplifting, no vocals
captions: on
---

## Video direction

- **World:** warm off-white canvas #FBFAF9 everywhere, ink #222 type, ONE accent: Tab blue (#1A88F8 highlights, #0E74E0 solid). Sunny #FEBE44 only for the "waiting" pill / tag highlights already present in the real UI. Mint #2CC078 only for success ticks in Frame 7. Frame 7 is the single dark beat (ink #141414 ground) for contrast before the warm close. Soft, layered real shadows on floating UI cards (the product's own card look), a faint blue radial wash in one corner as atmosphere. No purple AI gradients, no bokeh, no grid noise.
- **Type system:** Satoshi 900/700 display (tight tracking, -0.035em), Satoshi 500 body, Geist Mono for every amount, address and link. At most ONE Instrument Serif italic accent word per headline, in Tab blue, only where it adds meaning (e.g. "one *sentence*", "the chain is the *receipt*"). On-screen copy is short motion-graphics copy, never the narration sentence. No em or en dashes, few full stops.
- **Camera language:** one grammar for the whole film: smooth expo-out push-ins (power3/expo.out, long tail), slow lateral parallax between 2 to 3 depth layers, occasional match cut. Nothing bounces. Every non-hero shot under ~4s of unchanged composition; each frame develops across its full duration.
- **Reveal model:** reveal each element on its spoken cue (VO-paced). Never front-load. Hold reads are still (no lazy breathing).
- **Rhythm / held beats:** Frame 2 lands on a short held lockup; Frame 5 ends on a held "receipt" read; Frame 9 is a still-worthy end card held ≥ 2.5s. Everything else keeps content arriving.
- **Muted autoplay:** X autoplays muted. Frame 1's line is fully legible on frame 0 (no fade from black, no logo intro). On-screen kinetic type + captions must carry the story without sound.
- **Caption keep-out:** all content in the top 83% (y ≤ 900).
- **Negative list:** no fabricated UI, numbers or transactions; never show or imply a completed payment, no "Paid" receipt; never draw the USDC logo (the coin uses a generic "$"); no slideshow (front-load then freeze), no screensaver (everything floating independently); no logos of MoonPay/Chainlink/Base drawn by hand (name them in type only).

## Frame 1 — Hook

- scene: Bold two-line hook on warm off-white, legible on frame 0, second line lands with "split a dinner bill" breaking apart
- voiceover: "Agents can trade. They still can't split a dinner bill."
- duration: 3.344s
- transition_in: cut
- status: animated
- src: compositions/frames/01-hook.html
- type: hook
- persuasion: Negative contrast
- beat: curiosity + tension
- blueprint: kinetic-type-beats (Adapt)
- focal: type only
- roles: none
- sfx: soft whoosh
- asset_candidates:

narrativeRole: stop the scroll with a true, slightly absurd contrast.
keyMessage: AI agents can move money for markets, but not between friends.

Adapt: keep the in-place token build; frame 0 already shows a complete legible line (thumbnail-safe), then the payoff line builds.
Scene 1 (0.0–1.4s): FRAME 0 already shows "Agents can trade." huge Satoshi 900 ink, left-aligned on rule-of-thirds upper-left, ~11% canvas height cap. A slow expo-out push-in (scale ~1.0→1.04) runs underneath from t=0. A thin row of three tiny real-looking ticker chips in Geist Mono drifts behind it at low opacity (pure type, e.g. "ETH", "SWAP", "BUY": generic verbs, no prices).
Scene 2 (1.4–3.0s): on "They still can't", line 2 builds word by word below in ink: "They still can't split a dinner bill". "dinner bill" is in Instrument Serif italic Tab blue. Line 1 dims to 35% ink.
Scene 3 (3.0–4.0s): a small receipt glyph (CSS, a torn-edge paper slip with "6.00" in Geist Mono) slides in at right and tears into 3 uneven strips that hang apart, unresolved. Hold.

## Frame 2 — Reveal

- scene: Three.js glossy coin with a generic "$" passes between two glowing agent nodes, then the Tab mark + "Settle up in one sentence" lockup resolves
- voiceover: "This is Tab. It makes PayBox multiplayer."
- duration: 2.978s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/02-reveal.html
- type: product_intro
- persuasion: Curiosity gap resolution
- beat: awe + relief
- blueprint: logo-assemble-lockup (Adapt)
- focal: assets/tab-mark.svg
- roles: tab-mark = supporting (brand lockup) · 3D coin = cutout hero (Three.js canvas)
- sfx: coin chime
- asset_candidates: assets/tab-mark.svg — Tab brand mark, blue gradient rounded square with white T

narrativeRole: name the product and its one-line promise with the premium 3D moment.
keyMessage: Tab = money between agents and people, in one sentence.

Adapt: keep the "mark comes to exist then resolves to a centered lockup" signature; the coin travel is the build.
Scene 1 (0.0–1.8s): Three.js layer (full-bleed transparent canvas over the off-white ground, soft blue radial wash): two agent nodes (frosted glossy spheres, Tab-blue rim light, small "A" and "M" avatar discs as DOM labels under them) sit left-third and right-third at mid-height. A thick glossy coin (gold-cream metal with a pale blue edge, an embossed generic "$" on the face, NOT the USDC logo) arcs from the left node to the right node, spinning on its Y axis, with a faint dotted arc trail. Camera slowly dollies in. All transforms are pure functions of timeline time (seek-safe).
Scene 2 (1.8–2.8s): on "This is Tab", the coin settles above centre and the Tab mark (svg) scales up from behind it; wordmark "Tab" Satoshi 900 appears to its right. Centered lockup, ~40% of frame width.
Scene 3 (2.8–4.0s): on "multiplayer", the tagline builds below: "Settle up in one *sentence*" (sentence in Instrument Serif italic blue). Hold still.
handoff_out: none (clean zoom-through)

## Frame 3 — The agent call

- scene: Designed agent chat window: user prompt types "Split dinner, 6 USDC, with Meera and Aarav", agent calls tab_split and the REAL output streams in, two pay links appear, camera pushes in on Meera's link
- voiceover: "I just tell my agent. Split dinner, six USDC, with Meera and Aarav. Tab hands back a pay link for each of them, with an exact amount it can check on chain."
- duration: 9.796s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-agent-call.html
- type: key_feature
- persuasion: Show-don't-tell proof
- beat: ease + delight
- blueprint: prompt-type-submit-generate (Reproduce)
- focal: hand-built agent chat window (registry "terminal-simulator" was searched; hand-built instead so it matches the Tab card style)
- roles: agent chat window = cutout hero · assets/split-page-mobile.png = supporting (peeks in at right in Scene 4)
- sfx: keyboard typing, soft pop
- asset_candidates: assets/split-page-mobile.png — real split page on mobile, Dinner at Toit 6.00 USDC, Meera 2.003324 and Aarav 2.00042, 0 of 2 paid

narrativeRole: the magic moment, inside 12s of the start: one sentence becomes real links.
keyMessage: one sentence to your agent creates pay links with verifiable exact amounts.

Real output to display faithfully (stylized, text exact):
- user bubble: "Split dinner, 6 USDC, with Meera and Aarav"
- tool chip: "tab_split" · "PayBox"
- header line: "Dinner at Toit · equal · total 6.00 · your share 2.00"
- row: "Meera owes 2.00" · exact "2.003324 USDC" · "tab-pay.vercel.app/r/6O1qqmgPP3pMxOGhvFEy2I"
- row: "Aarav owes 2.00" · exact "2.00042 USDC" · "tab-pay.vercel.app/r/7luP9T5QonboBmpshZqp4F"

Scene 1 (0.0–1.0s): a large floating chat window (white card, soft layered shadow, 3 traffic-light dots, title "Your agent · PayBox") rises into place, asymmetric 60/40 with the window on the left 60%, slightly tilted in 3D (rotateY ~ -6°) settling flat. Empty input with a blinking caret.
Scene 2 (1.0–3.8s): on "Split dinner", the prompt types into the input character by character, then sends: becomes a right-aligned blue user bubble.
Scene 3 (3.8–5.2s): a "tab_split" tool chip appears with a tiny spinner that resolves to a blue tick; header line "Dinner at Toit · equal · total 6.00" fades up.
Scene 4 (5.2–7.6s): on "a pay link for each", the two result rows cascade in (avatar disc M / A, "owes 2.00", exact amount in Geist Mono, link in Tab blue mono). The real split page phone screenshot slides up at the right 40% with parallax, slightly smaller, behind the chat window edge.
Scene 5 (7.6–10.0s): on "exact amount", the camera pushes in (expo-out) toward Meera's row; the "2.003324" highlights with a sunny underline sweep. Hold.
handoff_out: camera ends pushed into Meera's link row (clean cut via zoom-through; no shared element)

## Frame 4 — The pay page

- scene: Real screenshot of Meera's pay page in its waiting state; camera pushes in on "2.00 USDC", then to the tiny tag line; mobile light and dark phones slide in
- voiceover: "Meera opens hers. Two USDC, plus a tiny tag so Tab can spot her payment. She pays from any wallet. No PayBox needed."
- duration: 8.568s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/04-pay-page.html
- type: key_feature
- persuasion: Friction reduction
- beat: ease + trust
- blueprint: device-surface-showcase (Adapt)
- focal: assets/pay-meera-desktop.png
- roles: pay-meera-desktop = hero (full-frame real UI, cropped to the card) · pay-meera-mobile = supporting phone · pay-meera-mobile-dark = supporting phone
- sfx: soft whoosh
- asset_candidates: assets/pay-meera-desktop.png — real pay page desktop, light, 2.00 USDC, tag line, Waiting for Meera; assets/pay-meera-mobile.png — same pay page on mobile light; assets/pay-meera-mobile-dark.png — same pay page on mobile dark

narrativeRole: show the other side of the link: a normal person can pay.
keyMessage: anyone pays from any wallet; the tiny tag makes the payment identifiable.

Adapt: keep "real screens are the hero, camera presents them"; cursorless; stepwise push-ins on regions of ONE real screenshot, then a phone pair.
Scene 1 (0.0–1.6s): the real desktop screenshot fills the frame (card centred), camera starts slightly wide and pushes in (expo-out) toward the card.
Scene 2 (1.6–3.6s): on "Two USDC", camera pushes in tight on the "2.00 USDC" amount block (the real pixels, 2x source so it stays crisp). A small floating label at right in Satoshi 700: "2.00 USDC" is not re-typed; instead a thin blue bracket draws around the amount.
Scene 3 (3.6–5.4s): on "a tiny tag", camera glides down to the line "Plus a tiny 0.003324 tag so Tab can spot your payment"; a sunny highlight sweeps behind "0.003324" (overlay rect at measured position) and the "Waiting for Meera" pill is visible. Never shows any paid state.
Scene 4 (5.4–9.0s): on "any wallet", camera pulls back out to the full card as it shifts left and shrinks to ~45%; two real phones (light and dark mobile screenshots in thin rounded device frames) slide up from below on the right with parallax, slightly overlapping, dark phone in front. Small kinetic label top-right: "Any *wallet*" (wallet in Instrument Serif italic blue) then "No PayBox needed" in muted ink. Hold.

## Frame 5 — How proof works

- scene: Elegant 3-node diagram: unique amount 2.003324 → Base Transfer log → matched to Meera's link; resolves on "the chain is the receipt"
- voiceover: "That tag makes every payment unique. Tab reads Base transfer logs, not a database. The chain is the receipt."
- duration: 7.236s
- transition_in: crossfade
- status: animated
- src: compositions/frames/05-proof.html
- type: how_it_works
- persuasion: Mechanism reveal
- beat: clarity + trust
- blueprint: spatial-pan-stations (Adapt)
- focal: diagram (pure type + vector)
- roles: none
- sfx: soft tick
- asset_candidates:

narrativeRole: explain the one clever mechanism in a single clean diagram.
keyMessage: the unique amount makes the on-chain transfer itself the receipt.

Adapt: keep the single camera traversing pre-placed stations left to right; three stations, one connecting line that draws.
Scene 1 (0.0–2.2s): station 1 at left: a large Geist Mono amount "2.00" + "3324" where the "3324" tail is Tab blue and underlined; label above "unique amount". Camera centred on it, gentle push.
Scene 2 (2.2–4.6s): on "Base transfer logs", camera pans right as a blue line draws to station 2: a stack of three log rows (mono, muted: "Transfer · USDC · Base", amounts like "2.003324", "14.50", "0.99"): the row with 2.003324 lights up blue. Label above "Base Transfer logs". A struck-through small "database" chip fades in muted then strikes.
Scene 3 (4.6–7.5s): on "The chain is the receipt", camera pulls back to show all stations with the line connecting to station 3, a link pill "tab-pay.vercel.app/r/6O1q…" with a blue "matched" dot (NOT "paid"). Headline lands top-centre: "The chain is the *receipt*" (receipt Instrument Serif italic blue). Hold still.

## Frame 6 — Deals and bets

- scene: Two cards weighed side by side: Deals (escrow, pay on delivery, way out) and Bets (both stakes lock, Chainlink settles, live ETH/USD 2415.33)
- voiceover: "And it goes past bills. Deals pay on delivery, and every lock has a way out. Bets lock both stakes, and Chainlink settles them, with proof of the first price after the deadline."
- duration: 10.553s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/06-deals-bets.html
- type: key_feature
- persuasion: Value stacking
- beat: excitement + confidence
- blueprint: comparison-split (Adapt)
- focal: two designed cards (type + vector)
- roles: none
- sfx: soft pop, lock click
- asset_candidates:

narrativeRole: show range beyond bill splitting without faking any transaction.
keyMessage: escrowed deals and Chainlink-settled bets, both trust-minimized.

Adapt: keep mirrored book-open tilts + pill badge pop; cards build their inner steps on cue (each card develops, not static).
Scene 1 (0.0–1.4s): headline top-left: "Past *bills*" (bills Instrument Serif italic blue). Small, then holds as eyebrow.
Scene 2 (1.4–5.0s): on "Deals", the left card enters from the left wing with a book-open tilt: title "Deals", a 3-step mini timeline draws: "Funded" → "Delivered" → "Released", with a padlock icon on the escrow line; on "a way out" a small pill pops: "Refund path if anyone disappears". Ink type, blue line.
Scene 3 (5.0–8.6s): on "Bets", the right card enters from the right wing mirrored: title "Bets", two stake chips lock together into one padlock ("both stakes lock"); then a Chainlink row with a real quote in Geist Mono: "ETH / USD 2,415.33" and caption "Chainlink Data Feeds on Base · live tab_quote". Number counts up to 2415.33 quickly.
Scene 4 (8.6–11.0s): on "first price after the deadline", a pill badge spring-pops on the bets card: "First round after the deadline, proven on chain". Both cards hold, camera slow push.

## Frame 7 — Trust and proof

- scene: The one dark beat: kinetic stat hits: exact-amount approval quote, 124 tests, 100% coverage, Sourcify verified, Checks passed · 10 tools, Simulation passed, Submitted · Ready in PayBox
- voiceover: "Every approval is for the exact amount, never unlimited. A hundred and twenty four tests. Full coverage. Verified on Base, and ready in PayBox."
- duration: 9.404s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/07-trust.html
- type: social_proof
- persuasion: Statistical proof
- beat: trust + confidence
- blueprint: dataviz-countup (Adapt)
- focal: stat type
- roles: none
- sfx: ui click, soft tick, chime
- asset_candidates:

narrativeRole: earn trust from crypto-native judges with verifiable facts.
keyMessage: exact approvals, tested, verified, and accepted into PayBox.

Adapt: dark ground; push THROUGH a sequence of stat beats onto a final status stack.
Scene 1 (0.0–2.6s): dark ink ground #141414. A quote card (subtle dark card, mono): "allow TabEscrow to move exactly 1.00 USDC" with "exactly 1.00 USDC" in blue and a small muted line below "not unlimited · moves no funds by itself". Label: "Step 1 of 2 · deal_create".
Scene 2 (2.6–4.4s): on "a hundred and twenty four tests", camera pushes through the card; giant "124" counts up (Satoshi 900, off-white) with label "Foundry tests".
Scene 3 (4.4–5.8s): on "Full coverage", "100%" replaces it with label "line, branch, function coverage"; a thin ring sweeps to full in mint.
Scene 4 (5.8–9.0s): on "Verified on Base, and ready in PayBox", a vertical stack of 4 status rows cascades in at right with mint ticks, the giant numbers shift left small: "Sourcify verified · TabEscrow v2 0xCe8d…cbCe9", "Checks passed · 10 tools", "Simulation passed", "Submitted · Ready in PayBox". Hold.

## Frame 8 — Growth loop

- scene: A pay link fans out from one node to new friend nodes that each turn into PayBox nodes, a growing network on off-white
- voiceover: "And every link brings someone new into PayBox."
- duration: 3.344s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/08-growth.html
- type: benefits
- persuasion: Future pacing
- beat: aspiration + belonging
- blueprint: constellation-hub (Adapt)
- focal: node network (vector)
- roles: none
- sfx: soft pop
- asset_candidates:

narrativeRole: the business reason: Tab is a growth loop for PayBox.
keyMessage: every shared link onboards a new person.

Adapt: keep nodes springing into a ring around a center; the ring then spawns a second ring (growth).
Scene 1 (0.0–1.4s): centre node: Tab-blue disc with "A" (Adwait). Link lines shoot out to 3 nodes (M, A, plus one more "?" friend).
Scene 2 (1.4–3.0s): on "someone new", each friend node flips from a grey outline into a filled blue node with a tiny "in PayBox" label; each spawns 2 faint new links outward. Headline top-left: "Every link brings *someone new*" (someone new Instrument Serif italic blue).
Scene 3 (3.0–4.0s): camera pulls back slightly showing the network growing. Hold.

## Frame 9 — Close

- scene: The 3D coin returns between the two agent nodes and settles above a still-worthy end card: Tab mark, "Multiplayer money for agents", "Built on PayBox", tab-pay.vercel.app and github.com/AdwaitPro/tab
- voiceover: "Tab. Multiplayer money for agents. Built on PayBox."
- duration: 6.6s
- transition_in: crossfade
- status: animated
- src: compositions/frames/09-close.html
- type: cta
- persuasion: Call to action with brand recall
- beat: confidence + urgency-to-act
- blueprint: logo-assemble-lockup (Adapt)
- focal: assets/tab-mark.svg
- roles: tab-mark = brand lockup · 3D coin = hero cutout (Three.js, same look as Frame 2)
- sfx: coin chime
- asset_candidates: assets/tab-mark.svg — Tab brand mark, blue gradient rounded square with white T

narrativeRole: the screenshot-worthy end card and the ask.
keyMessage: Tab, multiplayer money for agents, at tab-pay.vercel.app.

Adapt: the same Three.js coin as Frame 2 bookends the film; resolves into the lockup.
Scene 1 (0.0–1.6s): the two agent nodes from Frame 2 sit at left and right thirds, smaller; the glossy "$" coin flies in and lands centred above, spinning to a stop facing camera. On "Tab", Tab mark + "Tab" wordmark appear under the coin.
Scene 2 (1.6–3.2s): on "Multiplayer money for agents", the line builds: "Multiplayer *money* for agents" (money Instrument Serif italic blue), Satoshi 900 large.
Scene 3 (3.2–6.0s): on "Built on PayBox", a small pill "Built on PayBox" plus two URL pills in Geist Mono: "tab-pay.vercel.app" (blue, primary) and "github.com/AdwaitPro/tab" (muted). URLs on screen for ≥ 2.5s. Final settle, everything still: a perfect end card.
