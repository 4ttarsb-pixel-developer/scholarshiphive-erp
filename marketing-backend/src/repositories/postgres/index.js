// PostgreSQL driver. Implements the same repository facade as the memory driver,
// mapping rows to the exact object shapes the services already expect (category /
// subcategory by name, month as 'YYYY-MM', amounts as numbers, ISO timestamps).
// All queries are parameterized. Multi-statement writes use withTransaction.
const { pool, query, withTransaction } = require('../../db/pool');

// Reusable projections ------------------------------------------------------
const TS = (col) => `to_char(${col} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
async function subcategoryId(client, category, subcategory) {
  const { rows } = await client.query(
    `SELECT s.id FROM marketing.subcategories s
       JOIN marketing.categories c ON c.id = s.category_id
      WHERE c.name = $1 AND s.name = $2`,
    [category, subcategory],
  );
  if (!rows[0]) throw new Error(`Subcategory not found for ${category} / ${subcategory}`);
  return rows[0].id;
}

// ---------------------------------------------------------------------------
module.exports = {
  driver: 'postgres',

  // Database is authoritative. No startup hydrator or identity mirror.
  async hydrate() { /* no-op for backward-compatible setup scripts */ },

  users: {
    async list() {
      const { rows } = await query(
        `SELECT id::text AS id, display_number AS "displayNumber", name, email, role, status, initials FROM marketing.users ORDER BY created_at`,
      );
      return rows;
    },
    async findById(id) {
      const { rows } = await query(
        `SELECT id::text AS id, display_number AS "displayNumber", name, email, role, status, initials FROM marketing.users WHERE id = $1`, [id]);
      return rows[0] || null;
    },
    async findActiveByEmail(email) {
      const { rows } = await query(
        `SELECT id::text AS id, display_number AS "displayNumber", name, email, role, status, initials FROM marketing.users
          WHERE lower(email) = lower($1) AND status = 'Active'`, [email]);
      return rows[0] || null;
    },
    async insert(row) {
      await query(
        `INSERT INTO marketing.users (id, name, email, role, status, initials)
           VALUES ($1,$2,$3,$4,$5,$6)`,
        [row.id, row.name, row.email, row.role, row.status, row.initials],
      );
      return row;
    },
    async setStatus(id, status) {
      await query(`UPDATE marketing.users SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
      return this.findById(id);
    },
  },

  credentials: {
    async get(userId) {
      const { rows } = await query(`SELECT password_hash FROM marketing.auth_credentials WHERE user_id = $1`, [userId]);
      return rows[0] ? rows[0].password_hash : null;
    },
    async set(userId, hash) {
      await query(
        `INSERT INTO marketing.auth_credentials (user_id, password_hash, changed_at)
           VALUES ($1,$2, now())
         ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, changed_at = now()`,
        [userId, hash],
      );
    },
  },

  sessions: {
    async create({ tokenHash, userId, email, expiresAt }) {
      await query(
        `INSERT INTO marketing.user_sessions (token_hash, user_id, email, expires_at)
           VALUES ($1,$2,$3,$4)`,
        [tokenHash, userId, email, expiresAt],
      );
    },
    async find(tokenHash) {
      const { rows } = await query(
        `SELECT user_id::text AS "userId", email, expires_at AS "expiresAt", revoked_at AS "revokedAt"
           FROM marketing.user_sessions WHERE token_hash = $1`, [tokenHash]);
      return rows[0] || null;
    },
    async revoke(tokenHash) {
      await query(`UPDATE marketing.user_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [tokenHash]);
    },
    async revokeByUser(userId) {
      await query(`UPDATE marketing.user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    },
  },

  categories: {
    async list() {
      const { rows } = await query(
        `SELECT c.id::text AS id, c.name,
                COALESCE(json_agg(json_build_object('id', s.id::text, 'name', s.name)
                         ORDER BY s.created_at, s.name)
                         FILTER (WHERE s.id IS NOT NULL), '[]') AS subcategories
           FROM marketing.categories c
           LEFT JOIN marketing.subcategories s ON s.category_id = c.id
          GROUP BY c.id, c.name, c.created_at
          ORDER BY c.created_at, c.name`);
      return rows;
    },
    async insert(category) {
      await query(`INSERT INTO marketing.categories (id, name) VALUES ($1,$2)`, [category.id, category.name]);
      return category;
    },
    async rename(id, name) {
      await query(`UPDATE marketing.categories SET name = $2 WHERE id = $1`, [id, name]);
    },
    async remove(id) {
      await query(`DELETE FROM marketing.categories WHERE id = $1`, [id]);
    },
    async addSubcategory(categoryId, sub) {
      await query(`INSERT INTO marketing.subcategories (id, category_id, name) VALUES ($1,$2,$3)`, [sub.id, categoryId, sub.name]);
      return sub;
    },
    async removeSubcategory(categoryId, subId) {
      await query(`DELETE FROM marketing.subcategories WHERE id = $1 AND category_id = $2`, [subId, categoryId]);
    },
  },

  budgets: {
    async list() {
      const { rows } = await query(
        `SELECT b.id::text AS id, b.display_number AS "displayNumber", to_char(b.month,'YYYY-MM') AS month,
                c.name AS category, s.name AS subcategory, b.amount_pkr::float8 AS "limit"
           FROM marketing.monthly_budgets b
           JOIN marketing.subcategories s ON s.id = b.subcategory_id
           JOIN marketing.categories c ON c.id = s.category_id`);
      return rows;
    },
    async findById(id) { return (await this.list()).find((b) => b.id === id) || null; },
    async insert(row) {
      await withTransaction(async (client) => {
        const subId = await subcategoryId(client, row.category, row.subcategory);
        await client.query(
          `INSERT INTO marketing.monthly_budgets (id, month, subcategory_id, amount_pkr)
             VALUES ($1, ($2||'-01')::date, $3, $4)`,
          [row.id, row.month, subId, row.limit],
        );
      });
      return row;
    },
    async setLimit(id, limit) {
      await query(`UPDATE marketing.monthly_budgets SET amount_pkr = $2, version = version + 1, updated_at = now() WHERE id = $1`, [id, limit]);
    },
  },

  allocations: {
    async list() {
      const { rows } = await query(
        `SELECT a.id::text AS id, a.display_number AS "displayNumber", to_char(a.month,'YYYY-MM') AS month,
                a.user_id::text AS "userId", c.name AS category, s.name AS subcategory,
                a.amount_pkr::float8 AS "limit", ${TS('a.created_at')} AS "createdAt"
           FROM marketing.employee_allocations a
           JOIN marketing.subcategories s ON s.id = a.subcategory_id
           JOIN marketing.categories c ON c.id = s.category_id`);
      return rows;
    },
    async findById(id) { return (await this.list()).find((a) => a.id === id) || null; },
    async insert(row) {
      await withTransaction(async (client) => {
        const subId = await subcategoryId(client, row.category, row.subcategory);
        await client.query(
          `INSERT INTO marketing.employee_allocations (id, month, subcategory_id, user_id, amount_pkr)
             VALUES ($1, ($2||'-01')::date, $3, $4, $5)`,
          [row.id, row.month, subId, row.userId, row.limit],
        );
      });
      return row;
    },
    async setLimit(id, limit) {
      await query(`UPDATE marketing.employee_allocations SET amount_pkr = $2, updated_at = now() WHERE id = $1`, [id, limit]);
    },
  },

  expenses: {
    async list() {
      const { rows } = await query(
        `SELECT e.id::text AS id, e.display_number AS "displayNumber", ou.display_number AS "ownerDisplayNumber", e.title, c.name AS category, s.name AS subcategory,
                e.amount_pkr::float8 AS amount, to_char(e.occurred_on,'YYYY-MM-DD') AS date,
                e.vendor, e.reference, e.description,
                ou.name AS owner, e.owner_id::text AS "ownerId", e.status,
                e.employee_allocation_id::text AS "budgetAllocationId",
                ${TS('e.created_at')} AS "createdAt", ${TS('e.updated_at')} AS "updatedAt"
           FROM marketing.expenses e
           JOIN marketing.subcategories s ON s.id = e.subcategory_id
           JOIN marketing.categories c ON c.id = s.category_id
           JOIN marketing.users ou ON ou.id = e.owner_id`);
      return rows;
    },
    async findById(id) { return (await this.list()).find((e) => e.id === id) || null; },
    async insert(row) {
      await withTransaction(async (client) => {
        const subId = await subcategoryId(client, row.category, row.subcategory);
        await client.query(
          `INSERT INTO marketing.expenses
             (id, owner_id, subcategory_id, employee_allocation_id, title, vendor, reference,
              description, occurred_on, amount_pkr, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11, now(), now())`,
          [row.id, row.ownerId, subId, row.budgetAllocationId || null, row.title,
            row.vendor || '', row.reference || '', row.description || '', row.date,
            row.amount, row.status],
        );
      });
      return row;
    },
    async patch(id, fields) {
      await withTransaction(async (client) => {
        const sets = []; const vals = []; let i = 1;
        const put = (col, val) => { sets.push(`${col} = $${i++}`); vals.push(val); };
        if (fields.title !== undefined) put('title', fields.title);
        if (fields.vendor !== undefined) put('vendor', fields.vendor);
        if (fields.reference !== undefined) put('reference', fields.reference);
        if (fields.description !== undefined) put('description', fields.description);
        if (fields.amount !== undefined) put('amount_pkr', fields.amount);
        if (fields.date !== undefined) { sets.push(`occurred_on = $${i++}::date`); vals.push(fields.date); }
        if (fields.status !== undefined) put('status', fields.status);
        if (fields.budgetAllocationId !== undefined) put('employee_allocation_id', fields.budgetAllocationId);
        if (fields.category !== undefined && fields.subcategory !== undefined) {
          const subId = await subcategoryId(client, fields.category, fields.subcategory);
          put('subcategory_id', subId);
        }
        sets.push('updated_at = now()');
        vals.push(id);
        await client.query(`UPDATE marketing.expenses SET ${sets.join(', ')} WHERE id = $${i}`, vals);
      });
      return this.findById(id);
    },
    async remove(id) { await query(`DELETE FROM marketing.expenses WHERE id = $1`, [id]); },
  },

  audit: {
    async list(expenseId) {
      const { rows } = await query(
        `SELECT id::text AS id, expense_id::text AS "expenseId", action,
                from_status AS "previousStatus", to_status AS "newStatus",
                reviewer_name AS reviewer, note, ${TS('happened_at')} AS at
           FROM marketing.expense_events
          ${expenseId ? 'WHERE expense_id = $1' : ''}
          ORDER BY happened_at DESC, id DESC`,
        expenseId ? [expenseId] : []);
      return rows;
    },
    async insert(event) {
      await query(
        `INSERT INTO marketing.expense_events (expense_id, reviewer_name, action, from_status, to_status, note)
           VALUES ($1,$2,$3,$4,$5,$6)`,
        [event.expenseId, event.reviewer, event.action, event.previousStatus, event.newStatus, event.note],
      );
      return event;
    },
  },

  documents: {
    async listMeta(expenseId) {
      const { rows } = await query(
        `SELECT id::text AS id, slot, name, mime_type AS "mimeType", bytes_size AS size,
                file_key AS "fileKey", sha256, ${TS('uploaded_at')} AS "uploadedAt",
                uploaded_by_name AS "uploadedBy"
           FROM marketing.expense_documents WHERE expense_id = $1 ORDER BY slot`, [expenseId]);
      return rows.map((r) => ({ ...r, size: Number(r.size) }));
    },
    async getContent(expenseId, slot) {
      const { rows } = await query(`SELECT content_bytes AS bytes FROM marketing.expense_documents WHERE expense_id=$1 AND slot=$2`, [expenseId,slot]);
      return rows[0]?.bytes ?? null;
    },
    async getMeta(expenseId, slot) {
      const { rows } = await query(
        `SELECT id::text AS id, slot, name, mime_type AS "mimeType", bytes_size AS size,
                file_key AS "fileKey", sha256, ${TS('uploaded_at')} AS "uploadedAt",
                uploaded_by_name AS "uploadedBy"
           FROM marketing.expense_documents WHERE expense_id = $1 AND slot = $2`, [expenseId, slot]);
      return rows[0] ? { ...rows[0], size: Number(rows[0].size) } : null;
    },
    async upsert(expenseId, d) {
      const { rows } = await query(
        `INSERT INTO marketing.expense_documents
           (expense_id, slot, name, file_key, sha256, mime_type, bytes_size, uploaded_by, uploaded_by_name, content_bytes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (expense_id, slot) DO UPDATE SET
           name = EXCLUDED.name, file_key = EXCLUDED.file_key, sha256 = EXCLUDED.sha256,
           mime_type = EXCLUDED.mime_type, bytes_size = EXCLUDED.bytes_size,
           uploaded_by = EXCLUDED.uploaded_by, uploaded_by_name = EXCLUDED.uploaded_by_name,
           uploaded_at = now(), content_bytes = EXCLUDED.content_bytes
         RETURNING id::text AS id, slot, name, mime_type AS "mimeType", bytes_size AS size,
                   file_key AS "fileKey", sha256, ${TS('uploaded_at')} AS "uploadedAt",
                   uploaded_by_name AS "uploadedBy"`,
        [expenseId, d.slot, d.name, d.fileKey, d.sha256, d.mimeType, d.size, d.uploadedBy || null, d.uploadedByName || null, d.bytes]);
      return { ...rows[0], size: Number(rows[0].size) };
    },
    async remove(expenseId, slot) {
      await query(`DELETE FROM marketing.expense_documents WHERE expense_id = $1 AND slot = $2`, [expenseId, slot]);
    },
    async clearByExpense(expenseId) {
      await query(`DELETE FROM marketing.expense_documents WHERE expense_id = $1`, [expenseId]);
    },
    async count(expenseId) {
      const { rows } = await query(`SELECT count(*)::int AS n FROM marketing.expense_documents WHERE expense_id = $1`, [expenseId]);
      return rows[0].n;
    },
    async slots(expenseId) {
      const { rows } = await query(`SELECT slot FROM marketing.expense_documents WHERE expense_id = $1`, [expenseId]);
      return rows.map((r) => r.slot);
    },
  },

  fx: {
    async loadAll() {
      const { rows } = await query(
        `SELECT currency, to_char(month,'YYYY-MM') AS month, rate_pkr::float8 AS rate,
                source, ${TS('updated_at')} AS "updatedAt", approved_by::text AS "updatedBy"
           FROM marketing.fx_rates`);
      return rows;
    },
    async upsert({ currency, month, rate, source, oldRate, userId }) {
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO marketing.fx_rates (currency, month, rate_pkr, source, approved_by)
             VALUES ($1, ($2||'-01')::date, $3, $4, $5)
           ON CONFLICT (currency, month) DO UPDATE SET
             rate_pkr = EXCLUDED.rate_pkr, source = EXCLUDED.source,
             approved_by = EXCLUDED.approved_by,
             version = marketing.fx_rates.version + 1, updated_at = now()`,
          [currency, month, rate, source, userId]);
        await client.query(
          `INSERT INTO marketing.fx_rate_events (currency, month, old_rate, new_rate, source, actor_id)
             VALUES ($1, ($2||'-01')::date, $3, $4, $5, $6)`,
          [currency, month, oldRate ?? null, rate, source, userId]);
      });
    },
  },

  _pool: pool,
};
