// Single-transaction expense status transition and audit record.
const { withTransaction } = require('../../db/pool');
const { HttpError } = require('../../utils/http');
async function transition({ id, expected, next, actor, action, note='' }) {
  return withTransaction(async client => {
    const {rows} = await client.query(
      `SELECT id::text id, status FROM marketing.expenses WHERE id=$1 FOR UPDATE`, [id]);
    if(!rows[0]) throw new HttpError(404,'Expense not found');
    if(rows[0].status!==expected) throw new HttpError(409,`Only ${expected} expenses can be changed`);
    if(['In Review','Approved'].includes(next)) {
      const count=await client.query('SELECT count(*)::int n FROM marketing.expense_documents WHERE expense_id=$1',[id]);
      if(count.rows[0].n!==3) throw new HttpError(409,'All 3 supporting documents are required');
    }
    await client.query(
      'UPDATE marketing.expenses SET status=$2, updated_at=now() WHERE id=$1',[id,next]);
    const event=await client.query(
      `INSERT INTO marketing.expense_events (expense_id, reviewer_name, action, from_status, to_status, note)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id::text id, expense_id::text "expenseId", action,
       from_status "previousStatus", to_status "newStatus", reviewer_name reviewer,
       note, happened_at at`,
      [id, actor.name, action, expected,next,note]);
    return {event:event.rows[0]};
  });
}
module.exports={transition};
