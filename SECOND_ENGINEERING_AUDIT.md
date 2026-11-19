# ScholarshipHive ERP v6 — Second Engineering Audit

Audit scope: final unified ZIP against the supplied original ERP, Salary Analyzer, and Marketing source archives.

## Evidence-backed results

| Area | Result | Evidence / limitation |
|---|---|---|
| ZIP integrity | PASS | `unzip -t` passed for all five supplied archives. |
| Node runtime | PASS | Node 22.16.0 and npm 10.9.2 are available in the audit environment. |
| Marketing migrations | PASS (source presence) | 17 `.sql` files exist under root `database/migrations`; runtime migration against PostgreSQL was not possible. |
| Environment templates | PASS (presence) | Root `.env.example` and `marketing-backend/.env.example` exist. |
| Salary Analyzer service preservation | PASS (source equality) | All 16 `backend/src/services/*.js` files in the original Analyzer compare byte-for-byte equal to `server/workforce/src/services/*.js` in the unified project, including attendance-engine.js and payroll-engine.js. |
| Workforce test runner | FIXED | Previously exited 0 when `TEST_DATABASE_URL` was absent, silently making the parent test command look successful. It now exits 2 with an explicit NOT RUN message. |
| Dependency installation | BLOCKED | `npm ci --ignore-scripts --no-audit --no-fund` could not reach registry.npmjs.org (`EAI_AGAIN`). No successful install is claimed. |
| React production build | NOT RUN | Vite dependencies could not be installed. |
| Fresh PostgreSQL / Neon | NOT RUN | No Neon credentials supplied; no `psql`, `pg_isready`, or local PostgreSQL server available. Never connected to or modified a live database. |
| Security penetration tests | NOT RUN | Static code review only; no live authenticated environment, test identities, or database. No penetration-test pass is claimed. |
| Flutter build / device integration | NOT RUN | Flutter and Dart SDKs are unavailable in the environment. Source files and API path references were inspected only. |
| Historical payroll import | BLOCKED | No historical Analyzer database dump/backup or export was supplied. No historical payroll data was fabricated or imported. |

## Salary Analyzer feature source review

The following original service modules are byte-for-byte preserved: adjustment, advance, attendance engine/service, audit, auth, correction, employee, events, local-storage import, leave, network, payroll engine/service, policy, and revenue. This confirms source preservation only; it does not prove runtime calculations or database behavior.

The original payroll rules document specifies daily attendance classification, overnight shifts, grace/late tiers, early departure, absence and unpaid leave deductions, advance recovery, verified commission, approved adjustments, blockers, immutable approval snapshots, and idempotent payment. These require executable scenario tests against PostgreSQL before production approval.

## Security / production cautions

- The application must be tested with separate admin, HR-edit, HR-view, and ordinary employee accounts.
- Verify direct URL access, direct API calls, employee-to-employee record access, attendance correction, payroll approval/payment, and role changes.
- Do not use production Neon for the Workforce test runner: it drops and recreates the `workforce` schema in the configured test database. The runner now requires a database name containing `test`, but that naming check is not a substitute for a separate isolated database/credential.
- No secrets, production credentials, or user data were added to this archive.

## Required before production release

1. Run `npm ci` at root and `npm ci --prefix client` in an environment with npm registry access; run `npm run build`.
2. Provision a disposable Neon database, set `DATABASE_URL` and `DATABASE_SSL=true`, then run `npm run migrate` and verify all three schemas and migration checksums.
3. Provision a second disposable PostgreSQL database whose database name contains `test`; set `TEST_DATABASE_URL` and run `npm run test:workforce`.
4. Run the root ERP API tests and Marketing tests after dependencies install.
5. Run the six feature-specific attendance/payroll/security/import scenarios and record actual results.
6. Run Flutter `flutter pub get`, `flutter analyze`, widget tests, and a real Android device/emulator end-to-end test against HTTPS deployment.
7. Supply the old Analyzer database backup and perform a dry-run historical import with row counts, totals, employee mapping, and payroll reconciliation before any production import.

Audit conclusion: **NOT PRODUCTION-VERIFIED**. The archive has source-level improvements and the Salary Analyzer service code is preserved, but dependency installation, build, database execution, security penetration tests, Flutter execution, and historical import remain unverified for the explicit reasons above.
