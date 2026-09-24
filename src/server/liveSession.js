/**
 * Continuous live session.
 *
 * Unlike an auction state machine (IDLE → SHOWING → PROCESSING → END → IDLE),
 * a live session is ALWAYS ON. It cycles products, showcases them, handles
 * buyer chat reactively, and never sleeps.
 *
 * States:
 *   LIVE          — stream is running, agent is engaging
 *   SHOWCASING    — actively presenting a product
 *   ENGAGING      — responding to buyer chat
 *   OFFLINE       — session ended (only on explicit stop)
 */

export function buildLiveSession({ sellerConfig, eventBus, clock = Date.now }) {
  let state = "LIVE";
  let currentProduct = sellerConfig.getActiveProduct();
  let showcaseTimer = null;
  let engagementTimer = null;
  let sessionStart = clock();
  let showcaseCount = 0;

  const transitions = {
    LIVE: ["SHOWCASING", "ENGAGING", "OFFLINE"],
    SHOWCASING: ["LIVE", "ENGAGING", "OFFLINE"],
    ENGAGING: ["LIVE", "SHOWCASING", "OFFLINE"],
    OFFLINE: ["LIVE"],
  };

  function setState(next) {
    const allowed = transitions[state];
    const valid = Array.isArray(allowed) ? allowed.includes(next) : allowed === next;

    if (!valid) {
      eventBus.emit("log", {
        level: "warn",
        source: "session",
        text: `Invalid transition: ${state} → ${next}`,
      });
      return false;
    }

    state = next;
    eventBus.emit("session_state", {
      state,
      activeProduct: currentProduct,
      uptime: clock() - sessionStart,
      showcaseCount,
    });
    eventBus.emit("log", {
      level: "state",
      source: "session",
      text: `Session → ${state}`,
    });
    return true;
  }

  let running = false;

  function start() {
    if (running) return;
    running = true;
    if (state === "OFFLINE") {
      setState("LIVE");
    }
    if (state !== "LIVE") {
      setState("LIVE");
    }
    showcaseLoop();
  }

  function showcaseLoop() {
    if (state === "OFFLINE") return;

    const nextProduct = pickNextProduct();
    currentProduct = nextProduct;
    showcaseCount += 1;

    setState("SHOWCASING");
    eventBus.emit("product_showcase", {
      product: currentProduct,
      showcaseNumber: showcaseCount,
    });

    const settings = sellerConfig.streamSettings;
    const duration = settings.autoShowcaseMs || 12000;

    showcaseTimer = setTimeout(() => {
      setState("LIVE");
      scheduleIdleEngagement();
    }, duration);
  }

  function pickNextProduct() {
    const products = sellerConfig.listProducts().filter((p) => p.inStock);
    if (products.length === 0) return currentProduct;
    if (products.length === 1) return products[0];

    const others = products.filter((p) => p.id !== currentProduct.id);
    return others[Math.floor(Math.random() * others.length)];
  }

  function scheduleIdleEngagement() {
    if (state === "OFFLINE") return;

    const settings = sellerConfig.streamSettings;
    engagementTimer = setTimeout(() => {
      if (state === "OFFLINE") return;

      eventBus.emit("agent_idle_prompt", {
        product: currentProduct,
        timestamp: clock(),
      });

      // Re-enter showcase after idle engagement
      setState("SHOWCASING");
      showcaseLoop();
    }, settings.idleEngagementMs || 8000);
  }

  function onBuyerMessage(message) {
    if (state === "OFFLINE") return;

    setState("ENGAGING");
    eventBus.emit("buyer_engaged", {
      message,
      product: currentProduct,
      timestamp: clock(),
    });

    // Return to showcase loop after engaging
    setTimeout(() => {
      if (state !== "OFFLINE") {
        showcaseLoop();
      }
    }, 4000);
  }

  function stop() {
    running = false;
    if (showcaseTimer) clearTimeout(showcaseTimer);
    if (engagementTimer) clearTimeout(engagementTimer);
    showcaseTimer = null;
    engagementTimer = null;
    setState("OFFLINE");
  }

  function dispose() {
    stop();
  }

  return {
    getState: () => state,
    getActiveProduct: () => currentProduct,
    start,
    onBuyerMessage,
    stop,
    dispose,
    getUptime: () => clock() - sessionStart,
    getShowcaseCount: () => showcaseCount,
  };
}