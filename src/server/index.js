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
});

const salesLedger = createSalesLedger();

const session = buildLiveSession({ sellerConfig, eventBus });
const agent = createSellerAgent({ sellerConfig, eventBus, jevRouter, livepeer });

// Record sales when the agent confirms them
eventBus.on("sale_made", (data) => {
  salesLedger.record(data);
});

// Wire session events to agent actions
eventBus.on("product_showcase", (data) => {
  agent.doProactiveShowcase(data.product);
  livepeer.startStream({ product: data.product });
  // Generate product scene media for the showcase
  livepeer.generateScene({
    prompt: `Showcase ${data.product.title}`,
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

// Start the session — never goes idle
session.start();

// Initialize avatar host after session starts
agent.initAvatar();

let demoInterval = startDemoChatGenerator(eventBus);

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received — shutting down gracefully");
  session.dispose();
  clearInterval(demoInterval);
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  console.log("SIGINT received — shutting down gracefully");
  session.dispose();
  clearInterval(demoInterval);
  server.close(() => process.exit(0));
});

// --- API ---

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
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
  });
});

app.get("/api/seller", (req, res) => {
  res.json({
    sellerId: sellerConfig.sellerId,
    sellerName: sellerConfig.sellerName,
    personality: sellerConfig.personality,
    pricing: sellerConfig.pricing,
    streamSettings: sellerConfig.streamSettings,
    productCount: sellerConfig.listProducts().length,
  });
});

app.get("/api/products", (req, res) => {
  res.json(sellerConfig.listProducts());
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Siro running at http://localhost:${PORT}`);
  console.log(`Seller: ${sellerConfig.sellerName} — ${sellerConfig.listProducts().length} products — 24/7 agent live`);
});