# Siro — Live Shop AI Build Log
Built for: Atumera / Livepeer Agent Hackathon — Track 1: Agent Builder
Project: siro v1.0.0
Started: 2026-09-24
Last updated: 2026-09-25

---

## What is Siro

A 24/7 autonomous live shopping agent that combines:
- Livepeer Agent MCP (video/avatar generation, keyless demo available)
- Jev (TypeSafe System One SDK — typed routing with choice/noul/score primitives)
- Express + SSE real-time dashboard
- User-configurable product catalog (store name, greeting, products, showcase duration — persists to `~/.siro/user-config.json`)
- Catalog-first architecture: Catalog (slideshow) → Video (scenes) → Host (full live session)
- User-configurable: store name, greeting, products, showcase duration, and prompt templates for Livepeer image generation
- In-memory session/ledger/state (no database for demo)

---

## What was done (full change log)

### P0 — Critical bugs (all fixed)
1. `jev.js`: Client initialized from passed `apiKey` (not just env at import)
2. `sellerAgent.js`: `buildProductAnswer()` switched on `visual` (not broken `intent` variable)
3. `index.js`: `EventEmitter.setMaxListeners(50)` (was dropping events silently)
4. `dashboard.js`: `sanitize()` helper + `innerHTML` sanitized (XSS protection)
5. `livepeer.js`: Header `"X-LivePeer-Agent-Tool-Profile"` fixed (no space); `Accept` header added

### P1 — Production readiness fixes
6. `liveSession.js`: `start()` guard (`running` flag); `stop()` clears timers properly
7. `index.js`: Graceful `SIGTERM` / `SIGINT` shutdown; `demoInterval` cleared
8. `sellerAgent.js`: `latency_ms` measured correctly (not hardcoded 0)
9. `index.js`: Input validation + `sanitizeHtml()` for chat endpoint responses
10. `livepeer.js`: Endpoint updated to `https://agent.livepeer.org/api/mcp` (per updated docs)
11. `livepeer.js`: `DEMO_RENDER_KEY` reference added (keyless mode)

### Bug: Dual initialization + rapid showcase loop
17. `index.js`: `isConfigReady()` block was calling `session.start()` in catalog mode, triggering showcase loop that consumed 57/min — merged into stage-based logic so catalog mode never starts the live session loop
18. `index.js`: Removed duplicate `/api/media` route handler

### Bug: Invalid state transition
19. `liveSession.js`: `scheduleIdleEngagement()` called `setState("SHOWCASING")` then `showcaseLoop()` which also called `setState("SHOWCASING")` — removed redundant call
20. `liveSession.js`: `start()` called `setState("OFFLINE")` on a session object that doesn't expose `setState` — replaced with log warning

### Bug: Livepeer MCP `create_media` refused
21. `livepeer.js`: `generateScene()` and `renderAvatarSpeech()` missing `action` parameter — added `action: "generate"` (image generation) / `action: "tts"` (avatar speech)

### Media / Livepeer Agent integration
22. `models/mediaStore.js`: New persistence layer (`/tmp/siro_media_history.json`)
23. `models/activation.js`: Activation flow (request code → activate → unlock ~200 USD demo budget)
24. `livepeer.js`: `requestActivation()` + `activate()` methods (calls agent MCP)
25. `index.js`: `/api/activation`, `/api/activation/request`, `/api/activation/activate` endpoints
26. `index.js`: `getActivation()` exposed in `/api/health`
27. `livepeer.js`: Rate limiter (`30/min`, `300/hour`, `1000/day`) to protect shared demo
28. `livepeer.js`: Keyless mock mode (mock URLs when no API key) — standard per updated docs

