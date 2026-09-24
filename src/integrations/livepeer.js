/**
 * Livepeer integration — drives the actual live stream.
 *
 * In a real deployment this would call the Livepeer Agent MCP to:
 *   - Generate product scenes (AI imagery)
 *   - Switch camera angles in real time
 *   - Render overlays (price tags, badges, countdowns)
 *   - Stream to TikTok Shop / YouTube / custom embed
 *
 * In demo mode it emits events that the dashboard visualizes.
 */

import { createMediaStore } from "../models/mediaStore.js";

export function createLivepeerClient({ apiKey, eventBus }) {
  const mediaStore = createMediaStore({ eventBus });
  const baseUrl = "https://agent.livepeer.org/api/mcp";
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "X-Livepeer-Agent-Tool-Profile": "lean",
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  let activeOverlay = "front";
  let currentScene = null;
  let streamStatus = "offline";
  let avatarState = {
    active: false,
    personality: null,
    lastSpeech: null,
  };

  const AVATAR_BASE_PROMPT = "AI-generated 3D virtual host for live shopping, friendly expression, professional studio lighting, green screen background";

  // Keyless demo mode activates when no DEMO_RENDER_KEY is present.
  // Per agent.livepeer.org/get-started.html: DEMO_RENDER_KEY is off by default.
  const isKeyless = !apiKey;

  async function call(payload) {
    if (isKeyless) {
      // Keyless demo mode: return mock media responses
      const id = payload.id || Date.now();
      const toolName = payload.params?.name || "unknown";
      const mockUrl = toolName === "chat" || payload.params?.arguments?.model_override?.includes("tts")
        ? `https://livepeer-demo.s3.amazonaws.com/demo-speech-${id}.mp3`
        : `https://livepeer-demo.s3.amazonaws.com/demo-scene-${id}.jpg`;
      return {
        jsonrpc: "2.0",
        id: id,
        result: {
          content: [{ text: mockUrl, data: { url: mockUrl } }],
        },
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Livepeer MCP ${response.status}: ${text}`);
      }

      return response.json();
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("Livepeer MCP request timed out after 30s");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function renderAvatarSpeech({ text, voiceId = "friendly-host", viewerId = null }) {
    const toolPayload = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: "chat",
        arguments: {
          prompt: text,
          model_override: "tts-sonic",
        },
      },
    };

    try {
      const result = await call(toolPayload);
      const audioUrl = result?.result?.content?.[0]?.text || result?.result?.content?.[0]?.data?.url;

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
      mediaStore.record({ type: "avatar_speech", url: audioUrl, prompt: text, timestamp: Date.now(), rawResult: result });
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
    const avatarPrompt = `${AVATAR_BASE_PROMPT}, avatar_id: ${avatarId}, scene: ${scene}, camera angle: ${cameraAngle}`;
    const productContext = product
      ? `Product: ${product.title} - ${product.description}. Condition: ${product.condition}`
      : "";

    const toolPayload = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: "generate_media",
        arguments: {
          prompt: `${avatarPrompt}. ${productContext}. Digital avatar hosting live shopping, professional broadcast quality, 4K, high-detail face, subtle expressions, hand gestures pointing at product`,
          model_override: "video-to-video",
        },
      },
    };

    try {
      const result = await call(toolPayload);
      const content = result?.result?.content?.[0];
      const url = content?.text || content?.data?.url;

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
      mediaStore.record({ type: "avatar_scene", url, prompt: avatarPrompt, product, timestamp: Date.now(), rawResult: result });
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
    const toolPayload = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: "create_media",
        arguments: {
          prompt: `${prompt}. Item: ${product.title}. Condition: ${product.condition}. Professional product photography, studio lighting.`,
          model_override: "flux-schnell",
        },
      },
    };

    try {
      const result = await call(toolPayload);
      const content = result?.result?.content?.[0];
      const url = content?.text || content?.data?.url;
      currentScene = { url, product: product.title, generatedAt: Date.now() };

      eventBus.emit("livepeer_result", { url, raw: result });
      mediaStore.record({ type: "scene", url, prompt: prompt, product, timestamp: Date.now(), rawResult: result });
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
    getMediaHistory: () => mediaStore.history(),
    getLatestMedia: () => mediaStore.latest(),
  };
}