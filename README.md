# Moral Switch

**The trolley problem, judged by Jev.** A browser-only laboratory that puts classic trolley-problem dilemmas — and your own — to Jev (`typesafe/jev-1.13`), Pollinations' fast decision model that answers with calibrated probabilities instead of essays.

**Try it:** https://sugamdeol.github.io/moral-switch/

[![Made with pollinations.ai](https://raw.githubusercontent.com/pollinations/pollinations/main/packages/ui/src/brand/badge-made-with.svg)](https://pollinations.ai/?ref=badge)

## What it does

- **Eight classic situations** — the switch, the driver's switch, ten against one, family on the side track, you on the side track, the footbridge, the loop, the transplant surgeon — plus a **custom builder** where you write the dilemma in your own words.
- **Three Jev primitives per verdict**, all in one `POST /alpha/decisions` call:
  - **The choice** — pull vs stay with full probabilities and confidence;
  - **The conscience** — a `noul` yes/no probability ("is this permissible?");
  - **The scale** — a 0–100 moral-acceptability score with its legend and histogram.
- **The reversal test** — re-runs the same verdict with the options presented in the opposite order, so you can see for yourself whether Jev's pick flips with presentation (the headline finding of Zach Landes' [Jev Meets the Trolley Problem](https://zachlandes.com/trolley-problem/)).
- **Your move** — after the verdict, you actually pull the lever (or don't) on an animated track diagram. The ledger tracks every verdict and how often you and Jev agree.

## Who pays

Sign-in is [Bring your own Pollen](https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md) — the standard OAuth authorization-code flow with PKCE. You approve a budget on the consent screen; each verdict costs about **0.0001 Pollen**, billed to *your* balance. The app is a static page: it has no backend, never sees a secret key beyond your own browser session, and stores nothing. Note: Jev verdicts are billed from paid Pollen.

## Run locally

```bash
python -m http.server 8080
# open http://localhost:8080
```

No build step, no dependencies. To test the full sign-in flow locally, add `http://localhost:8080/` as a Redirect URI on the app key.

## Endpoints used

- `POST https://gen.pollinations.ai/alpha/decisions` — typed decisions (choice / noul / score)
- `https://enter.pollinations.ai/authorize` + `/api/oauth/token` — BYOP OAuth code flow + PKCE
- `https://enter.pollinations.ai/api/oauth/userinfo`, `GET https://gen.pollinations.ai/account/balance` — who signed in, current balance