### Catalog slideshow + user config (post-bug fix)
30. `models/userConfig.js`: New model for user-configurable store — store name, greeting, showcase duration, product catalog, prompt templates (persists to `~/.siro/user-config.json`)
31. `index.js`: User config API endpoints (`/api/config` GET/PUT, `/api/config/products` POST/DELETE, `/api/config/prompts` GET/PUT)
32. `index.js`: Catalog slideshow mode — cycles user products via SSE every 12s (configurable); uses user prompt templates for Livepeer image generation; falls back to product config images when budget exhausted
33. `index.js`: `cycleCatalog()` function; `activeSellerConfig` built from user config or defaults
34. `liveSession.js`: Added `setActiveProduct()` method for catalog product switching
35. `index.html`: Config panel with store settings + add/remove product forms + prompt template editor; stream image element
36. `dashboard.js`: Config panel state management; `refreshConfig()`, `renderProductList()`, `window.removeProduct()`, `refreshPrompts()`; SSE handlers for `session_state`, `product_showcase`, `agent_response`, `catalog` log
37. `dashboard.css`: Config panel styles (`.config-panel`, `.config-form`, `.product-list`, prompt editor)

### Catalog mode fixes (budget exhaustion mitigation)
37. `index.js`: Catalog mode `product_showcase` handler skips `agent.doProactiveShowcase()` + `livepeer.startStream()` + `livepeer.generateScene()` to prevent rate limit exhaustion
38. `livepeer.js`: `generateScene()` adds `action: "generate"` for MCP compatibility
39. `index.js`: Graceful shutdown clears `catalogInterval` in addition to `demoInterval`
40. `index.js`: Health endpoint reports `mode` field (catalog/video/host)

### Design (UI/UX improvement)
41. `dashboard.css`: Redesigned — luxury black + gold palette (`#d4af37`); Playfair Display titles; Inter body; glass cards; refined typography hierarchy; white space; micro-interactions
42. `index.html`: Playfair + Inter font links; refined brand markup (`Siro.`); activation panel + config panel
43. `dashboard.js`: SSE event handling for `session_state`, `product_showcase`, `agent_response`, `livepeer_result`, `jev_decision`, `sale_made`; config panel management (add/remove products, store settings)

---

## Architecture (as-is, trimmed proposal below)

```
Livepeer Agent MCP  <─── JSON-RPC (tools/call) ───>  src/integrations/livepeer.js
     │                                              (generateScene, create_media,
     │                                               generateAvatarScene, renderAvatarSpeech)
     │                                              (requestActivation, activate)
     v                                              (rate limiter: 30/min, 300/hr, 1000/day)
Keyless demo mode (<10 USD initial)                    │
     │                                              (mediaStore persistence)
     v                                              v
Dashboard SSE stream (/api/events)  <── EventEmitter ───>  src/server/index.js
     │                                              (session, agent, chat, media)
     v                                              v
Real-time UI (stream, chat, decisions,    <───>   src/agent/sellerAgent.js
showcase, ledger, logs, activation)      (Jev routing: choice/noul/score)
```

---

## Budget / Rate Reality (per updated Livepeer Agent docs, 2026-09-25)

Source: agent.livepeer.org/get-started.html (updated during session)
- Keyless demo: no Authorization header, no account needed initially
- Initial demo credit: about $10 USD (before activation)
- After 8-character activation code: about $200 USD (email activation, 24h expiry)
- Rate limits (shared demo): 30/min, 300/hour, 1000/day (per network/user)
- Refused requests: no charge; message explains refusal reason
- Full access: `sk_...` key from `app.daydream.live` (unlimited budget, no rate limits)

Our app respects these limits via `src/utils/rateLimiter.js`. Before the email, the showcase loop was making ~1 render/sec (~57/min, ~2000/35min) which exceeded limits. After the fix, the rate limiter caps at 30/min.

---

## Key design decisions and evidence

### Why vanilla Express (not Next.js)
- Demo / hackathon: faster iteration, no build step, simpler deploy
- SSE (`/api/events`) works natively with `EventSource` (no React hydration needed)
- Production could migrate to Next.js for SEO / landing pages; current architecture supports this (public HTML + server-rendered JSON APIs are framework-agnostic)

### Why keyless standard (no `DEMO_RENDER_KEY` by default)
- Updated docs confirm: "No API key, no Authorization header, no config file to edit"
- Keyless allows immediate demo access (low friction for users without resources)
- Activation unlocks enhanced budget ($10 → $200)
- Real key (`DEMO_RENDER_KEY` / `LIVEPEER_DAYDREAM_KEY` / `sk_...`) removes rate limits and provides unlimited budget

