/**
 * Rate limiter for Livepeer Agent demo (per user's email limits).
 * Limits: 30/min, 300/hour, 1000/day.
 */

export function createRateLimiter({ eventBus }) {
  const requests = []; // timestamps

  function record() {
    const now = Date.now();
    requests.push(now);
    // Clean old requests (older than 1 hour for hour limit, older than 1 day for day limit)
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    for (let i = requests.length - 1; i >= 0; i--) {
      if (requests[i] < oneDayAgo) requests.splice(i, 1);
    }
  }

  function countInWindow(windowMs) {
    const cutoff = Date.now() - windowMs;
    return requests.filter((t) => t >= cutoff).length;
  }

  function isAllowed() {
    const perMin = countInWindow(60 * 1000);
    const perHour = countInWindow(60 * 60 * 1000);
    const perDay = countInWindow(24 * 60 * 60 * 1000);

    const allowed = perMin < 30 && perHour < 300 && perDay < 1000;

    if (eventBus) {
      eventBus.emit("log", {
        level: "livepeer",
        source: "rate-limit",
        text: `Rate: ${perMin}/min, ${perHour}/hour, ${perDay}/day — ${allowed ? "ALLOWED" : "REFUSED"}`,
      });
    }

    return allowed;
  }

  return {
    isAllowed,
    record,
    getStats: () => ({
      perMin: countInWindow(60 * 1000),
      perHour: countInWindow(60 * 60 * 1000),
      perDay: countInWindow(24 * 60 * 60 * 1000),
    }),
  };
}
