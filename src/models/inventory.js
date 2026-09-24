const ITEMS = [
  {
    id: "item-001",
    title: "1999 Base Set Charizard PSA 9",
    category: "collectible-cards",
    description:
      "Shadowless holographic rare. Centered, sharp corners, minimal whitening. One of the most sought-after Pokémon cards.",
    startingBid: 250,
    currentBid: 250,
    condition: "PSA 9 Mint",
    images: [
      "https://images.unsplash.com/photo-1613771404784-3a5686aa2be3?w=1200&q=80",
    ],
    cameraAngles: ["front", "back", "holo_angle", "corner_detail"],
  },
  {
    id: "item-002",
    title: "1980s Members Only Jacket — Vintage",
    category: "vintage-fashion",
    description:
      "Iconic 80s terry-cloth Members Only jacket. Fully zippered, original tags, no visible damage.",
    startingBid: 120,
    currentBid: 120,
    condition: "Excellent",
    images: [
      "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=1200&q=80",
    ],
    cameraAngles: ["front", "back", "label_detail"],
  },
  {
    id: "item-003",
    title: " liquidation electronics lot (10 units)",
    category: "electronics",
    description:
      "Mixed lot of 10 returned tablets and e-readers. Untested, sold AS-IS. Great for parts or refurb.",
    startingBid: 180,
    currentBid: 180,
    condition: "Untested / AS-IS",
    images: [
      "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=1200&q=80",
    ],
    cameraAngles: ["front", "side", "ports"],
  },
];

let activeItem = ITEMS[0];

let currentBidByItem = {};

export function createInventory() {
  return {
    list: () => ITEMS.map(({ id, title, category, startingBid }, i) => ({
      id,
      title,
      category,
      startingBid,
      currentBid: currentBidByItem[id] ?? startingBid,
    })),
    getFullItem: (id) => ITEMS.find((i) => i.id === id),
    getActiveItem: () => {
      const base = ITEMS.find((i) => i.id === activeItem.id);
      if (!base) return null;
      return { ...base, currentBid: currentBidByItem[activeItem.id] ?? base.startingBid };
    },
    setActive: (item) => {
      if (!item || !item.id || !ITEMS.find((i) => i.id === item.id)) {
        throw new Error(`Invalid item passed to setActive: ${JSON.stringify(item)}`);
      }
      activeItem = {
        id: item.id,
        title: item.title,
        category: item.category,
        condition: item.condition,
        images: item.images,
        startingBid: item.startingBid,
        cameraAngles: item.cameraAngles,
        description: item.description,
      };
    },
    setItemBid: (itemId, amount) => {
      currentBidByItem[itemId] = amount;
    },
    advance: () => {
      const idx = ITEMS.findIndex((i) => i.id === activeItem.id);
      const nextBase = ITEMS[(idx + 1) % ITEMS.length];
      const next = {
        id: nextBase.id,
        title: nextBase.title,
        category: nextBase.category,
        condition: nextBase.condition,
        images: nextBase.images,
        startingBid: nextBase.startingBid,
        cameraAngles: nextBase.cameraAngles,
        description: nextBase.description,
      };
      activeItem = next;
      return activeItem;
    },
  };
}
