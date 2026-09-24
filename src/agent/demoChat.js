/**
 * Demo chat generator — simulates buyer messages for the live shop.
 *
 * In a real deployment this would connect to TikTok Shop / YouTube / custom
 * chat WebSocket. In demo mode it emits realistic buyer messages every
 * 4–6 seconds so the agent has something to respond to.
 */

const CHAT_MESSAGES = [
  { message: "What's the price on the Charizard?", viewerId: "viewer_1" },
  { message: "Can I see the back of the card?", viewerId: "viewer_2" },
  { message: "Any whitening on the corners?", viewerId: "viewer_3" },
  { message: "I'll do 275 for the jacket", viewerId: "viewer_4" },
  { message: "Does it have the shadowless holo?", viewerId: "viewer_5" },
  { message: "show holo shine please", viewerId: "viewer_6" },
  { message: "I bid 310", viewerId: "viewer_7" },
  { message: "Nice jacket! What size?", viewerId: "viewer_8" },
  { message: "Are the zippers original?", viewerId: "viewer_9" },
  { message: "Sold! Take it for 150", viewerId: "viewer_10" },
];

let index = 0;

export function startDemoChatGenerator(eventBus, options = {}) {
  const intervalMs = options.intervalMs || 4000 + Math.random() * 2000;

  const sendNext = () => {
    const item = CHAT_MESSAGES[index % CHAT_MESSAGES.length];
    eventBus.emit("chat_message", {
      message: item.message,
      viewerId: item.viewerId,
      timestamp: Date.now(),
    });
    index += 1;
  };

  sendNext();
  return setInterval(sendNext, intervalMs);
}