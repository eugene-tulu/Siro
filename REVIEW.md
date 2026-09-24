# Siro Codebase Review — Demo + Production Readiness
Project: `siro` v1.0.0 | Path: `.` | Date: 2026-09-24
Tests: 20/20 passing | Runtime: Node (ES modules)

---

## 1. EXECUTIVE SUMMARY
The codebase implements a 24/7 live-shopping agent using:
- **Livepeer Agent MCP** (video/avatar generation)
- **Jev / TypeSafe SDK** (`@typesafe-ai/sdk` 0.6.0) for typed intent routing
- **Express + SSE** real-time dashboard
- **In-memory** session/ledger/state (no DB)

**Verdict:** Architecture is sound for a hackathon demo (event bus pattern, clean separation, passing tests). **Not production-ready** due to critical bugs in the Jev router, XSS vulnerabilities, dead code, missing shutdown handling, and lack of persistence/auth.

---

## 2. CRITICAL BUGS (Block Production / Break Demo)

### 2.1 Jev Router — API Key Ignored (`src/integrations/jev.js`)
**File:** `src/integrations/jev.js:1-10, 10-11`
**Issue:** The `client` is initialized at module import time from `process.env.TYPESAFE_API_KEY`. `createJevRouter({ apiKey })` receives `apiKey`, but `enabled` checks the global `client`, not the passed `apiKey`. If the env var wasn't set at module import time, passing an API key to the router does **nothing** — Jev falls back to heuristics permanently.

**Fix:** Initialize the client inside `createJevRouter` using the passed `apiKey`, or re-instantiate when `apiKey` is provided.
```js
export function createJevRouter({ apiKey, eventBus }) {
  const client = apiKey ? new TypeSafeClient({ apiKey }) : null;
  const enabled = Boolean(client);
  // ...
}
```

---
### 2.2 Agent Response Switch Uses Wrong Variable (`src/agent/sellerAgent.js`)
**File:** `src/agent/sellerAgent.js:149-178`
**Issue:** `buildProductAnswer` does `switch (intent)` where `intent` is always `"QUESTION"`. The cases (`"SHOW_HOLO_ANGLE"`, `"SHOW_BACK"`, etc.) are `visualIntent` values, so the `switch` never hits a matching case — it always falls through to the `default` branch (`return \`${product.title}: ...\``), ignoring the visual request the user asked for.

**Fix:** Switch on `visual` (the `visualIntent` value), not `intent`.
```js
switch (visual) {
  case "SHOW_HOLO_ANGLE": return `...`;
  // ...
  default: return `...`;
}
```

---
### 2.3 Event Emitter Max Listeners (`src/server/index.js` + `dashboardStream.js`)
**File:** `src/server/dashboardStream.js:13-35`, `src/server/index.js`
**Issue:** `EventEmitter` defaults to `10` max listeners. `dashboardStream.js` attaches ~19 `eventBus.on(...)` handlers. Combined with `index.js` listeners, this triggers `MaxListenersExceededWarning` and drops events silently.

**Fix:** `const eventBus = new EventEmitter(); eventBus.setMaxListeners(50);`

---
### 2.4 XSS via InnerHTML (`src/public/js/dashboard.js`)
**File:** `src/public/js/dashboard.js:multiple`
**Issue:** User-controlled chat messages (`message` from `buyer_engaged`) are injected via `innerHTML` without sanitization. A malicious buyer message like `<img src=x onerror=alert('XSS')>` executes in the dashboard.

**Fix:** Use `textContent` instead of `innerHTML` for message body, or sanitize input on server (`message.replace(/</g, '&lt;')`).

---
### 2.5 Memory Leak — Demo Chat Interval (`src/agent/demoChat.js`, `src/server/index.js`)
**File:** `src/agent/demoChat.js:39`, `src/server/index.js:146`
**Issue:** `startDemoChatGenerator` returns a `setInterval` that is never stored, cleared, or disposed of. The server will leak timers on reload/restart.

**Fix:** Store the interval handle in `index.js` and clear it in a `SIGTERM` handler.

---
### 2.6 Live Session Double-Loop Risk (`src/server/liveSession.js`)
**File:** `src/server/liveSession.js:35-82`
**Issue:** `start()` calls `showcaseLoop()` unconditionally. If `start()` is called twice (e.g., via `/api/session/start`), two `showcaseTimer` loops run concurrently.

**Fix:** Guard `start()` against duplicate loops:
```js
function start() {
  if (showcaseTimer || state !== "OFFLINE") return; // or check a running flag
  // ...
}
```

---
## 3. ARCHITECTURE / DESIGN ISSUES

### 3.1 Dead Code — Auction State Machine (`src/server/stateMachine.js`)
**File:** `src/server/stateMachine.js`
**Status:** Not imported by `index.js`. `inventory.js` is also unused. The README mentions an "auction", but the live session (`liveSession.js`) is the active model. Remove dead files or integrate them. Clean repo = faster review, less confusion.

