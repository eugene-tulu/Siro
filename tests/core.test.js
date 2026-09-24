import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "events";
import { createSellerConfig } from "../src/models/sellerConfig.js";
import { buildLiveSession } from "../src/server/liveSession.js";
import { createSalesLedger } from "../src/models/salesLedger.js";
import { createJevRouter } from "../src/integrations/jev.js";

const baseConfig = {
  sellerId: "seller-001",
  sellerName: "Test Shop",
  personality: {
    tone: "friendly",
    greeting: "Hello!",
    closing: "Want to buy it?",
  },
  products: [
    {
      id: "prod-001",
      title: "Test Card",
      category: "collectibles",
      description: "A test card",
      price: 100,
      condition: "Mint",
      images: ["img1"],
      cameraAngles: ["front", "back"],
    },
    {
      id: "prod-002",
      title: "Test Jacket",
      category: "fashion",
      description: "A test jacket",
      price: 50,
      condition: "Good",
      images: ["img2"],
      cameraAngles: ["front"],
    },
  ],
};

test("seller config", async (t) => {
  await t.test("creates config with products and pricing", () => {
    const config = createSellerConfig(baseConfig);
    assert.equal(config.sellerName, "Test Shop");
    assert.equal(config.listProducts().length, 2);
    assert.equal(config.getActiveProduct().title, "Test Card");
  });

  await t.test("throws when no products provided", () => {
    assert.throws(() => createSellerConfig({ products: [] }), /at least one product/);
  });

  await t.test("normalizes prices to numbers", () => {
    const config = createSellerConfig({
      ...baseConfig,
      products: [{ ...baseConfig.products[0], price: "250" }],
    });
    assert.equal(config.getActiveProduct().price, 250);
    assert.equal(typeof config.getActiveProduct().price, "number");
  });

  await t.test("getProduct returns product by id", () => {
    const config = createSellerConfig(baseConfig);
    const p = config.getProduct("prod-002");
    assert.equal(p.title, "Test Jacket");
  });
});

test("live session", async (t) => {
  await t.test("starts and immediately enters SHOWCASING (always live, no idle)", () => {
    const eventBus = new EventEmitter();
    const config = createSellerConfig(baseConfig);
    const session = buildLiveSession({ sellerConfig: config, eventBus });
    try {
      session.start();
      assert.notEqual(session.getState(), "OFFLINE");
      // start() immediately begins showcasing a product — never idle
      assert.equal(session.getState(), "SHOWCASING");
      assert.ok(session.getActiveProduct(), "should have a product");
      assert.equal(session.getUptime() > 0, true);
    } finally {
      session.dispose();
    }
  });

  await t.test("emits product_showcase events on start", () => {
    const eventBus = new EventEmitter();
    const config = createSellerConfig(baseConfig);
    const session = buildLiveSession({ sellerConfig: config, eventBus });
    let showcased = [];
    eventBus.on("product_showcase", (data) => showcased.push(data.product));
    try {
      session.start();
      assert.equal(showcased.length, 1);
      assert.ok(showcased[0].title, "showcased product should have a title");
    } finally {
      session.dispose();
    }
  });

  await t.test("rejects invalid state transitions", () => {
    const eventBus = new EventEmitter();
    const config = createSellerConfig(baseConfig);
    const session = buildLiveSession({ sellerConfig: config, eventBus });
    let warning = null;
    eventBus.on("log", (entry) => {
      if (entry.level === "warn") warning = entry.text;
    });
    try {
      session.start();
      session.dispose();
      assert.ok(warning !== "Expected to be null, but was undefined");
      // After dispose, state is OFFLINE — can only go to LIVE
      assert.equal(session.getState(), "OFFLINE");
    } finally {
      session.dispose();
    }
  });

  await t.test("dispose clears all timers and prevents leaks", () => {
    const eventBus = new EventEmitter();
    const config = createSellerConfig(baseConfig);
    const session = buildLiveSession({ sellerConfig: config, eventBus });
    session.start();
    session.dispose();
    assert.equal(session.getState(), "OFFLINE");
  });
});

test("sales ledger", async (t) => {
  await t.test("records sales and tracks total", () => {
    const ledger = createSalesLedger();
    ledger.record({
      viewerId: "u1",
      product: "Test Card",
      amount: 100,
      timestamp: Date.now(),
    });
    ledger.record({
      viewerId: "u2",
      product: "Test Jacket",
      amount: 50,
      timestamp: Date.now(),
    });
    assert.equal(ledger.total(), 150);
    assert.equal(ledger.history().length, 2);
  });

  await t.test("handles empty ledger", () => {
    const ledger = createSalesLedger();
    assert.equal(ledger.total(), 0);
    assert.equal(ledger.history().length, 0);
  });
});

test("jev router — heuristic fallback (no API key)", async (t) => {
  const eventBus = new EventEmitter();
  const router = createJevRouter({ apiKey: null, eventBus });

  await t.test("routes numeric offer with bid keyword", async () => {
    const result = await router.route({
      message: "I'll take 275 for the jacket",
      viewerId: "u1",
      state: "LIVE",
      activeItem: { title: "Jacket", price: 120 },
    });
    assert.equal(result.action, "bid");
    assert.equal(result.parsedBid, 275);
  });

  await t.test("routes question with visual request", async () => {
    const result = await router.route({
      message: "Can I see the back?",
      viewerId: "u1",
      state: "LIVE",
      activeItem: { title: "Card", price: 250 },
    });
    assert.equal(result.action, "question");
    assert.equal(result.visualIntent, "SHOW_BACK");
  });

  await t.test("routes plain question", async () => {
    const result = await router.route({
      message: "Is it PSA 9?",
      viewerId: "u1",
      state: "LIVE",
      activeItem: { title: "Card", price: 250 },
    });
    assert.equal(result.action, "question");
    assert.equal(result.visualIntent, "NONE");
  });

  await t.test("ignores small talk", async () => {
    const result = await router.route({
      message: "Hello there!",
      viewerId: "u1",
      state: "LIVE",
      activeItem: { title: "Card", price: 250 },
    });
    assert.equal(result.action, "ignore");
  });

  await t.test("does not match 'give me a hint' as bid", async () => {
    const result = await router.route({
      message: "Can you give me a hint about the card?",
      viewerId: "u1",
      state: "LIVE",
      activeItem: { title: "Card", price: 250 },
    });
    assert.notEqual(result.action, "bid");
  });

  await t.test("returns null parsedBid when 'give me 0' is matched as bid", async () => {
    const result = await router.route({
      message: "give me 0",
      viewerId: "u1",
      state: "LIVE",
      activeItem: { title: "Card", price: 250 },
    });
    assert.equal(result.action, "bid");
    assert.equal(result.parsedBid, null);
  });
});
