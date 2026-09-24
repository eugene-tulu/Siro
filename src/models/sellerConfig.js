/**
 * Seller configuration model.
 *
 * A seller defines their store once, then the agent runs 24/7.
 * No auctions, no shifts, no idle periods — the agent is the storefront.
 */

export function createSellerConfig(config) {
  const products = (config.products || []).map((p, i) => ({
    id: p.id || `prod-${i + 1}`,
    title: p.title,
    category: p.category || "general",
    description: p.description || "",
    price: Number(p.price) || 0,
    condition: p.condition || "New",
    images: p.images || [],
    cameraAngles: p.cameraAngles || ["front"],
    tags: p.tags || [],
    inStock: p.inStock !== false,
  }));

  if (products.length === 0) {
    throw new Error("Seller config must include at least one product");
  }

  return {
    sellerId: config.sellerId || "seller-001",
    sellerName: config.sellerName || "Siro Seller",
    personality: config.personality || {
      tone: "friendly",
      greeting: "Hey! Welcome to the stream — what are you after today?",
      closing: "Want me to hold that for you?",
    },
    products,
    streamSettings: config.streamSettings || {
      autoShowcaseMs: 12000,
      idleEngagementMs: 8000,
      maxChatPerMinute: 30,
    },
    pricing: config.pricing || {
      strategy: "fixed", // fixed | dynamic | negotiation
      allowNegotiation: false,
      maxDiscountPercent: 10,
    },
    getActiveProduct: () => products.find((p) => p.inStock) || products[0],
    listProducts: () => products,
    getProduct: (id) => products.find((p) => p.id === id),
  };
}