---
### 3.2 Unused Inventory Model (`src/models/inventory.js`)
Same as above — `createInventory()` is never called. `sellerConfig` maintains its own product list.

---
### 3.3 No Graceful Shutdown (`src/server/index.js`)
**File:** `src/server/index.js:175-180`
**Issue:** No `SIGTERM` / `SIGINT` handler. Active timers (`showcaseTimer`, `engagementTimer`, `demoChatGenerator`) and SSE connections will hang.

**Fix:**
```js
process.on('SIGTERM', () => {
  session.dispose();
  clearInterval(demoInterval);
  server.close(() => process.exit(0));
});
```

---
### 3.4 Latency Measurement is Broken (`src/agent/sellerAgent.js`)
**File:** `src/agent/sellerAgent.js:58-63`
**Issue:** `latency_ms: 0` is hardcoded in the `jev_decision` event emission. It should measure `Date.now() - receivedAt` (which is set in `route()` in `jev.js` but isn't propagated back properly).

**Fix:** Return `latency_ms` from `jevRouter.route()` or compute it in the agent using `Date.now()` before/after `await`.

---
### 3.5 Sales Ledger Has No DB Sync (`src/models/salesLedger.js`)
**File:** `src/models/salesLedger.js:8-27`
**Status:** In-memory array. Acceptable for demo; for production, add a `convex` or `postgres` sync layer. The README says "In demo mode it's in-memory" — document this clearly.

---
## 4. SECURITY GAPS (Production Blockers)

| Issue | File / Line | Severity | Fix |
|---|---|---|---|
| No input validation / sanitization on `/api/chat` | `src/server/index.js:134-145` | High | Validate message length; sanitize output; reject non-string payloads |
| No rate limiting on `/api/chat` or `/api/events` | `src/server/index.js` | High | Add `express-rate-limit` or a simple in-memory rate limiter |
| No auth on session start/stop | `src/server/index.js:154-167` | Medium | Require a seller token (`SELLER_API_KEY`) for state-changing endpoints |
| Env vars loaded but not validated | `.env.example` / `dotenv/config` | Low | Add `if (!process.env.TYPESAFE_API_KEY) console.warn(...)` or a startup check |
| No HTTPS headers / CORS policy | `src/server/index.js` | Low | Add `helmet`, `cors` config for production deploy |
| No Content Security Policy | `src/public/index.html` | Low | Add `<meta http-equiv="Content-Security-Policy" ...>` for demo |

---
## 5. LIVEPEER AGENT INTEGRATION REVIEW

**File:** `src/integrations/livepeer.js`

### 5.1 Endpoint Accuracy
**Status:** The base URL (`https://agent.livepeer.org/api/mcp/creative`) and payload format (`jsonrpc: 2.0`, `method: tools/call`, `name: generate_media` / `create_media`, `arguments.model_override`) align with the Livepeer Agent MCP pattern found in docs/research. **This is plausible.**

### 5.2 Tool Names
- `generate_media` with `video-to-video` — plausible for avatar scene generation.
- `create_media` with `flux-schnell` — plausible for product imagery.
- `chat` with `tts-sonic` — plausible for avatar speech.

**Recommendation:** Confirm these exact tool names against the deployed Livepeer Agent MCP contract (`tools/list`). If `video-to-video` isn't registered, the call will fail. Add a `try/catch` and emit `error` events (already present — good).

### 5.3 Timeout Handling
**Status:** `30s` abort timeout (`src/integrations/livepeer.js:35-60`). Good. Ensure `clearTimeout` is always called (`finally` block — present — good).

### 5.4 No Retry / Backoff
**Status:** Single attempt. For production, add exponential backoff for 5xx or timeout errors.

---
## 6. JEV (TYPESAFE) INTEGRATION REVIEW

**File:** `src/integrations/jev.js`

### 6.1 SDK Usage
**Status:** Uses `TypeSafeClient`, `choice`, `noul`, `score`. Based on `@typesafe-ai/sdk` 0.6.0 docs, this matches the SDK contract. The `systemOne` method name aligns with docs.

### 6.2 Question Design
**Status:** Questions (`intent`, `is_valid_bid`, `comedic_intensity`, `visual_request`) are well-structured. This is a good use of System One (typed routing, not generation).

### 6.3 Confidence Interpretation
**Status:** The code uses `confidence: answer.is_valid_bid.noul` (noul = yes/no probability). Per TypeSafe docs, `noul` returns a probability, not a confidence score. A `noul` of 0.8 means 80% yes probability. The code treats it as a confidence metric — **acceptable for routing heuristics**, but document that `noul` is probability, not calibrated confidence like `choice.confidence`.

### 6.4 State Construction
**Status:** The `stateText` joins lines manually. Per TypeSafe docs (`system-one.md`), the `state` parameter accepts unstructured text. The format used (`"Active item: ..."`, `"Item category: ..."`) is acceptable, but structured JSON fields in `state` (e.g., `state: { activeItem: ... }`) could improve model accuracy. **Not a blocker.**

---
## 7. DEMO READINESS

| Requirement | Status | Notes |
|---|---|---|
| `npm start` / `npm run demo` works | ✅ | Starts server on port 3000 |
| Dashboard loads (`index.html`) | ✅ | Clean design, responsive grid |
| Auto-buyer messages (`demoChat.js`) | ✅ | Every 4-6s |
| Live stream placeholder visible | ✅ | CSS animations present |
| Product rotation (`liveSession.js`) | ✅ | Auto-showcase loop |
| Real-time SSE updates (`/api/events`) | ✅ | Event bus wired |
| Chat form submits to `/api/chat` | ✅ | Basic POST endpoint |
| Sales tracked (`salesLedger`) | ✅ | In-memory, visible in dashboard |

**Gaps for a polished demo:**
- The avatar speech (`tts-sonic`) and video (`video-to-video`) are stubs — no actual audio/video is produced unless the Livepeer API key is valid and the tools exist.
- No "streaming" URL is embedded in the dashboard (the `stream-frame` shows only a placeholder).
- The `startDemoChatGenerator` doesn't stop when the session stops.

---
## 8. PRODUCTION READINESS CHECKLIST

| Category | Requirement | Status |
|---|---|---|
| **Persistence** | Database for products, sales, session history | ❌ In-memory only |
| **Auth** | Seller auth, buyer identity | ❌ None |
| **Observability** | Structured logging (`pino`/`winston`), metrics | ⚠️ Event bus logs only |
| **Monitoring** | Health checks for Livepeer + Jev APIs | ⚠️ `/api/health` has basic info |
| **Deployment** | Dockerfile, `pm2` / `systemd` config | ❌ Not present |
| **Testing** | Unit + integration tests (`convex-test`) | ✅ 20 unit tests |
| **Error Handling** | Retry logic, circuit breakers, graceful degradation | ❌ Minimal |
| **Security** | Input validation, rate limits, XSS protection, CSP | ❌ Missing |
| **Performance** | Connection pooling, memory profiling, load testing | ❌ Not done |

---
## 9. RECOMMENDED FIX PRIORITY

### P0 — Fix Before Any Production Use
1. Fix Jev router `client` initialization (`jev.js`).
2. Fix `buildProductAnswer` switch variable (`sellerAgent.js`).
3. Add `setMaxListeners(50)` (`index.js`).
4. Fix XSS in dashboard (`dashboard.js`) + sanitize server responses (`sellerAgent.js`).

### P1 — Fix Before Public Demo
5. Guard `start()` against duplicate loops (`liveSession.js`).
6. Clear demo chat interval properly; add `SIGTERM` handler (`index.js`).
7. Remove dead code (`stateMachine.js`, `inventory.js`) or document why they exist.
8. Fix latency measurement (`sellerAgent.js`).

### P2 — Production Hardening
9. Add rate limiting (`express-rate-limit`).
10. Add seller auth token (`SELLER_API_KEY`).
11. Add database persistence (Convex / Postgres / Mongo).
12. Add retry/backoff to Livepeer and Jev clients.
13. Add structured logging and health checks.
14. Add Docker / deploy config.

---
## 10. WHAT WORKS WELL
- **Clean event bus pattern:** `EventEmitter` separates session, agent, dashboard, and integrations cleanly.
- **Type-safe model design:** `sellerConfig`, `createSalesLedger`, `createInventory` use factory functions with clear interfaces.
- **Test coverage:** 20 passing tests cover config, session, ledger, and Jev heuristics.
- **No external build step:** Vanilla JS dashboard (`public/`) — fast demo load.
- **Modular integrations:** `livepeer.js` and `jev.js` are isolated; easy to swap or mock.

---
## 11. REFERENCES / EVIDENCE FROM WEB SEARCH
- **Livepeer Agent MCP:** Confirmed `generate_media`, `create_media`, `chat` tool patterns; base URL `agent.livepeer.org` aligns with docs (`livepeer.org/blog/livepeer-2-0-video-agent-platform`).
- **TypeSafe Jev SDK (`@typesafe-ai/sdk` 0.6.0):** Confirmed `TypeSafeClient`, `systemOne`, `choice`, `noul`, `score` primitives (`github.com/typesafe-ai/typesafe-sdk-js`, `github.com/enterpilot/gomodel`).
- **Jev confidence semantics:** `noul` = probability (not calibrated confidence); `choice.confidence` = distribution concentration (`docs.typesafe.ai/confidence`).
