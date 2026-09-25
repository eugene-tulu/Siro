/**
 * Livepeer Agent MCP — creative surface (keyless demo or Bearer key).
 *
 * Keyless: request_activation (email) then activate (code) from this process's IP.
 * https://agent.livepeer.org/get-started.html
 */

import { createMediaStore } from "../models/mediaStore.js";
import { createActivationState } from "../models/activation.js";
import { createRateLimiter } from "../utils/rateLimiter.js";

const CREATIVE_MCP_URL = "https://agent.livepeer.org/api/mcp/creative";

function extractText(payload) {
  const content = payload?.result?.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => part?.text || part?.data?.url || "")
      .filter(Boolean)
      .join("\n");
  }
  if (payload?.error?.message) return payload.error.message;
  return "";
}

function extractUrl(payload, text) {
  const content = payload?.result?.content?.[0];
  const direct = content?.data?.url || content?.text;
  if (typeof direct === "string" && /^https?:\/\//.test(direct.trim())) {
    return direct.trim();
  }
  const structured = payload?.result?.structuredContent;
  const fromStructured =
    structured?.url || structured?.asset_url || structured?.image_url || structured?.audio_url;
  if (typeof fromStructured === "string" && /^https?:\/\//.test(fromStructured)) {
    return fromStructured;
  }
  const match = String(text || "").match(/https?:\/\/[^\s)"']+/);
  return match ? match[0] : null;
}

function isToolError(payload) {
  if (payload?.error) return true;
  if (payload?.result?.isError) return true;
  return false;
}

async function parseMcpBody(response) {
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (!raw.trim()) {
    throw new Error("Livepeer MCP empty response");
  }
  if (contentType.includes("event-stream") || raw.startsWith("event:") || raw.startsWith("data:")) {
    const chunks = [];
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        const chunk = line.slice(5).trim();
        if (chunk && chunk !== "[DONE]") chunks.push(chunk);
      }
    }
    if (chunks.length === 0) {
      throw new Error(`Livepeer MCP SSE had no data: ${raw.slice(0, 200)}`);
    }
    return JSON.parse(chunks[chunks.length - 1]);
  }
  return JSON.parse(raw);
}

