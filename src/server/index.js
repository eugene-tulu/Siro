import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { EventEmitter } from "events";
import { createSellerConfig } from "../models/sellerConfig.js";
import { buildLiveSession } from "./liveSession.js";
import { createSellerAgent } from "../agent/sellerAgent.js";
import { createJevRouter } from "../integrations/jev.js";
import { createLivepeerClient } from "../integrations/livepeer.js";
import { createSalesLedger } from "../models/salesLedger.js";
import { createDashboardStream } from "./dashboardStream.js";
import { startDemoChatGenerator } from "../agent/demoChat.js";
import { createUserConfig } from "../models/userConfig.js";
import { join } from "path";

const app = express();
const server = createServer(app);
const eventBus = new EventEmitter();
eventBus.setMaxListeners(50);

app.use(express.json());
app.use(express.static("src/public"));

// Seller config — define once, agent runs 24/7
const sellerConfig = createSellerConfig({
  sellerId: "seller-001",
  sellerName: "Siro Live Shop",
  personality: {
    tone: "friendly",
    greeting: "Hey! Welcome to the stream — what are you after today?",
    closing: "Want me to hold that for you?",
  },
  products: [
    {
      id: "prod-001",
      title: "1999 Base Set Charizard PSA 9",
      category: "collectible-cards",
      description: "Shadowless holographic rare. Centered, sharp corners, minimal whitening.",
      price: 250,
      condition: "PSA 9 Mint",
      images: ["https://images.unsplash.com/photo-1613771404784-3a5686aa2be3?w=1200&q=80"],
      cameraAngles: ["front", "back", "holo_angle", "corner_detail"],
      tags: ["charizard", "psa9", "shadowless"],
    },
    {
      id: "prod-002",
      title: "1980s Members Only Jacket — Vintage",
      category: "vintage-fashion",
      description: "Iconic 80s terry-cloth Members Only jacket. Fully zippered, original tags.",
      price: 120,
      condition: "Excellent",
      images: ["https://images.unsplash.com/photo-1551028719-00167b16eac5?w=1200&q=80"],
      cameraAngles: ["front", "back", "label_detail"],
      tags: ["vintage", "jacket", "80s"],
    },
    {
      id: "prod-003",
      title: "Liquidation Electronics Lot (10 units)",
      category: "electronics",
      description: "Mixed lot of 10 returned tablets and e-readers. Untested, sold AS-IS.",
      price: 180,
      condition: "Untested / AS-IS",
      images: ["https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=1200&q=80"],
      cameraAngles: ["front", "side", "ports"],
      tags: ["electronics", "liquidation", "lot"],
    },
  ],
  pricing: {
    strategy: "negotiation",
    allowNegotiation: true,
    maxDiscountPercent: 10,
  },
});

// Core services
const jevRouter = createJevRouter({
  apiKey: process.env.TYPESAFE_API_KEY,
  eventBus,
});

const livepeer = createLivepeerClient({
  apiKey: process.env.DEMO_RENDER_KEY || process.env.LIVEPEER_DAYDREAM_KEY,
  eventBus,
  persistPath: join(process.cwd(), ".livepeer-activation.json"),
});

const salesLedger = createSalesLedger();
const userConfig = createUserConfig();

// If user has configured their own products, use them; otherwise use defaults
let effectiveProducts = sellerConfig.listProducts();
if (userConfig.hasUserProducts()) {
  const userProducts = userConfig.getConfig().products.map((p, i) => ({
    ...p,
    id: p.id || `prod-${i + 1}`,
    inStock: p.inStock !== false,
  }));
  if (userProducts.length > 0) {
    effectiveProducts = userProducts;
  }
}

// Build a seller config that may use user overrides
const activeSellerConfig = createSellerConfig({
  sellerId: "seller-001",
  sellerName: userConfig.getConfig().storeName,
  personality: {
    greeting: userConfig.getConfig().greeting,
    closing: "Want me to hold that for you?",
  },
  products: effectiveProducts,
  streamSettings: {
    autoShowcaseMs: userConfig.getConfig().showcaseDuration,
    idleEngagementMs: 8000,
    maxChatPerMinute: 30,
  },
});

