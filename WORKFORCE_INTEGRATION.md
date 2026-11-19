# Salary Manager / Analyzer and Attendance — ERP integration

## Entry points

- **Salary Manager / Analyzer:** `/expenses/workforce`
- **Attendance:** `/attendance` (separate top-level left-sidebar entry)
- **Employee self-service:** `/my-salary`
- **Flutter/device API:** `/api/workforce`
- **Preserved attendance admin webpage:** `/attendance-admin`

The older ERP Salary Manager page redirects to the Salary Analyzer workspace. The original Workforce backend engines, services, calculation rules, migrations, and feature pages are retained. The separate Salary Analyzer login has been replaced with ScholarshipHive ERP session authentication.

## Preserved Analyzer workflow

The workspace includes employee records, attendance ledger and device check-in, leaves/leave approvals, shifts, exceptions, holidays and attendance policies, overtime/late rules, revenue attribution, commissions and rate history, payroll calculation and adjustments, approvals, payment recording, advances, payslips, audit history, and employee self-service. The eight original Workforce test files are restored under `server/workforce/test`.

The Analyzer is treated as the feature source of truth: old ERP presentation is not used as a reason to discard an Analyzer feature. Legacy ERP Salary Manager route redirects to the integrated workspace. Existing Salary permission governs access; users without Salary view permission do not see the sidebar links, and direct route/API checks still deny access. Within Analyzer, tabs are filtered against server-derived Workforce permissions; an unauthorized deep link displays Access denied. The section navigation can collapse/reopen.

## Where settings and finance controls live

- ERP account approval, roles and module permissions: **Admin Settings → Users & Roles**.
- Workforce attendance/payroll operational rules (late, overtime, shifts, holidays, leave, commission and payroll policy): **Salary Manager / Analyzer → Policy Settings** and the related operational pages.
- Cash balances, budgets, treasury, payables/payment control and cash-flow planning: **Cash Flow Manager**.

This keeps access/identity settings in the ERP, domain-specific payroll rules with their calculation engine, and cash/treasury functions in the ERP finance module.

## One database

Workforce tables are in PostgreSQL schema `workforce`, on the same physical database selected by the root `.env` `DATABASE_URL`. ERP tables remain in `public`; Marketing tables are in `marketing`. Run `npm run migrate` from project root to apply all module migrations. Do not configure a separate Workforce database.

The browser workspace uses the ERP cookie and ERP permissions. Existing mobile/device-specific authentication and rate limits remain supported for Flutter routes under `/api/workforce`. Flutter source is preserved at `server/workforce/attendance_flutter`; point the app at the same deployed ERP host/base API. The existing bundled admin webpage is served at `/attendance-admin` and its admin endpoints still enforce their own administrator/session checks. A future Android release still needs its own Android build/signing process.

## Historical data

The uploaded archives included source code and schemas, not a live Analyzer database backup. The integration therefore preserves the Analyzer engine, rules, schema/migrations and import tooling, but it cannot restore historical employee/payroll/attendance rows absent from the archives. Use an authorized backup and test the provided import path against a non-production copy before importing. New DB migrations do not create fake employees/payroll entries.

## Setup and tests

```bash
npm run setup
# configure root .env with the one DATABASE_URL and secrets
npm run migrate
npm run build
npm start
```

Run integration tests only against a throw-away DB whose name contains `test`, set as `TEST_DATABASE_URL`. The Workforce runner drops only the `workforce` schema in that test DB; never point it at production.
