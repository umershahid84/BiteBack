// Platform credit ledger helpers. Balance = sum of ledger entries for the user.
function createCredits(db) {
  const balanceStmt = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS b FROM credit_ledger WHERE user_id = ?');
  const insert = db.prepare('INSERT INTO credit_ledger (user_id, amount_cents, kind, order_id, note, created_by) VALUES (?, ?, ?, ?, ?, ?)');
  return {
    balance: (userId) => balanceStmt.get(userId).b,
    add: (userId, amountCents, kind, { orderId = null, note = '', by = null } = {}) => insert.run(userId, amountCents, kind, orderId, note, by),
    history: (userId) => db.prepare(`SELECT l.id, l.amount_cents, l.kind, l.order_id, l.note, l.created_at FROM credit_ledger l
      WHERE l.user_id = ? ORDER BY l.id DESC LIMIT 100`).all(userId),
  };
}

module.exports = { createCredits };
