// Employee expense budgets ("cash allotment"): balance = approved allotments − approved returns − spent (not rejected).
import { query } from '../db.js';
import { sub, today } from './money.js';

const q1 = (db, t, p) => (db || { query }).query(t, p).then(r => r.rows[0]);

export async function walletOf(db, userId) {
  return q1(db, `SELECT w.*, u.full_name, u.employee_code, u.designation, u.photo_file_id, u.email, u.status AS user_status
                   FROM budget_wallets w JOIN users u ON u.id = w.user_id WHERE w.user_id = $1`, [userId]);
}

export const walletActive = w => Boolean(w && w.state === 'active' && (!w.valid_until || String(w.valid_until).slice(0, 10) >= today()));

export async function walletBalance(db, userId) {
  const r = await q1(db, `SELECT
      (SELECT COALESCE(SUM(amount),0) FROM budget_entries WHERE user_id=$1 AND kind='allot'  AND status='approved')::numeric AS allotted,
      (SELECT COALESCE(SUM(amount),0) FROM budget_entries WHERE user_id=$1 AND kind='return' AND status='approved')::numeric AS returned,
      (SELECT COALESCE(SUM(amount),0) FROM budget_entries WHERE user_id=$1 AND kind='allot'  AND status='pending')::numeric AS pending_allot,
      (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE budget_holder_id=$1 AND status <> 'rejected')::numeric AS spent,
      (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE budget_holder_id=$1 AND status = 'approved')::numeric AS spent_approved,
      (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE budget_holder_id=$1 AND status = 'pending')::numeric AS spent_pending,
      (SELECT COUNT(*) FROM expenses WHERE budget_holder_id=$1 AND status = 'pending')::int AS pending_count`, [userId]);
  const n = k => Number(r[k]);
  return {
    allotted: n('allotted'), returned: n('returned'), pending_allot: n('pending_allot'), spent: n('spent'),
    spent_approved: n('spent_approved'), spent_pending: n('spent_pending'), pending_count: r.pending_count,
    balance: sub(sub(n('allotted'), n('returned')), n('spent')),
  };
}

/** One budget write per employee at a time → the balance can never go below zero. */
export const lockWallet = (db, userId) => db.query('SELECT pg_advisory_xact_lock(7703, $1::int)', [Number(userId)]);
