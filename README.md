co
<<<<<<< HEAD
# ScholarshipHive ERP v6 — Unified build

ScholarshipHive ERP, Salary Manager / Salary Analyzer, Attendance and Marketing Expense Analyzer run on **one persistent Node.js host** and use **one PostgreSQL database** (including Neon). The database is organized into schemas: `public` (ERP), `workforce` (Salary + Attendance) and `marketing` (Marketing Analyzer). These are schemas inside the same database, not separate databases.

**Stack:** React 18 + Vite · Node.js 22 + Express · PostgreSQL / Neon. This integrated build requires a long-running Node process; do not deploy the full application as serverless functions. The Marketing ad-account sync scheduler and daily jobs run in that process.

## Quick start

```bash
npm run setup          # creates root .env with a random COOKIE_SECRET, installs packages
# Edit .env: set DATABASE_URL, APP_URL and Google OAuth values
npm run migrate        # applies ERP + Workforce + all 18 Marketing migrations to ONE database
npm run build          # build React frontend
npm start              # start persistent API + background jobs on PORT (default 4000)
```

Use Node.js 22.x. For Neon, use its SSL connection string and set `DATABASE_SSL=true`. The database role must be allowed to create schemas, tables, indexes and required extensions before running migrations. The application loads only the project-root `.env`; `marketing-backend/.env.example` is a note, not a second runtime configuration.

Detailed Roman Urdu deployment instructions: [`SETUP_GUIDE.md`](SETUP_GUIDE.md).

**Railway hosting:** see [`RAILWAY_DEPLOY.md`](RAILWAY_DEPLOY.md). List of fixes in this build: [`FIXES_CHANGELOG.md`](FIXES_CHANGELOG.md).

## Unified modules and security

- **Salary Manager / Analyzer:** the old ERP Salary Manager route redirects into the preserved Salary Analyzer workspace. It keeps the original Workforce payroll and attendance engines, including the original rules/configuration and adjustment workflows. The separate Analyzer login is removed; users authenticate with their ERP account.
- **Attendance:** separate top-level left-sidebar entry, independently permission-checked. Workforce section navigation can be collapsed/reopened. The Flutter Attendance source is kept in `server/workforce/attendance_flutter` and continues to use `/api/workforce`.
- **Marketing Analyzer:** embedded at `/expenses/marketing`, same-origin `/api/v1`, same ERP session cookie and CSRF protection. The 18 numbered SQL migrations are in root `database/migrations`. No standalone production login/database is used.
- **Permissions:** the sidebar hides Salary/Attendance for users without Salary view permission. Direct page access and backend endpoints check permissions independently. Internal Analyzer sections are filtered by server-derived permissions; unauthorized deep links show Access denied. Expense/Marketing write actions require ERP Expenses edit permission (or administrator).
- **Settings placement:** employee access and account-level controls remain in ERP Admin Settings → Users & Roles. Workforce operational attendance/payroll rules remain in Salary Manager → Policy Settings. Cash, budget allotment, treasury and payment-control functions remain in Cash Flow Manager, where they share ERP accounting data.

## Database and data safety

`npm run migrate` is the unified migration command. Migrations are versioned/idempotent and do not insert sample business transactions. The supplied source archives did not contain a live historical database or authorized backup; therefore historical Salary Analyzer payroll/attendance data is **not** included in this source merge. Import such data separately using the original backup/import tooling after taking a backup and testing against staging. The fresh schema will be empty of employee/business transactions until real users enter/import data. Do not run optional legacy demo/seed scripts in production.

Do not run tests against production. `npm test` uses `TEST_DATABASE_URL` for destructive integration tests; that URL must point to a throw-away database whose name contains `test`. Workforce tests reset only the `workforce` schema in that test database; ERP tests may reset `public`. With no `TEST_DATABASE_URL`, those DB suites skip. Marketing unit/contract tests use test-only in-memory fixtures.

## Main routes

- Salary Manager / Analyzer: `/expenses/workforce`
- Attendance: `/attendance`
- Marketing Analyzer: `/expenses/marketing`
- Flutter / device API: `/api/workforce`
- Preserved Workforce admin webpage: `/attendance-admin` (its own admin login and backend checks remain enabled)
- Marketing API: `/api/v1` (same ERP host/session)

## Operational notes

Marking a payroll row paid records the accounting/payment status in ERP; it does not initiate a bank transfer. Marketing ad-account sync requires valid platform credentials and a continuously running Node process. Production credentials, OAuth setup, backups, host configuration and third-party security review remain deployment responsibilities.

See [`WORKFORCE_INTEGRATION.md`](WORKFORCE_INTEGRATION.md) and [`MARKETING_ANALYZER_INTEGRATION.md`](MARKETING_ANALYZER_INTEGRATION.md) for module-specific details.
=======
# scholarshiphive-erp
>>>>>>> edbac9723c27d311c828ce2ef2c2592acc5b2afd
