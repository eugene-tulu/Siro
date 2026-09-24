import { TypeSafeClient, choice, noul, score } from "@typesafe-ai/sdk";

let client = null;

if (process.env.TYPESAFE_API_KEY) {
  client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY });
}

export function createJevRouter({ apiKey, eventBus }) {
  const client = apiKey ? new TypeSafeClient({ apiKey }) : null;
  const enabled = Boolean(client);

  if (!enabled) {
    eventBus.emit("log", {
      level: "warn",
      source: "jev",
      text: "Jev disabled — missing TYPESAFE_API_KEY. Using heuristic fallback.",
    });
  }

  async function evaluate(state) {
    if (!enabled) return heuristicRoute(state);

    const stateText = [
      `Active item: ${state.activeItem?.title || "none"}`,
      `Item category: ${state.activeItem?.category || "none"}`,
      `Current bid: $${state.activeItem?.currentBid || 0}`,
      `Viewer message: ${state.message}`,
    ].join("\n");

    try {
      const response = await client.systemOne({
        state: stateText,
        questions: {
          intent: choice("What is the viewer trying to do?", {
            BID_NUMERIC: "Explicitly offers a dollar amount to buy the item",
            BID_VAGUE: "Expresses interest in buying but no clear dollar amount",
            QUESTION: "Asks for information about the item or auction",
            SPAM: "Off-topic, nonsense, or disruptive",
            IGNORE: "Small talk, greetings, or low-value chat",
          }),
          is_valid_bid: noul("Does this message contain a clearly actionable bid?"),
          comedic_intensity: score(
            "How attention-grabbing is this message?",
            [
              "Flat / no energy",
              "Mild interest",
              "Active bidding energy",
              "Strong bid pressure",
              "FOMO / urgency spike",
            ]
          ),
          visual_request: choice(
            "Does the viewer ask to see a specific angle or detail?",
            {
              NONE: "No visual request",
              SHOW_HOLO_ANGLE: "Asks to see holographic shine or refraction",
              SHOW_BACK: "Asks to see the back or reverse side",
              SHOW_CORNER: "Asks about corners, edges, or condition detail",
              SHOW_LABEL: "Asks to see labels, tags, or markings",
            }
          ),
        },
      });

      const answer = response.answers;
      const intent = answer.intent.choice;
      const visualIntent = answer.visual_request.choice;

      eventBus.emit("jev_decision", {
        state,
        answer,
        latency_ms: Date.now() - state.receivedAt,
      });

      if (intent === "BID_NUMERIC" || intent === "BID_VAGUE") {
        const parsedBid = parseBid(state.message);
        return {
          action: "bid",
          intent,
          parsedBid,
          confidence: answer.is_valid_bid.noul,
        };
      }

      if (intent === "QUESTION") {
        return {
          action: "question",
          intent,
          visualIntent,
          confidence: answer.visual_request.confidence,
        };
      }

      return {
        action: "ignore",
        intent,
        confidence: answer.intent.confidence,
      };
    } catch (error) {
      eventBus.emit("log", {
        level: "error",
        source: "jev",
        text: `Jev error: ${error.message}`,
      });
      return heuristicRoute(state);
    }
  }

  function parseBid(text) {
    const match = text.match(/\$?(\d+(?:\.\d{1,2})?)/);
    if (!match) return null;
    const amount = parseFloat(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return amount;
  }

  function heuristicRoute(state) {
    const text = state.message.toLowerCase();
    const hasNumber = /\d+/.test(text);
    const bidWords = /\b(bid|i'll take|give me|sold|take it)\b/i.test(text);

    if (hasNumber && bidWords) {
      const amount = parseBid(state.message);
      return {
        action: "bid",
        intent: "BID_NUMERIC",
        parsedBid: amount,
        confidence: 0.6,
      };
    }

    const visualHints = [
      { pattern: /\b(holo|holographic|shine|refract)\b/i, intent: "SHOW_HOLO_ANGLE" },
      { pattern: /\b(back|reverse|behind)\b/i, intent: "SHOW_BACK" },
      { pattern: /\b(corner|edge|wear|whiting)\b/i, intent: "SHOW_CORNER" },
      { pattern: /\b(label|tag|sticker|marking)\b/i, intent: "SHOW_LABEL" },
    ];

    for (const hint of visualHints) {
      if (hint.pattern.test(text)) {
        return {
          action: "question",
          intent: "QUESTION",
          visualIntent: hint.intent,
          confidence: 0.55,
        };
      }
    }

    if (/\?/.test(text)) {
      return { action: "question", intent: "QUESTION", visualIntent: "NONE", confidence: 0.5 };
    }

    return { action: "ignore", intent: "IGNORE", confidence: 0.7 };
  }

  return {
    route: async (input) => evaluate({ ...input, receivedAt: Date.now() }),
  };
}
