# Marketing Expense Analyzer — unified ERP integration

## Runtime architecture

Marketing Analyzer runs inside the ScholarshipHive ERP. Its UI route is `/expenses/marketing`; its API is same-origin `/api/v1`. The browser uses the ERP HttpOnly session cookie and ERP CSRF header. There is no production Marketing login, separate Marketing user manager, separate API host or separate database.

All modules read the project-root `DATABASE_URL`. Marketing tables live in the `marketing` schema of that same PostgreSQL database. The 18 numbered SQL migrations are located in root `database/migrations/001...018`; the root `npm run migrate` command applies ERP, Workforce and Marketing migrations together. Do not create a Marketing-specific database URL or `.env`.

## Permissions

The ERP account is the identity source. Marketing access requires the ERP Expenses permission; write actions require Expenses edit permission or administrator access. View-only users do not get expense create/edit/delete, document upload or approval controls. The API independently checks session, permission and CSRF protections; hiding UI controls is not the only security layer. Employee/account administration remains in ERP Admin Settings.

## Local run / deployment

From project root:

```bash
npm run setup
# edit .env with the one DATABASE_URL, COOKIE_SECRET, APP_URL and OAuth values
npm run migrate
npm run build
npm start
```

Deploy on a persistent Node.js 22 host. The ad-account sync scheduler is started by `server/src/index.js` in the same long-running process and uses PostgreSQL queue leases/transaction-scoped locks. Serverless execution or a separately hosted Marketing backend is not the supported deployment model. The `marketing-backend/src/server.js` entry refuses production standalone startup; its original standalone app is retained only for isolated development/test compatibility.

`marketing-backend/.env.example` is a reference notice. Runtime configuration comes from the root `.env`; Marketing pool and migrations use only root `DATABASE_URL`.

## Data notes

Migrations create schema objects and do not add dummy business records. Real ad platform credentials/accounts must be connected and verified before platform spend appears. Marketing migration history is tracked in `marketing.schema_migrations`; do not edit a migration file already applied to a database—add a new numbered migration instead.