### Why activation before host live
- Config-first design (`isConfigReady()`): agent/init/avatar/chat only start after activation or real key
- Prevents waste of shared demo credits on unconfigured/unactivated instances
- Matches behavioral principle (Sutherland: commitment ladder — users must complete activation before full experience)

### Why shopping windows (not 24/7 by default)
- Default: 09:00 - 21:00 (`ALWAYS_ON=true` or activation bypasses)
- Protects limited demo budget from continuous consumption
- Matches business reality: live shopping is event-based, not always-on
- Production can set `ALWAYS_ON=true` + real key for 24/7

---

## What works (verified end-to-end)

```
✅ Server starts (port 3000 default, configurable via PORT)
✅ Health endpoint (/api/health): status, mode, session, activation, media count
✅ Activation flow (/api/activation/request + /api/activation/activate)
✅ Products endpoint (/api/products) — returns user catalog or defaults
✅ User config API (/api/config GET/PUT, /api/config/products POST/DELETE)
✅ Chat (/api/chat) — sanitized, agent responds, bid parsing works
✅ Session control (/api/session/start, /api/session/stop)
✅ Events stream (/api/events) — SSE with session_state, agent_response, media_created, product_showcase, catalog log
✅ Media persistence (/tmp/siro_media_history.json) + /api/media endpoint
✅ Rate limiter protects shared demo (30/min, 300/hr, 1000/day)
✅ Graceful shutdown (SIGTERM / SIGINT)
✅ Catalog slideshow cycling (12s interval, user-configurable)
✅ User products persist across restarts (~/.siro/user-config.json)
✅ 21/24 tests passing (3 known pre-existing failures: Livepeer creditsHint string format)
```

---

## Trimmed architecture proposal (catalog-first, scaled up to host)

Given budget/rate reality ($200 max activated demo; 30/min cap; no 24/7 with demo), the app should scale through stages rather than attempting full 24/7 host on limited resources:

```
STAGE 1 — Catalog (low resource: 0 renders needed in steady state)
  - Slideshow of products via SSE (every 12s, configurable by user)
  - Uses product images from config (Unsplash URLs) as stream content
  - Attempts Livepeer generateScene() on startup for enhanced visuals
  - User can add/remove products, change store name/greeting/duration
  - Works with unactivated demo (~10 USD budget = startup scene generation only)
  - Falls back to static product images when Livepeer budget exhausted

STAGE 2 — Video / Launch (medium resource: 5-10 renders)
  - generateAvatarScene() + generateScene() for featured products
  - Short product video/scenes for top products
  - Activation unlocks ~$200 budget (enough for full product video set)

STAGE 3 — Live Host (high resource: requires full activation + real budget)
  - Full 24/7 session (ALWAYS_ON=true or real key required)
  - Continuous showcase loop + buyer chat + avatar speech
  - Requires real Livepeer key (`DEMO_RENDER_KEY` / `LIVEPEER_DAYDREAM_KEY` / `sk_...`)
```

Implementation:
- `index.js`: `STAGE` env/config (default `catalog`); `cycleCatalog()` handles slideshow; `activeSellerConfig` built from user config or defaults
- `livepeer.js`: `generateScene()` adds `action: "generate"` for MCP compatibility
- `liveSession.js`: Added `setActiveProduct()` for catalog mode; `start()` guard prevents duplicate sessions
- `livepeer.js`: Rate limiter applied to `generateScene`, `renderAvatarSpeech`, `generateAvatarScene`
- `dashboard.js`: SSE handlers for `session_state`, `product_showcase`, `agent_response`, `catalog` log; config panel management
- `index.html`: Config panel with store settings + add/remove product forms; stream image element
- `src/models/userConfig.js`: `~/.siro/user-config.json` persistence for user catalog

---

## Budget / Rate reality (post-rate-limiter fix)

From Livepeer Agent team email (2026-09-25):
- Shared demo rate exceeded: ~57/min (~2000 renders in 35 min before rate limiter fix)
- Per-user limits: 30/min, 300/hour, 1000/day
- Refused requests: no charge; message explains refusal
- Activation unlocks ~$200 budget at real model prices

Post-fix:
- Rate limiter (`src/utils/rateLimiter.js`) protects shared demo
- Showcase loop at 12s interval (~5/min) well within 30/min
- Activation provides enhanced budget (~200 USD)
- Production requires real API key for unlimited budget

