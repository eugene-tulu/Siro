/**
 * Seller agent — the 24/7 autonomous storefront.
 *
 * Combines the Jev router (intent classification) with a proactive showcase
 * loop and reactive chat handling. This is the "seller" — it never sleeps,
 * never gets distracted, and always has something to say.
 */

import { createJevRouter } from "../integrations/jev.js";

export function createSellerAgent({ sellerConfig, eventBus, jevRouter, livepeer }) {
  const personality = sellerConfig.personality;
  const session = sellerConfig; // expose product helpers
  const avatarId = `avatar-${sellerConfig.sellerId}`;

  let lastShowcase = null;
  let avatarInitialized = false;

  async function initAvatar() {
    if (avatarInitialized || !livepeer) return;
    avatarInitialized = true;

    await livepeer.generateAvatarScene({
      avatarId,
      scene: "host_welcome",
      cameraAngle: "medium",
    });

    await livepeer.renderAvatarSpeech({
      text: personality.greeting,
      voiceId: "friendly-host",
    });

    eventBus.emit("log", {
      level: "avatar",
      source: "agent",
      text: `Avatar host initialized: ${avatarId}`,
    });
  }

  function buildPromptContext(message, viewerId) {
    const product = sellerConfig.getActiveProduct();
    return {
      message,
      viewerId,
      state: "LIVE",
      activeItem: product,
      sellerName: sellerConfig.sellerName,
      personality,
      streamSettings: sellerConfig.streamSettings,
    };
  }

  async function handleBuyerMessage(message, viewerId) {
    const startTime = Date.now();
    const context = buildPromptContext(message, viewerId);
    const result = await jevRouter.route(context);

    eventBus.emit("jev_decision", {
      context,
      answer: result,
      latency_ms: Date.now() - startTime,
    });

    if (result.action === "bid") {
      const product = context.activeProduct || sellerConfig.getActiveProduct();
      if (!product) {
        return respondToBuyer(viewerId, "I'm having trouble identifying the product — please ask again in a moment.");
      }
      const currentPrice = product.price;
      const minimum = currentPrice;
      const offer = result.parsedBid;

      if (offer == null) {
        eventBus.emit("log", {
          level: "warn",
          source: "agent",
          text: `Viewer ${viewerId} expressed interest but no price was parsed`,
        });
        return respondToBuyer(
          viewerId,
          "I couldn't quite catch the amount — what were you thinking?",
          { action: "bid", parsedBid: null, message }
        );
      }

      if (offer >= minimum) {
        eventBus.emit("sale_made", {
          viewerId,
          product: product.title,
          amount: offer,
          message,
          timestamp: Date.now(),
        });
        eventBus.emit("log", {
          level: "sale",
          source: "agent",
          text: `Sale: ${product.title} to ${viewerId} for $${offer}`,
        });
        return respondToBuyer(
          viewerId,
          `${personality.closing} $${offer} for the ${product.title} — confirmed!`,
          { action: "bid", parsedBid: offer, message }
        );
      }

      const discountAllowed = sellerConfig.pricing.allowNegotiation;
      const maxDiscount = sellerConfig.pricing.maxDiscountPercent || 0;
      const floor = minimum * (1 - maxDiscount / 100);

      if (discountAllowed && offer >= floor) {
        eventBus.emit("sale_made", {
          viewerId,
          product: product.title,
          amount: offer,
          negotiated: true,
          originalPrice: minimum,
          message,
          timestamp: Date.now(),
        });
        eventBus.emit("log", {
          level: "sale",
          source: "agent",
          text: `Negotiated sale: ${product.title} to ${viewerId} for $${offer} (was $${minimum})`,
        });
        return respondToBuyer(
          viewerId,
          `You got it! $${offer} for the ${product.title} — deal confirmed.`,
          { action: "bid", parsedBid: offer, negotiated: true, originalPrice: minimum, message }
        );
      }

      eventBus.emit("log", {
        level: "warn",
        source: "agent",
        text: `Offer of $${offer} rejected for ${product.title} (min $${minimum})`,
      });
      return respondToBuyer(
        viewerId,
        `Thanks for the offer! $${offer} is a bit below my $${minimum} asking price.`,
        { action: "bid", parsedBid: offer, rejected: true, message }
      );
    }

    if (result.action === "question") {
      const product = context.activeProduct || sellerConfig.getActiveProduct();
      const answer = buildProductAnswer(result, product);
      eventBus.emit("log", {
        level: "info",
        source: "agent",
        text: `Answered question from ${viewerId}: ${result.intent}`,
      });
      return respondToBuyer(viewerId, answer, { action: "question", intent: result.intent, visualIntent: result.visualIntent, message: result.message || message });
    }

    // ignore
    return { action: "ignore", intent: result.intent, confidence: result.confidence, message: message };
  }

  function buildProductAnswer(result, product) {
    if (!product) {
      return "I'm not sure which product you're referring to right now — can you clarify?";
    }
    const intent = result.intent;
    const visual = result.visualIntent;

    if (visual && visual !== "NONE") {
      eventBus.emit("camera_switch", {
        angle: visual,
        product: product.title,
        timestamp: Date.now(),
      });
      eventBus.emit("log", {
        level: "camera",
        source: "agent",
        text: `Camera switch: ${visual} on ${product.title}`,
      });
    }

    switch (visual) {
      case "SHOW_HOLO_ANGLE":
        return `Great eye! Here's the holographic angle on the ${product.title} — check it out.`;
      case "SHOW_BACK":
        return `Sure thing — here's the back of the ${product.title}.`;
      case "SHOW_CORNER":
        return `Let me zoom in on the corners for you — ${product.title}.`;
      case "SHOW_LABEL":
        return `Here are the labels and tags on the ${product.title}.`;
      default:
        return `${product.title}: ${product.condition}, ${product.description}`;
    }
  }

   function respondToBuyer(viewerId, text, meta = {}) {
    eventBus.emit("agent_response", {
      viewerId,
      text,
      timestamp: Date.now(),
    });
    eventBus.emit("log", {
      level: "agent",
      source: "agent",
      text: `${viewerId}: ${text}`,
    });

    if (livepeer) {
      livepeer
        .renderAvatarSpeech({ text, viewerId })
        .catch((err) => {
          eventBus.emit("log", {
            level: "error",
            source: "agent",
            text: `Avatar speech failed: ${err.message}`,
          });
        });
    }

    return { viewerId, text, timestamp: Date.now(), ...meta };
  }

   async function doProactiveShowcase(product) {
    lastShowcase = product;
    eventBus.emit("agent_showcase", {
      product,
      timestamp: Date.now(),
    });
    eventBus.emit("log", {
      level: "agent",
      source: "agent",
      text: `Now showcasing: ${product.title} — $${product.price}`,
    });

    if (livepeer) {
      const welcomeText = `Check this out — ${product.title} at $${product.price}. ${product.description}`;
      await livepeer.switchToAvatarView({
        avatarId,
        product,
        responseText: welcomeText,
      });

      livepeer
        .renderAvatarSpeech({
          text: welcomeText,
          voiceId: "showcase-host",
        })
        .catch(() => {});
    }
  }

   return {
    handleBuyerMessage,
    doProactiveShowcase,
    initAvatar,
    getLastShowcase: () => lastShowcase,
  };
}