const session = buildLiveSession({ sellerConfig: activeSellerConfig, eventBus });
const agent = createSellerAgent({ sellerConfig: activeSellerConfig, eventBus, jevRouter, livepeer });
let demoInterval = null;

// Record sales when the agent confirms them
eventBus.on("sale_made", (data) => {
  salesLedger.record(data);
});

// Wire session events to agent actions
eventBus.on("product_showcase", (data) => {
  // In catalog mode, just display the product; don't hit Livepeer API
  if (STAGE === "catalog") {
    eventBus.emit("agent_showcase", {
      product: data.product,
      timestamp: Date.now(),
    });
    eventBus.emit("log", {
      level: "catalog",
      source: "catalog",
      text: `Now displaying: ${data.product.title} — $${data.product.price}`,
    });
    return;
  }
  agent.doProactiveShowcase(data.product);
  livepeer.startStream({ product: data.product });
  // Generate product scene media for the showcase (using user prompt template)
  const showcasePrompt = userConfig.getPrompt("showcaseScene");
  const prompt = userConfig.interpolatePrompt(showcasePrompt, data.product);
  livepeer.generateScene({
    prompt,
    product: data.product,
  }).catch(() => {}); // non-blocking; errors logged by livepeer client
});

eventBus.on("agent_idle_prompt", (data) => {
  eventBus.emit("agent_response", {
    viewerId: "agent",
    text: `Still thinking about the ${data.product.title}? $${data.product.price} — let me know if you want a closer look.`,
    timestamp: Date.now(),
  });
});

// Wire buyer chat to agent
eventBus.on("chat_message", (chat) => {
  session.onBuyerMessage(chat);
  agent
    .handleBuyerMessage(chat.message, chat.viewerId)
    .catch((err) => {
      eventBus.emit("log", {
        level: "error",
        source: "agent",
        text: `Agent error: ${err.message}`,
      });
    });
});

// Graceful shutdown (configured once, used by all stages)
const connections = new Set();
server.on("connection", (conn) => {
  connections.add(conn);
  conn.on("close", () => connections.delete(conn));
});

function gracefulExit(signal) {
  console.log(`${signal} received — shutting down gracefully`);
  session.dispose();
  if (demoInterval) clearInterval(demoInterval);
  if (catalogInterval) clearInterval(catalogInterval);
  for (const conn of connections) conn.destroy();
  server.close(() => process.exit(0));
  setTimeout(() => {
    console.log("Force exit — graceful shutdown exceeded timeout.");
    process.exit(1);
  }, 3000);
}

process.on("SIGTERM", gracefulExit);
process.on("SIGINT", gracefulExit);

// Config/activation must be ready before agent host goes live.
if (!isConfigReady()) {
  console.log("Config/activation not complete. Agent host stays offline until activated.");
  eventBus.emit("log", {
    level: "warn",
    source: "system",
    text: "Agent host offline: activation/config not complete. Visit /api/activation to activate.",
  });
}

// --- API ---

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    mode: STAGE,
    seller: sellerConfig.sellerName,
    sessionState: session.getState(),
    uptime: session.getUptime(),
    activeProduct: session.getActiveProduct(),
    showcaseCount: session.getShowcaseCount(),
    streamStatus: livepeer.getStreamStatus(),
    avatar: livepeer.getAvatarState(),
    totalSales: salesLedger.total(),
    mediaCount: livepeer.getMediaHistory ? livepeer.getMediaHistory().length : 0,
    latestMedia: livepeer.getLatestMedia ? livepeer.getLatestMedia() : null,
    activation: livepeer.getActivation ? livepeer.getActivation() : null,
  });
});

