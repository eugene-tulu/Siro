# Siro — Live Shop AI

Autonomous AI live shopping agent for sellers who want to sell 24/7.

Built for the **Livepeer Agent Hackathon** (Atumera, Track 1: Livepeer Agent Builder).

## What It Does

Siro is a **24/7 live shopping agent** — not an auction house, not a human host.

A seller defines their products once. Siro runs a continuous live stream that:
- **Showcases products** on a rotating schedule — never goes idle
- **Answers buyer questions** in real time via Jev (typed intent routing)
- **Handles offers and negotiations** with configurable pricing rules
- **Switches camera angles** on demand (holo, back, corners, labels)
- **Generates product scenes** via Livepeer Agent MCP
- **Sells** — confirms sales, tracks revenue, logs everything

No shifts. No burnout. No dead air. The agent is the storefront.

## Architecture

```
Buyer Chat → Jev Router → Seller Agent → Livepeer Agent → Live Stream
     ↓              ↓              ↓
  Decisions    (typed)      Product Showcase
     ↓                             ↓
  Sales Ledger              24/7 Session (always live)
```

## Stack

- **Livepeer Agent MCP** (`/api/mcp/creative`) — video generation + streaming
- **Jev** (`@typesafe-ai/sdk`) — hyper-fast typed chat routing
- **Express + SSE** — real-time observability dashboard
- **Vanilla JS** — zero-build dashboard for hackathon demo

## Quickstart

```bash
cp .env.example .env
# Add TYPESAFE_API_KEY when ready
npm install
npm run demo
# Open http://localhost:3000
```

## Observability

The dashboard surfaces every layer of the agent loop:

- **Live Stream** — current product, price, session uptime
- **Live Chat** — viewer messages + agent responses
- **Product Showcase** — rotation history with product details
- **Jev Decisions** — intent, confidence, visual requests
- **Sales** — completed transactions with buyer, product, amount
- **System Log** — state transitions, camera switches, Livepeer calls
- **Session State** — LIVE / SHOWCASING / ENGAGING / OFFLINE badge

## Demo Mode

Auto-generates buyer messages every 4–6 seconds. No real stream required.

## Configuration

Sellers configure their store once in `src/server/index.js`:

- **Products** — title, price, condition, images, camera angles, tags
- **Personality** — greeting tone, closing line
- **Pricing** — strategy (fixed / dynamic / negotiation), max discount %
- **Stream settings** — showcase interval, idle engagement cadence

## Tests

```bash
npm test
```

23 tests covering seller config, session state machine, sales ledger, and Jev routing heuristics.