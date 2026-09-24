export function createLedger() {
  const bids = [];

  return {
    recordBid: ({ viewerId, amount, message, timestamp }) => {
      if (amount == null || !Number.isFinite(amount) || amount <= 0) {
        throw new Error(`Invalid bid amount: ${amount}`);
      }
      const bid = {
        id: `bid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        viewerId,
        amount,
        message,
        timestamp,
      };
      bids.push(bid);
      return bid;
    },
    currentBid: () => {
      if (bids.length === 0) return null;
      return bids[bids.length - 1];
    },
    highestBid: () => {
      if (bids.length === 0) return null;
      return bids.reduce((max, b) => (b.amount > max.amount ? b : max));
    },
    history: () => [...bids],
    clear: () => {
      bids.length = 0;
    },
  };
}