app.get("/api/activation", (req, res) => {
  res.json(livepeer.getActivation());
});

app.post("/api/activation/request", async (req, res) => {
  try {
    const result = await livepeer.requestActivation(req.body?.email);
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message, ...livepeer.getActivation() });
  }
});

app.post("/api/activation/activate", async (req, res) => {
  try {
    const result = await livepeer.activate(req.body?.code);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message, ...livepeer.getActivation() });
  }
});

app.get("/api/seller", (req, res) => {
  res.json({
    sellerId: activeSellerConfig.sellerId,
    sellerName: activeSellerConfig.sellerName,
    personality: activeSellerConfig.personality,
    pricing: activeSellerConfig.pricing,
    streamSettings: activeSellerConfig.streamSettings,
    productCount: activeSellerConfig.listProducts().length,
  });
});

app.get("/api/products", (req, res) => {
  res.json(activeSellerConfig.listProducts());
});

app.get("/api/products/active", (req, res) => {
  res.json(session.getActiveProduct());
});

function sanitizeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

app.post("/api/chat", async (req, res) => {
  const { message, viewerId } = req.body;

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }

  const result = await agent.handleBuyerMessage(message, viewerId || "anon");
  if (result && result.text) {
    result.text = sanitizeHtml(result.text);
  }
  res.json(result || { action: "ignored", message: "No response generated" });
});

app.get("/api/media", (req, res) => {
  res.json(livepeer.getMediaHistory());
});

app.get("/api/events", (req, res) => {
  createDashboardStream(req, res, eventBus);
});

app.get("/api/sales", (req, res) => {
  res.json(salesLedger.history());
});

app.post("/api/session/stop", (req, res) => {
  session.stop();
  res.json({ state: session.getState() });
});

app.post("/api/session/start", (req, res) => {
  session.start();
  res.json({ state: session.getState() });
});

// --- User config API ---
app.get("/api/config", (req, res) => {
  const cfg = userConfig.getConfig();
  res.json({
    storeName: cfg.storeName,
    greeting: cfg.greeting,
    showcaseDuration: cfg.showcaseDuration,
    theme: cfg.theme,
    productCount: cfg.products.length,
    products: cfg.products,
    hasUserProducts: userConfig.hasUserProducts(),
    configPath: userConfig.configPath,
    prompts: cfg.prompts || {},
  });
});

