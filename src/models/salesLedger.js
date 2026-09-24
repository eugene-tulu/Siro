/**
 * Sales ledger — tracks completed sales for the live shop.
 *
 * In a real deployment this would sync to a database.
 * In demo mode it's in-memory and survives restarts only within a session.
 */

export function createSalesLedger() {
  const sales = [];

  return {
    record: ({ viewerId, product, amount, negotiated, originalPrice, message, timestamp }) => {
      const sale = {
        id: `sale-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        viewerId,
        product,
        amount,
        negotiated: negotiated || false,
        originalPrice: originalPrice || amount,
        message: message || "",
        timestamp,
      };
      sales.push(sale);
      return sale;
    },
    history: () => [...sales],
    total: () => sales.reduce((sum, s) => sum + s.amount, 0),
    clear: () => {
      sales.length = 0;
    },
  };
}