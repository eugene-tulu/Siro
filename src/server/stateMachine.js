export function buildAuctionStateMachine({ inventory, ledger, eventBus }) {
  let state = "IDLE";
  let currentItemIndex = 0;
  let itemTimer = null;

  const transitions = {
    IDLE: "SHOWING_ITEM",
    SHOWING_ITEM: ["PROCESSING_CHAT", "SHOWING_ITEM", "END"],
    PROCESSING_CHAT: ["UPDATE_OVERLAY", "SHOWING_ITEM", "PROCESSING_CHAT", "END"],
    UPDATE_OVERLAY: "SHOWING_ITEM",
    END: "IDLE",
  };

  function setState(next) {
    const allowed = transitions[state];
    const valid = Array.isArray(allowed) ? allowed.includes(next) : allowed === next;

    if (!valid) {
      eventBus.emit("log", {
        level: "warn",
        source: "state",
        text: `Invalid transition: ${state} → ${next}`,
      });
      return false;
    }

    state = next;
    eventBus.emit("state_change", { state, activeItem: inventory.getActiveItem() });
    eventBus.emit("log", {
      level: "state",
      source: "state",
      text: `State → ${state}`,
    });
    return true;
  }

  function start() {
    setState("SHOWING_ITEM");
    showNextItem();
  }

  function showNextItem() {
    const items = inventory.list();
    if (currentItemIndex >= items.length) {
      currentItemIndex = 0;
    }

    inventory.setActive(inventory.getFullItem(items[currentItemIndex].id));
    setState("SHOWING_ITEM");

    itemTimer = setTimeout(() => {
      setState("END");
      setTimeout(() => {
        currentItemIndex = (currentItemIndex + 1) % items.length;
        setState("IDLE");
        showNextItem();
      }, 1500);
    }, 8000);
  }

  function onBidReceived() {
    if (itemTimer) clearTimeout(itemTimer);
    setState("PROCESSING_CHAT");
    setTimeout(() => setState("SHOWING_ITEM"), 3000);
  }

  function advanceItem() {
    currentItemIndex = (currentItemIndex + 1) % inventory.list().length;
    if (itemTimer) clearTimeout(itemTimer);
    showNextItem();
  }

  return {
    getState: () => state,
    start,
    onBidReceived,
    advanceItem,
    dispose: () => {
      if (itemTimer) clearTimeout(itemTimer);
    },
  };
}
