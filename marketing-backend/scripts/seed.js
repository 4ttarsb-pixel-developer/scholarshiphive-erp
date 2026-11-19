// Idempotent taxonomy seed for PostgreSQL. Inserts the ten approved categories
// and their subcategories with stable rows. Safe to run repeatedly — existing
// rows are left untouched (no financial data is created here).
//
//   node scripts/seed.js
require('dotenv').config();
const { definitions } = require('../src/data/taxonomy');

async function main() {
  if ((process.env.PERSISTENCE_DRIVER || 'memory') !== 'postgres') {
    console.log('PERSISTENCE_DRIVER is not "postgres" — nothing to seed (memory driver seeds itself at boot).');
    return;
  }
  const { pool, withTransaction } = require('../src/db/pool');
  let inserted = 0;
  await withTransaction(async (client) => {
    for (const [name, subs] of definitions) {
      const cat = await client.query(
        `INSERT INTO marketing.categories (name)
           VALUES ($1)
         ON CONFLICT (lower(name)) DO UPDATE SET name = marketing.categories.name
         RETURNING id`,
        [name],
      );
      const categoryId = cat.rows[0].id;
      for (const sub of subs) {
        const r = await client.query(
          `INSERT INTO marketing.subcategories (category_id, name)
             VALUES ($1, $2)
           ON CONFLICT (category_id, name) DO NOTHING`,
          [categoryId, sub],
        );
        inserted += r.rowCount;
      }
    }
  });
  console.log(`Taxonomy seed complete. ${definitions.length} categories ensured; ${inserted} new subcategory row(s).`);
  await pool.end();
}

main().catch((err) => { console.error('[MEA][seed] error:', err.message); process.exit(1); });
