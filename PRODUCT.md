# Hunch It Narrative

## Core Line

Gen Z already invests by vibe. Hunch It turns each vibe trade into a disciplined proposal.

## Product Promise

Hunch It helps Gen Z investors turn trade ideas from friends, creators, social feeds, or market moves into disciplined trade proposals using AI analysts they choose for their style.

## How Hunch It Works

Hunch It works in two ways:

1. Users can bring trade ideas from friends, creators, or social feeds and have them vetted by AI analysts they choose.
2. Users can choose AI analysts that watch the market and send new proposals.

Both paths end in one disciplined proposal the user controls.

## AI Analysts

Users choose AI analysts that fit their style. Each analyst watches different data sources and uses different trading techniques, so Hunch It can turn a rough idea into one clear disciplined proposal.

## Disciplined Proposal

Every proposal should answer:

- What is the thesis?
- Why now?
- What is the entry or trigger?
- How big should the position be?
- Where should the user take profit?
- Where should the user cut the loss?
- What would make the trade wrong?

## Target Audience

Gen Z investors whose trade ideas come from social feeds, friends, and creators.

More specific version:

Gen Z investors who want to follow trade ideas from friends or creators, but worry they are late, wrong, or becoming exit liquidity.

## Problem Statement

Gen Z investors hear trade ideas and success stories from friends and creators, but when they want to participate, no one helps them verify the claim or figure out the details.

## What Hunch It Does

Hunch It turns "should I follow this trade idea?" into a disciplined proposal the user can review, edit, approve, or skip.

It works in two ways:

1. Users can bring trade ideas from friends, creators, or social feeds and have them vetted by AI analysts they choose.
2. Users can choose AI analysts that watch the market and send new proposals.

## Current Product Status

Hunch It is an alpha PWA for xStocks, tokenized ETF xStocks, and crypto on Solana. The current app supports:

- Home / Desk for portfolio state, proposals, deposit prompts, and open synthetic orders.
- Grill for bringing a supported asset and outside trade idea to selected AI Analysts.
- Team for selecting up to six AI Analysts. The selection currently persists in browser local storage.
- Proposal Detail for reviewing, editing, approving, or skipping a proposal.
- Position Detail and Portfolio for active positions, TP/SL management, manual close, and realized/unrealized P&L.
- Settings for mandate editing, wallet details, and Auto-execute triggers.
- `/dev-tools` for local deterministic proposal and trigger testing.

Mandate setup remains required because it supplies holding period, max drawdown, max trade size, and market focus for sizing and risk controls. The AI Trading Team is a separate product preference, not a replacement for the Mandate.

The market-watch proposal path is opt-in behind `ENABLE_SIGNAL_LOOP=true`. The trigger monitor is part of the default ws-server runtime because approved synthetic Orders need price monitoring even when new proposal generation is disabled.

Current supported proposal assets are `AAPLx`, `NVDAx`, `TSLAx`, `SPYx`, `QQQx`, `GOOGLx`, `METAx`, `wBTC`, `ETH`, `BNB`, `wXRP`, `TRX`, and `HYPE`. `SOL` is wallet fee balance only.

## Brand Personality

Calm, clear, self-custodial. The voice should feel like chosen AI analysts turning rough ideas into plain-English proposals, never hypey financial advice, broker-like persuasion, or "AI alpha" claims.

## Anti-references

Do not look like a dense trading terminal, a bank admin dashboard, or a generic AI landing page. Avoid dark blinking charts, broker custody assumptions, vague "AI alpha" promises, and any copy that implies guaranteed returns.

## Design Principles

- AI analysts chosen for the user's style.
- Friends, creators, and feeds are inputs, not proof.
- Show the trust path.
- One proposal, complete strategy.
- Self-custody as visible confidence.
- Risk controls travel with every trade.
- Mandate controls sizing and risk; it should not crowd out the AI Analyst story.

## Accessibility & Inclusion

English only for current scope. Preserve keyboard navigation, visible focus, reduced-motion support, high contrast, and no dead-end error states. Trading copy must stay explicit about experimental software and financial risk.