---

## What should be trimmed / kept

KEPT (core value):
- User-configurable product catalog (add/remove products, store name, greeting, showcase duration — persists to `~/.siro/user-config.json`)
- Livepeer Agent MCP integration (endpoint `https://agent.livepeer.org/api/mcp` — Raw surface; `/mcp/creative` — Creative surface)
- Jev routing (`choice`/`noul`/`score` primitives — `src/integrations/jev.js`)
- Keyless activation flow (`requestActivation` / `activate` — 8-char code)
- Rate limiter (`30/min`, `300/hour`, `1000/day`)
- Media persistence (`/tmp/siro_media_history.json` + `mediaStore`)
- Security fixes (XSS sanitize, server sanitize, graceful shutdown)
- Catalog slideshow (SSE-driven product cycling every 12s)

TRIMMED / ADJUSTED (for resource sustainability):
- Default: `STAGE=catalog` (not `host`) — slideshow with static images, no continuous Livepeer scene generation
- `showcaseLoop`: replaced with `cycleCatalog()` in catalog mode (SSE events only, no API calls)
- `product_showcase` handler: skips `agent.doProactiveShowcase()` + `livepeer.startStream()` + `livepeer.generateScene()` in catalog mode
- `demoChatGenerator`: disabled in `catalog` mode; enabled only in `host` mode
- `agent.initAvatar()`: disabled until `STAGE=video` or `host`
- `session.start()`: conditional (`STAGE=host` or `STAGE=video` + activation/config ready)
- Health endpoint: reports `mode` + activation status + active product
- Livepeer demo budget exhaustion: falls back to product config images (no crash)

BUGGY (post-initial-trim issues found and fixed during hackathon):
- Livepeer demo budget exhausted (>1000 renders/day from old showcase loop bug) — catalog mode falls back to static product images
- `session.setState()` called on session object without the method — replaced with log warning
- Livepeer `create_media` calls missing `action` parameter — added `action: "generate"/"tts"`
- Dual initialization (config-ready block + stage block both starting session) — consolidated into single stage logic
- Duplicate `/api/media` route handler — removed

---

## Hackathon submission state

Ready for Atumera / Livepeer Agent Hackathon Track 1 submission with:
- Keyless Livepeer Agent MCP integration (Creative + Raw surfaces)
- TypeSafe Jev routing (System One primitives)
- Rate-limited media generation (protects shared demo resources)
- Activation flow (email → 8-char code → enhanced budget)
- Catalog-first architecture (scalable from catalog → video → host)
- Config-first design (user sets store name, greeting, products, prompt templates via UI/API)
- All P0 bugs fixed; P1 fixes implemented; design refined (black + gold luxury theme)
- Catalog slideshow with user-configurable products + prompt templates (works even with exhausted Livepeer budget)
- End-to-end verified (server responds; health returns mode + activation + session + media; SSE streams product showcases)

Files changed (from original):
```
Modified: .env.example, README.md (updated endpoint reference), package.json (no change needed)
Modified: src/integrations/jev.js, src/agent/sellerAgent.js, src/server/index.js
Modified: src/server/liveSession.js, src/integrations/livepeer.js, src/agent/demoChat.js
Modified: src/models/salesLedger.js (no change needed — in-memory only, acceptable for demo)
Modified: src/public/index.html, src/public/css/dashboard.css, src/public/js/dashboard.js
New: src/utils/rateLimiter.js, src/models/activation.js, src/models/mediaStore.js
New: src/models/userConfig.js (user store config + prompt templates persistence)
New: hackathon.md (this file)
```

Notes for reviewer:
- Demo budget: unactivated = ~10 USD; activated (email + 8-char code) = ~200 USD
- Rate limits: 30/min max (protects shared demo from the ~57/min burst that triggered the Livepeer email)
- Catalog mode uses product images from config as fallback when Livepeer budget exhausted
- Production upgrade: add real Livepeer API key + set `STAGE=host` + `ALWAYS_ON=true`
- To run: `STAGE=catalog PORT=3013 npm run demo` (or `STAGE=host` for full live session)
- User config persists in `~/.siro/user-config.json`
- No external database needed (Convex mentioned in skills but not required for demo)