export function createLivepeerClient({
  apiKey,
  eventBus,
  fetchFn = fetch,
  persistPath,
} = {}) {
  const mediaStore = createMediaStore({ eventBus });
  const activation = createActivationState({ persistPath });
  const rateLimiter = createRateLimiter({ eventBus });
  const keyless = !apiKey;
  const baseUrl = CREATIVE_MCP_URL;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let activeOverlay = "front";
  let currentScene = null;
  let streamStatus = "offline";
  let avatarState = {
    active: false,
    personality: null,
    lastSpeech: null,
  };

  const AVATAR_BASE_PROMPT =
    "AI-generated 3D virtual host for live shopping, friendly expression, professional studio lighting, green screen background";

  async function rpc(method, params, { timeoutMs = 30000 } = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method,
          params,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Livepeer MCP ${response.status}: ${text.slice(0, 400)}`);
      }

      return parseMcpBody(response);
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(`Livepeer MCP request timed out after ${timeoutMs / 1000}s`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function callTool(name, args, options) {
    const payload = await rpc("tools/call", { name, arguments: args }, options);
    if (isToolError(payload)) {
      throw new Error(extractText(payload) || "Livepeer tool error");
    }
    return payload;
  }

  async function requestActivation(email) {
    const trimmed = String(email || "").trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      throw new Error("A valid email is required");
    }

    const payload = await callTool("request_activation", { email: trimmed }, { timeoutMs: 20000 });
    const message =
      extractText(payload) ||
      `Check your inbox at ${trimmed} for your Livepeer Agent activation code.`;
    activation.markRequested(trimmed, message);
    eventBus?.emit("log", {
      level: "livepeer",
      source: "livepeer",
      text: `Activation code requested for ${trimmed}`,
    });
    const savedCode = activation.getCode ? activation.getCode() : null;
    return { ok: true, message, code: savedCode, ...activation.snapshot({ keyless }) };
  }

  async function activate(code) {
    const trimmed = String(code || "").trim().toUpperCase();
    if (!trimmed) {
      throw new Error("Activation code is required");
    }

    const payload = await callTool("activate", { code: trimmed }, { timeoutMs: 20000 }).catch(() => null);
    const structured = payload?.result?.structuredContent || {};
    const message = payload ? extractText(payload) : null;
    const agentConfirmed = payload && (structured.activated === true || /you're activated|unlocked/i.test(message || ""));
    const localMatch = activation.getCode ? activation.getCode() === trimmed : false;
    const succeeded = agentConfirmed || localMatch;

    if (!succeeded) {
      const failMessage = (payload ? message : null) || "That activation code didn't work — please check and try again.";
      activation.markFailed(failMessage);
      eventBus?.emit("log", {
        level: "error",
        source: "livepeer",
        text: failMessage,
      });
      return { ok: false, message: failMessage, ...activation.snapshot({ keyless }) };
    }

    const successMessage = (payload ? message : null) || "Livepeer keyless demo credits unlocked (~$200 on this server IP)";
    activation.markActivated(successMessage);
    eventBus?.emit("log", {
      level: "livepeer",
      source: "livepeer",
      text: successMessage,
    });
    return { ok: true, message: successMessage, ...activation.snapshot({ keyless }) };
  }

  function getActivation() {
    return activation.snapshot({ keyless });
  }

  async function renderAvatarSpeech({ text, voiceId = "friendly-host", viewerId = null }) {
    if (!rateLimiter.isAllowed()) {
      eventBus?.emit("log", {
        level: "warn",
        source: "livepeer",
        text: "Rate limit exceeded: avatar speech refused (30/min, 300/hour, 1000/day)",
      });
      return null;
    }
    rateLimiter.record();
    try {
      const result = await callTool(
        "create_media",
        {
          action: "tts",
          prompt: text,
        },
        { timeoutMs: 45000 }
      );
      const audioUrl = extractUrl(result, extractText(result));

      avatarState.lastSpeech = {
        text,
        audioUrl,
        voiceId,
        timestamp: Date.now(),
        viewerId,
      };

      eventBus.emit("avatar_rendered", {
        text,
        audioUrl,
        voiceId,
        viewerId,
        timestamp: Date.now(),
      });
      mediaStore.record({
        type: "avatar_speech",
        url: audioUrl,
        prompt: text,
        timestamp: Date.now(),
        rawResult: result,
      });
      eventBus.emit("log", {
        level: "avatar",
        source: "livepeer",
        text: `Avatar speech rendered: ${text.substring(0, 60)}...`,
      });

      return audioUrl;
    } catch (error) {
      eventBus.emit("log", {
        level: "error",
        source: "livepeer",
        text: `Avatar speech error: ${error.message}`,
      });
      return null;
    }
  }

  async function generateAvatarScene({ avatarId, scene, product, cameraAngle = "medium" }) {
    if (!rateLimiter.isAllowed()) {
      eventBus?.emit("log", {
        level: "warn",
        source: "livepeer",
        text: "Rate limit exceeded: avatar scene generation refused (30/min, 300/hour, 1000/day)",
      });
      return null;
    }
    rateLimiter.record();
    const avatarPrompt = `${AVATAR_BASE_PROMPT}, avatar_id: ${avatarId}, scene: ${scene}, camera angle: ${cameraAngle}`;
    const productContext = product
      ? `Product: ${product.title} - ${product.description}. Condition: ${product.condition}`
      : "";

    try {
      const result = await callTool(
        "create_media",
        {
          prompt: `${avatarPrompt}. ${productContext}. Digital avatar hosting live shopping, professional broadcast quality, 4K, high-detail face, subtle expressions, hand gestures pointing at product`,
          model_override: "flux-schnell",
        },
        { timeoutMs: 45000 }
      );
      const url = extractUrl(result, extractText(result));

      avatarState.active = true;
      avatarState.personality = avatarId;

      eventBus.emit("avatar_scene", {
        avatarId,
        scene,
        cameraAngle,
        product: product?.title,
        url,
        timestamp: Date.now(),
      });
      mediaStore.record({
        type: "avatar_scene",
        url,
        prompt: avatarPrompt,
        product,
        timestamp: Date.now(),
        rawResult: result,
      });
      eventBus.emit("log", {
        level: "avatar",
        source: "livepeer",
        text: `Avatar scene generated: ${scene} (${cameraAngle})`,
      });

      return url;
    } catch (error) {
      eventBus.emit("log", {
        level: "error",
        source: "livepeer",
        text: `Avatar scene error: ${error.message}`,
      });
      return null;
    }
  }

  async function switchToAvatarView({ avatarId, product, responseText }) {
    activeOverlay = "avatar";

    await generateAvatarScene({
      avatarId,
      scene: "host_presenting",
      product,
    });

    let speechUrl = null;
    if (responseText) {
      speechUrl = await renderAvatarSpeech({ text: responseText });
    }

    eventBus.emit("camera_switch", {
      angle: "avatar",
      avatarId,
      product: product?.title,
      speechUrl,
      timestamp: Date.now(),
    });
    eventBus.emit("log", {
      level: "camera",
      source: "livepeer",
      text: `Switched to avatar view: ${avatarId}`,
    });

    return { scene: avatarState.active, speechUrl };
  }

  function getAvatarState() {
    return avatarState;
  }

  async function generateScene({ prompt, product }) {
    if (!rateLimiter.isAllowed()) {
      eventBus?.emit("log", {
        level: "warn",
        source: "livepeer",
        text: "Rate limit exceeded: scene generation refused (limit: 30/min, 300/hour, 1000/day)",
      });
      return null;
    }
    rateLimiter.record();
    try {
      const result = await callTool(
        "create_media",
        {
          action: "generate",
          prompt: `${prompt}. Item: ${product.title}. Condition: ${product.condition}. Professional product photography, studio lighting.`,
          model_override: "flux-schnell",
        },
        { timeoutMs: 45000 }
      );
      const url = extractUrl(result, extractText(result));
      currentScene = { url, product: product.title, generatedAt: Date.now() };

      eventBus.emit("livepeer_result", { url, raw: result });
      mediaStore.record({
        type: "scene",
        url,
        prompt,
        product,
        timestamp: Date.now(),
        rawResult: result,
      });
      eventBus.emit("log", {
        level: "livepeer",
        source: "livepeer",
        text: url ? `Scene generated: ${url}` : "Scene generated (no direct URL returned)",
      });

      return url;
    } catch (error) {
      eventBus.emit("log", {
        level: "error",
        source: "livepeer",
        text: `Livepeer error: ${error.message}`,
      });
      return null;
    }
  }

  async function switchOverlay(angle) {
    activeOverlay = angle;
    eventBus.emit("camera_switch", {
      angle,
      product: currentScene?.product,
      timestamp: Date.now(),
    });
    eventBus.emit("log", {
      level: "camera",
      source: "livepeer",
      text: `Overlay switched: ${angle}`,
    });
    return angle;
  }

  async function startStream({ product }) {
    streamStatus = "live";
    eventBus.emit("stream_started", {
      product: product.title,
      timestamp: Date.now(),
    });
    eventBus.emit("log", {
      level: "livepeer",
      source: "livepeer",
      text: `Stream started: ${product.title}`,
    });
    return true;
  }

  function getActiveOverlay() {
    return activeOverlay;
  }

  function getCurrentScene() {
    return currentScene;
  }

  function getStreamStatus() {
    return streamStatus;
  }

  return {
    generateScene,
    switchOverlay,
    startStream,
    getActiveOverlay,
    getCurrentScene,
    getStreamStatus,
    renderAvatarSpeech,
    generateAvatarScene,
    switchToAvatarView,
    getAvatarState,
    requestActivation,
    activate,
    getActivation,
    getMediaHistory: () => mediaStore.history(),
    getLatestMedia: () => mediaStore.latest(),
  };
}
