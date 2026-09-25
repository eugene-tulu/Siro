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
const activationPanel = document.getElementById("activationPanel");
const activationStatus = document.getElementById("activationStatus");
const activationRequestForm = document.getElementById("activationRequestForm");
const activationRedeemForm = document.getElementById("activationRedeemForm");
const activationEmail = document.getElementById("activationEmail");
const activationCode = document.getElementById("activationCode");

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

const streamImage = document.getElementById("streamImage");
const streamPlaceholder = document.getElementById("streamPlaceholder");

function updateStreamImage(url) {
  if (streamImage && url) {
    streamImage.src = url;
    streamImage.style.display = "block";
    if (streamPlaceholder) streamPlaceholder.style.display = "none";
  } else {
    if (streamImage) streamImage.style.display = "none";
    if (streamPlaceholder) streamPlaceholder.style.display = "block";
  }
}

es.addEventListener("media_created", (e) => {
  const data = JSON.parse(e.data);
  if (data.url && streamImage) {
    updateStreamImage(data.url);
  }
});

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
  updateUptime(data.uptime || 0);
  if (data.activeProduct) {
    itemTitle.textContent = data.activeProduct.title;
    itemMeta.textContent = `${data.activeProduct.category} · ${data.activeProduct.condition}`;
    updatePrice(data.activeProduct.price);
    // Show product image from seller config if no media yet
    if (data.activeProduct.images && data.activeProduct.images.length > 0) {
      updateStreamImage(data.activeProduct.images[0]);
    } else {
      updateStreamImage(null);
    }
  } else {
    itemTitle.textContent = "Loading catalog…";
    itemMeta.textContent = "";
    updatePrice(null);
    updateStreamImage(null);
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

// Load latest media on startup for catalog/slideshow view
fetch("/api/media")
  .then((res) => res.json())
  .catch(() => []);

setInterval(refreshSales, 2000);
refreshSales();
refreshActivation();

function renderActivation(data) {
  if (!activationPanel || !data) return;
  activationPanel.dataset.mode = data.keyless ? "keyless" : "keyed";
  activationPanel.dataset.activated = data.activated ? "true" : "false";
  if (!data.keyless) {
    activationStatus.textContent = "Using a Livepeer API key — email activation is skipped.";
    return;
  }
  if (data.activated) {
    activationStatus.textContent = data.lastMessage || "Activated — about $200 of demo rendering on this server IP.";
    return;
  }
  const hint = data.email
    ? `Code sent to ${data.email}. Paste it below (check spam). Unactivated keyless credit is about $10.`
    : "No API key: request a Livepeer activation code to raise demo credits from about $10 to about $200.";
  activationStatus.textContent = data.lastMessage || hint;
}

async function refreshActivation() {
  try {
    const res = await fetch("/api/activation");
    renderActivation(await res.json());
  } catch (err) {
    if (activationStatus) activationStatus.textContent = `Activation status unavailable: ${err.message}`;
  }
}

activationRequestForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = activationEmail.value.trim();
  if (!email) return;
  activationStatus.textContent = "Sending code…";
  try {
    const res = await fetch("/api/activation/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    renderActivation(data);
    if (!res.ok) activationStatus.textContent = data.message || "Could not send a code.";
  } catch (err) {
    activationStatus.textContent = err.message;
  }
});

activationRedeemForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = activationCode.value.trim();
  if (!code) return;
  activationStatus.textContent = "Activating…";
  try {
    const res = await fetch("/api/activation/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    renderActivation(data);
    if (!res.ok) activationStatus.textContent = data.message || "That code did not work.";
    if (data.ok) activationCode.value = "";
  } catch (err) {
    activationStatus.textContent = err.message;
  }
});

