/**
 * Local record of Livepeer keyless activation.
 * The code itself is issued by Livepeer (email); this only tracks status.
 */

import { readFileSync, writeFileSync } from "fs";

export function createActivationState({ persistPath } = {}) {
  let activated = false;
  let email = null;
  let lastMessage = null;
  let requestedAt = null;
  let code = null;

  function load() {
    if (!persistPath) return;
    try {
      const data = JSON.parse(readFileSync(persistPath, "utf8"));
      activated = Boolean(data.activated);
      email = data.email || null;
      lastMessage = data.lastMessage || null;
      requestedAt = data.requestedAt || null;
      code = data.code || null;
    } catch {
      // first run or unreadable file
    }
  }

  function save() {
    if (!persistPath) return;
    try {
      writeFileSync(
        persistPath,
        JSON.stringify({ activated, email, lastMessage, requestedAt, code }, null, 2)
      );
    } catch {
      // dashboard still works without disk
    }
  }

  load();

  function generateCode8() {
    return Array.from({ length: 8 }, () =>
      String.fromCharCode(65 + Math.floor(Math.random() * 26))
    ).join("");
  }

  return {
    markRequested(requestedEmail, message) {
      email = requestedEmail;
      lastMessage = message;
      requestedAt = Date.now();
      code = generateCode8();
      save();
      return code;
    },
    markActivated(message) {
      activated = true;
      lastMessage = message;
      save();
    },
    markFailed(message) {
      lastMessage = message;
      save();
    },
    snapshot({ keyless }) {
      return {
        keyless,
        activated: keyless ? activated : true,
        email,
        lastMessage,
        requestedAt,
        code: code || null,
        creditsHint: !keyless ? "api-key" : activated ? "~200 USD budget" : "~10 USD budget",
      };
    },
    getCode: () => code,
  };
}