app.put("/api/config", (req, res) => {
  const body = req.body || {};
  const allowed = ["storeName", "greeting", "showcaseDuration", "theme"];
  const updates = {};
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  try {
    const updated = userConfig.updateConfig(updates);
    res.json({ ok: true, config: updated });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post("/api/config/products", (req, res) => {
  const product = req.body;
  if (!product || !product.title) {
    return res.status(400).json({ ok: false, message: "Product title is required" });
  }
  const created = userConfig.addProduct(product);
  res.status(201).json({ ok: true, product: created });
});

app.delete("/api/config/products/:id", (req, res) => {
  const removed = userConfig.removeProduct(req.params.id);
  res.json({ ok: removed });
});

app.delete("/api/config/products", (req, res) => {
  userConfig.clearProducts();
  res.json({ ok: true });
});

// --- Prompt templates ---
app.get("/api/config/prompts", (req, res) => {
  const cfg = userConfig.getConfig();
  res.json(cfg.prompts || {});
});

app.put("/api/config/prompts", (req, res) => {
  const body = req.body || {};
  const allowed = ["catalogImage", "showcaseScene", "avatarPrompt", "noImageFallback"];
  const updates = {};
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  try {
    const cfg = userConfig.getConfig();
    cfg.prompts = { ...(cfg.prompts || {}), ...updates };
    userConfig.updateConfig({ prompts: cfg.prompts });
    res.json({ ok: true, prompts: cfg.prompts });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

// Shopping windows: default 09:00 - 21:00 (not 24/7) to respect limited demo credits
function isWithinShoppingWindow() {
  const now = new Date();
  const hour = now.getHours();
  const start = 9;  // 09:00
  const end = 21;   // 21:00
  const alwaysOn = process.env.ALWAYS_ON === "true" || livepeer.getActivation?.().activated === true;
  return alwaysOn || (hour >= start && hour < end);
}

function formatWindowStatus() {
  const now = new Date();
  const hour = now.getHours();
  return isWithinShoppingWindow() ? "OPEN" : "CLOSED (next window 09:00)";
}

// Config/activation must be ready before agent host goes live
function isConfigReady() {
  const activation = livepeer.getActivation ? livepeer.getActivation() : null;
  const hasKey = !!(process.env.DEMO_RENDER_KEY || process.env.LIVEPEER_DAYDREAM_KEY);
  return !!(activation?.activated || hasKey);
}

// STAGE-BASED ARCHITECTURE (trimmed for demo sustainability)
const STAGE = process.env.STAGE || "catalog"; // catalog | video | host

let catalogInterval = null;
const catalogProducts = activeSellerConfig.listProducts().filter((p) => p.inStock);
let catalogIndex = 0;

function cycleCatalog() {
  if (catalogProducts.length === 0) return;
  const product = catalogProducts[catalogIndex];
  catalogIndex = (catalogIndex + 1) % catalogProducts.length;
  session.setActiveProduct(product);

  eventBus.emit("session_state", {
    state: "SHOWCASING",
    activeProduct: product,
    uptime: session.getUptime(),
    showcaseCount: session.getShowcaseCount(),
  });
  eventBus.emit("product_showcase", {
    product,
    showcaseNumber: catalogIndex + 1,
  });
}

if (STAGE === "catalog") {
  console.log(`Siro (catalog mode) — slideshow of ${catalogProducts.length} products. Activation/status: ${isConfigReady() ? "READY" : "PENDING"}`);
  // Catalog mode: attempt Livepeer scene generation with user prompt template; fall back to config images
  const catalogPrompt = userConfig.getPrompt("catalogImage");
  for (const product of catalogProducts) {
    const prompt = userConfig.interpolatePrompt(catalogPrompt, product);
    livepeer.generateScene({ prompt, product })
      .catch((err) => {
        eventBus.emit("log", { level: "warn", source: "catalog", text: `Scene generation skipped or refused: ${err.message}` });
      });
  }
  // Cycle showcase every N seconds (configurable via user config)
  const showcaseMs = activeSellerConfig.streamSettings?.autoShowcaseMs || 12000;
  catalogInterval = setInterval(cycleCatalog, showcaseMs);
  cycleCatalog();
} else if (STAGE === "video" || STAGE === "host") {
  console.log(`Siro (${STAGE} mode) — full session. Activation/status: ${isConfigReady() ? "READY" : "PENDING"}`);
  if (isConfigReady()) {
    agent.initAvatar();
    if (STAGE === "host") {
      demoInterval = startDemoChatGenerator(eventBus);
    }
    if (isWithinShoppingWindow()) {
      session.start();
    } else {
      console.log(`Shopping window closed (${formatWindowStatus()}). Session stays OFFLINE until next open window.`);
    }
  } else {
    eventBus.emit("log", { level: "warn", source: "system", text: "Agent host offline: activation/config not complete. Visit /api/activation to activate." });
  }
} else {
  console.log(`Unknown STAGE: ${STAGE} — defaulting to catalog mode.`);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Siro running at http://localhost:${PORT}`);
  console.log(`Seller: ${activeSellerConfig.sellerName} — ${activeSellerConfig.listProducts().length} products — STAGE=${STAGE}`);
  console.log(`Config: ${userConfig.hasUserProducts() ? "Using custom user config" : "Using default catalog"}`);
  console.log(`Activation: ${livepeer.getActivation ? (livepeer.getActivation().activated ? "ACTIVATED" : "PENDING") : "NONE"}`);
  console.log(`Window: ${formatWindowStatus()}`);
});