// --- User config ---
const configPanel = document.getElementById("configPanel");
const configStatus = document.getElementById("configStatus");
const storeConfigForm = document.getElementById("storeConfigForm");
const configStoreName = document.getElementById("configStoreName");
const configGreeting = document.getElementById("configGreeting");
const configShowcaseDuration = document.getElementById("configShowcaseDuration");
const promptPanel = document.getElementById("promptStatus");
const promptForm = document.getElementById("promptForm");
const promptCatalog = document.getElementById("promptCatalog");
const promptShowcase = document.getElementById("promptShowcase");
const promptAvatar = document.getElementById("promptAvatar");
const addProductForm = document.getElementById("addProductForm");
const productList = document.getElementById("productList");

async function refreshConfig() {
  if (!configPanel || !configStatus) return;
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    configPanel.dataset.hasProducts = data.hasUserProducts ? "true" : "false";
    configStatus.textContent = data.hasUserProducts
      ? `${data.products.length} custom product(s) · ${data.showcaseDuration}ms showcase`
      : "Using default catalog";
    configStoreName.value = data.storeName;
    configGreeting.value = data.greeting;
    configShowcaseDuration.value = data.showcaseDuration;
    renderProductList(data.products);
  } catch (err) {
    configStatus.textContent = "Config unavailable";
  }
}

async function refreshPrompts() {
  if (!promptPanel || !promptForm) return;
  try {
    const res = await fetch("/api/config/prompts");
    const prompts = await res.json();
    promptCatalog.value = prompts.catalogImage || "";
    promptShowcase.value = prompts.showcaseScene || "";
    promptAvatar.value = prompts.avatarPrompt || "";
    promptPanel.textContent = "Customize your AI image generation prompts";
  } catch (err) {
    promptPanel.textContent = "Could not load prompts";
  }
}

promptForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const res = await fetch("/api/config/prompts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        catalogImage: promptCatalog.value.trim() || undefined,
        showcaseScene: promptShowcase.value.trim() || undefined,
        avatarPrompt: promptAvatar.value.trim() || undefined,
      }),
    });
    if (res.ok) {
      appendLog(systemLog, "config", "ui", "Prompt templates saved.");
    }
  } catch (err) {
    appendLog(systemLog, "error", "ui", `Prompt error: ${err.message}`);
  }
});

function renderProductList(products) {
  if (!productList) return;
  productList.innerHTML = "";
  if (products.length === 0) {
    productList.innerHTML = '<div class="empty">No custom products yet.</div>';
    return;
  }
  products.forEach((p) => {
    const card = document.createElement("div");
    card.className = "showcase-card";
    card.innerHTML = `
      <div class="showcase-title">${sanitize(p.title || "")}</div>
      <div class="showcase-meta">$${sanitize(String(p.price || 0))} · ${sanitize(p.condition || "")}</div>
      <button onclick="window.removeProduct('${p.id}')" style="margin-top:4px;font-size:10px;">Remove</button>
    `;
    productList.appendChild(card);
  });
}

window.removeProduct = function(id) {
  fetch(`/api/config/products/${id}`, { method: "DELETE" })
    .then(() => refreshConfig())
    .catch(() => {});
};

storeConfigForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const updates = {
    storeName: configStoreName.value.trim() || undefined,
    greeting: configGreeting.value.trim() || undefined,
    showcaseDuration: configShowcaseDuration.value ? Number(configShowcaseDuration.value) : undefined,
  };
  try {
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      appendLog(systemLog, "config", "ui", "Store configuration saved. Restart server to apply.");
    }
  } catch (err) {
    appendLog(systemLog, "error", "ui", `Config error: ${err.message}`);
  }
});

addProductForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("productTitle").value.trim();
  const price = document.getElementById("productPrice").value;
  const image = document.getElementById("productImage").value.trim();
  const description = document.getElementById("productDescription").value.trim();
  if (!title) return;
  try {
    const res = await fetch("/api/config/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        price: Number(price) || 0,
        images: image ? [image] : [],
        description,
      }),
    });
    if (res.ok) {
      addProductForm.reset();
refreshConfig();
refreshPrompts();
    }
  } catch (err) {
    appendLog(systemLog, "error", "ui", `Product error: ${err.message}`);
  }
});

refreshConfig();