# Workforce ERP — Attendance + Revenue Commission + Payroll

One integrated system built from your two projects:

* **Hanan Attendance app** (Flutter) — check-in/out, fingerprint login, device binding, office Wi-Fi rules, leave, shifts, reception.
* **Workforce Pay — Salary Analyzer** — same sidebar, cards, tables, modals and payslips, now backed by a real API.

```
Flutter Attendance App ──► Express API (Node.js) ──► PostgreSQL ◄── Express API ◄── Workforce Pay web dashboard (React)
                              │  same JSON contract as the old Cloudflare Worker
                              └─ /attendance-admin (original attendance admin page)
```

PostgreSQL is the **only** writable database. The ASP.NET/SQLite and Cloudflare Worker/D1 backends are retired
to `legacy/` and used only as import sources.

## Quick start
See **[START_HERE.md](START_HERE.md)** (exact commands) and **[SETUP_WINDOWS.md](SETUP_WINDOWS.md)** (installing everything).

```powershell
npm install
Copy-Item backend\.env.example backend\.env   # set your PostgreSQL password
npm run db:create; npm run db:migrate; npm run db:seed
npm run dev                                     # http://localhost:5173
```

## What's integrated
| Area | How it works |
|---|---|
| One employee identity | `employees.employee_code` (e.g. EMP001) is the payroll identity; a login is linked to an employee by an explicit, verified mapping — never by name. |
| Attendance → payroll | Every Flutter check-in/out, network-away interval, leave decision or correction recalculates that employee's Draft payroll inside the same transaction; dashboards update live (Server-Sent Events). |
| Server is the source of truth | Lateness, worked time, overnight shifts, holidays, weekly offs and absences are computed only on the server (Asia/Karachi by default). |
| Commission | Dropdown with exactly **Fixed Employee Commission** (employee's saved %, loaded from PostgreSQL, read-only) and **Manual Percentage** (typed %). PKR = amount × % / 100, previewed live, stored with the applied rate, enforced by a DB CHECK. |
| No double counting | Unique sale references, one commission entry per sale, one attendance record per employee-day, one open session per user, one advance recovery per payroll, approve/pay once — all enforced by PostgreSQL constraints. |
| Approved payroll is immutable | Snapshot stored at approval; DB triggers reject changes; later corrections go through authorised adjustments in the next open month. |
| Policy engine | Versioned, configurable: grace, tiered or per-hour late rules, daily/monthly basis, rounding, cap, paid-leave allowance, working-day basis, cut-off day. Late penalties ship **disabled**. |
| Security | scrypt passwords (legacy hashes upgraded), DB-stored sessions, RBAC (Admin / HR / Revenue Manager / Employee), rate limits, lockout, CSRF header check, restricted CORS, Helmet headers, append-only audit log. Wi-Fi checks, device binding and biometric login preserved. |

## Project structure
```
Integrated_ERP/
├── backend/                 Express API
│   ├── src/  routes/ controllers/ services/ middleware/ utils/
│   ├── db/migrations/       Knex migrations (schema, constraints, triggers, reference data)
│   ├── scripts/             seed, reset-demo, backup, import-sqlite, import-d1, create-admin, test-runner
│   ├── test/                41 automated tests (node:test + supertest, real PostgreSQL)
│   └── .env.example
├── frontend/                React + Vite web dashboard (original Workforce Pay CSS)
├── attendance_flutter/      Flutter app (API base URL + session header updated; UI unchanged)
├── database/                schema.sql, documentation (inspection, schema, migration, payroll rules)
├── docs/API.md              endpoint reference
├── legacy/                  retired ASP.NET + Cloudflare Worker (import sources only)
├── START_HERE.md · SETUP_WINDOWS.md · TROUBLESHOOTING.md
```

## Scripts (run from the project root)
| Command | Does |
|---|---|
| `npm run dev` | API (4000) + dashboard (5173) |
| `npm run db:create` / `db:migrate` / `db:seed` | database setup |
| `npm run db:reset-demo` | remove only DEMO data |
| `npm run db:backup` | pg_dump backup |
| `npm test` | automated tests (separate test DB) |
| `npm run build` then `npm start` | single production-style server |
| `npm run import:sqlite -w backend -- --dry-run` | import old ASP.NET data |
| `npm run import:d1 -w backend -- --file <export.sql> --dry-run` | import Cloudflare D1 export |

## Verification status
* **Automated tests: 41 passing** against PostgreSQL 16 (all 20 required scenarios + security, overnight shifts, legacy import, restart persistence).
* **Browser end-to-end** (Playwright, Chromium): create employee → Flutter-API check-in/out → attendance in ledger → sale with fixed % auto-load and manual % → Draft payroll → exception review → approve via checkbox → payslip → mark paid → employee self-service; Overview has no checkboxes.
* `npm audit --omit=dev`: 0 vulnerabilities.

## Not done / not verified — please read
* **Flutter was not compiled or run here** (no Flutter SDK in the build environment). Dart changes are small (API base URL default, a header helper, headers on 6 reception/feed calls) and the Flutter contract is covered by API tests, but run `flutter analyze` and a device test before release.
* **Biometric (fingerprint) login** server logic is tested via the API; the on-device flow needs a real phone.
* **Cloudflare D1 import** was tested with a synthetic export built from the Worker's own migrations, not with your live data (no credentials used, by design).
* Windows-specific steps were written for Windows but executed on Linux; the code uses no native modules.
* No email/SMS notifications (the ASP.NET "security alert email" had no working SMTP config); legal/statutory payroll deductions (income tax, EOBI) are not modelled.
* Attendance-app screens for salary/payslips were not added to Flutter; employees use the web self-service page.
