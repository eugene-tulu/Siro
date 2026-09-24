const stateBadge = document.getElementById("sessionBadge");
const clock = document.getElementById("uptime");
const itemTitle = document.getElementById("itemTitle");
const itemMeta = document.getElementById("itemMeta");
const bidTicker = document.getElementById("bidTicker");
const chatLog = document.getElementById("chatLog");
const showcaseLog = document.getElementById("showcaseLog");
const decisionLog = document.getElementById("decisionLog");
const ledgerTable = document.getElementById("ledgerTable");
const systemLog = document.getElementById("systemLog");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const btnStop = document.getElementById("btnStop");
const btnStart = document.getElementById("btnStart");

const es = new EventSource("/api/events");

es.onerror = (err) => {
  console.error("SSE error:", err);
  appendLog(systemLog, "error", "sse", `Connection error: ${err.type || "disconnected"}`);
};

function formatUptime(ms) {
  const total = Math.floor(ms / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function setState(state) {
  stateBadge.textContent = state;
  stateBadge.setAttribute("data-state", state);
}

function updatePrice(amount) {
  bidTicker.textContent =
    amount == null ? "Current price: —" : `Current price: $${amount}`;
}

function updateUptime(ms) {
  clock.textContent = formatUptime(ms);
}

es.addEventListener("session_state", (e) => {
  const data = JSON.parse(e.data);
  setState(data.state);
  updateUptime(data.uptime);
  if (data.activeProduct) {
    itemTitle.textContent = data.activeProduct.title;
    itemMeta.textContent = `${data.activeProduct.category} · ${data.activeProduct.condition}`;
    updatePrice(data.activeProduct.price);
  }
});

es.addEventListener("product_showcase", (e) => {
  const data = JSON.parse(e.data);
  const card = document.createElement("div");
  card.className = "showcase-card";
  card.innerHTML = `
    <div class="showcase-title">#${sanitize(String(data.showcaseNumber))} — ${sanitize(data.product.title || "")}</div>
    <div class="showcase-meta">$${sanitize(String(data.product.price || ""))} · ${sanitize(data.product.condition || "")}</div>
  `;
  showcaseLog.prepend(card);
  if (showcaseLog.children.length > 10) showcaseLog.lastChild.remove();
});

es.addEventListener("agent_showcase", (e) => {
  const data = JSON.parse(e.data);
  appendChat("Agent", `Now showcasing: ${data.product.title} — $${data.product.price}`, "bid");
});

es.addEventListener("agent_response", (e) => {
  const data = JSON.parse(e.data);
  appendChat(data.viewerId, data.text, "agent");
});

es.addEventListener("agent_idle_prompt", (e) => {
  const data = JSON.parse(e.data);
  appendChat("Agent", data.text, "agent");
});

es.addEventListener("buyer_engaged", (e) => {
  const data = JSON.parse(e.data);
  appendChat(data.viewerId, data.message, "user");
});

es.addEventListener("sale_made", (e) => {
  const data = JSON.parse(e.data);
  appendChat("Agent", `Sale confirmed! ${data.product} to ${data.viewerId} for $${data.amount}`, "bid");
  refreshSales();
});

es.addEventListener("camera_switch", (e) => {
  const data = JSON.parse(e.data);
  appendLog(systemLog, "camera", "agent", `Camera switched to ${data.angle}`);
});

es.addEventListener("chat_decision", (e) => {
  const data = JSON.parse(e.data);
  const card = document.createElement("div");
  card.className = "decision-card";
  card.innerHTML = `
    <div class="intent">${sanitize(data.result.intent || "")}</div>
    <div class="meta">action: ${sanitize(data.result.action || "")} · confidence: ${(data.result.confidence ? (data.result.confidence * 100).toFixed(0) : "0")}%</div>
    ${data.result.visualIntent && data.result.visualIntent !== "NONE" ? `<div class="visual">visual: ${sanitize(data.result.visualIntent || "")}</div>` : ""}
    <div style="color:#6b7280;margin-top:6px;font-size:11px;">${sanitize(data.message || "")}</div>
  `;
  decisionLog.prepend(card);
  if (decisionLog.children.length > 20) decisionLog.lastChild.remove();
});

es.addEventListener("jev_decision", (e) => {
  const data = JSON.parse(e.data);
  const card = document.createElement("div");
  card.className = "decision-card";
  const answer = data.answer;
  card.innerHTML = `
    <div class="intent">${sanitize(answer.intent?.choice || "heuristic")}</div>
    <div class="meta">latency: ${sanitize(String(data.latency_ms || 0))}ms</div>
  `;
  decisionLog.prepend(card);
  if (decisionLog.children.length > 20) decisionLog.lastChild.remove();
});

es.addEventListener("log", (e) => {
  const data = JSON.parse(e.data);
  appendLog(systemLog, data.level, data.source, data.text);
});

function sanitize(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function appendLog(container, level, source, text) {
  const row = document.createElement("div");
  row.className = "log-entry";
  row.innerHTML = `<span class="level ${sanitize(level)}">${sanitize(level)}</span><span class="source">${sanitize(source)}</span> <span class="text">${sanitize(text)}</span>`;
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;

  appendChat("You", message, "user");
  chatInput.value = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, viewerId: "demo-user" }),
    });
    const data = await res.json();

    if (data.action === "bid") {
      appendChat("Agent", `Offer received: $${data.parsedBid}`, "bid");
    } else if (data.action === "question") {
      appendChat("Agent", `Intent: ${data.intent} → ${data.visualIntent || "no visual request"}`, "question");
    } else {
      appendChat("Agent", `Ignored (${data.intent})`, "ignore");
    }
  } catch (err) {
    appendChat("Agent", `Error: ${err.message}`, "error");
  }
});

function appendChat(name, text, type) {
  const row = document.createElement("div");
  row.className = `chat-message ${type}`;
  row.innerHTML = `<div class="meta">${sanitize(name)}</div><div>${sanitize(text)}</div>`;
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function refreshSales() {
  try {
    const res = await fetch("/api/ledger");
    const data = await res.json();
    renderSales(data);
  } catch {
    // ignore
  }
}

function renderSales(sales) {
  ledgerTable.innerHTML = "";
  if (sales.length === 0) {
    ledgerTable.innerHTML = '<div class="empty">No sales yet.</div>';
    return;
  }
  const head = document.createElement("div");
  head.className = "ledger-row head";
  head.innerHTML = `<div>Buyer</div><div>Product</div><div>Amount</div><div>Time</div>`;
  ledgerTable.appendChild(head);

  sales.slice(-20).reverse().forEach((s) => {
    const row = document.createElement("div");
    row.className = "ledger-row";
    const time = new Date(s.timestamp).toLocaleTimeString();
    row.innerHTML = `<div>${sanitize(s.viewerId || "")}</div><div>${sanitize(s.product || "")}</div><div>$${sanitize(String(s.amount || 0))}</div><div>${sanitize(new Date(s.timestamp).toLocaleTimeString())}</div>`;
    ledgerTable.appendChild(row);
  });
}

btnStop.addEventListener("click", async () => {
  try {
    const res = await fetch("/api/session/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    setState(data.state);
  } catch (err) {
    appendLog(systemLog, "error", "ui", `Stop error: ${err.message}`);
  }
});

btnStart.addEventListener("click", async () => {
  try {
    const res = await fetch("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    setState(data.state);
  } catch (err) {
    appendLog(systemLog, "error", "ui", `Start error: ${err.message}`);
  }
});

setInterval(refreshSales, 2000);
refreshSales();