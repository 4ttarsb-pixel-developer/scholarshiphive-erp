# Integration delivery status and verification limits

## Source integration completed

- The 18 numbered Marketing SQL migrations are present in root `database/migrations` and byte-for-byte match the 17 original migrations in the supplied Marketing source archive plus one AMS identity-link migration.
- The Marketing API is mounted inside the ERP at `/api/v1`; it uses the ERP session/CSRF middleware, a dedicated Marketing Analyzer permission, and only the root `DATABASE_URL`. The stand-alone Marketing server refuses production startup.
- The Marketing ad-sync scheduler runs in the persistent ERP Node process. PostgreSQL job claims use transaction-scoped account locks and leased ownership for heartbeat/complete/fail operations.
- The original Workforce payroll/attendance feature pages, business services, calculation code and migrations are retained. ERP SSO is connected through the added `erp_user_links` migration. The eight Workforce test files (`01`–`08`) and their helper are present.
- Marketing Analyzer has a dedicated Admin Settings permission (View/Edit) separate from general Expenses. Approved Marketing Analyzer spend is consolidated into Expenses overview totals/monthly charts and Cash Flow actuals/forecast variable-spend history. Salary Manager / Analyzer and Attendance have separate left-sidebar entries. Salary/Attendance are hidden without ERP Salary view permission; the routes and APIs also enforce authorization. Internal Analyzer sections are filtered by the mapped server permissions and unauthorized deep links show Access denied. The section navigation has collapse/reopen control.
- The Flutter Attendance source contains all 193 files from the source archive. After normalizing line endings, functional differences are limited to changing the API path prefix to `/api/workforce`; the other raw file differences are line-ending normalization. The existing admin webpage is also served at `/attendance-admin`.
- The root `.env.example`, `marketing-backend/.env.example`, setup script, unified migration command, module integration docs and Roman Urdu setup guide are included.

## Data handling

- All three modules use one PostgreSQL database URL, with schemas `public`, `workforce`, and `marketing`.
- The numbered SQL migrations do not populate sample employees, sample payroll, fake attendance or demo expense transactions. The ERP schema does create built-in system categories/form field options and configuration defaults; these are reference/configuration rows, not fake business activity.
- No live database dump or historical Salary Analyzer backup was included in the supplied archives. Historical Analyzer payroll and attendance records therefore have not been imported. Use an authorized database backup and test the import/restore path on a non-production copy before loading history.

## Verification actually performed in this workspace

- `node --check` passed for 225 JavaScript files.
- TypeScript parser syntax checks passed for 94 JSX/TSX files.
- All 17 original Marketing migration files were compared against the source archive and matched byte-for-byte; migration 018 is a new AMS integration migration.
- Flutter source file inventory matched: 193 source files, none missing.
- Marketing tests: 47 tests passed; 8 Express-dependent test files could not load because `express` is not installed in this execution workspace.
- Workforce test runner could not start because `pg` is not installed in this execution workspace.
- Frontend build could not run because `vite` is not installed. An offline npm install check could not resolve uncached packages. This workspace has no installed `node_modules`, no configured Neon credentials and no disposable PostgreSQL test database.
- Flutter SDK was not present, so the Flutter app was source-compared but not compiled here.

Accordingly, this package is a source integration prepared for deployment, not a live-host/Neon-tested release or a third-party penetration-tested system. After installing dependencies, run `npm run migrate`, `npm run build`, and the destructive tests only with a separate throw-away `TEST_DATABASE_URL` before production rollout.

## Current update

- Main sidebar now leaves locked destinations in place and shows the permission notice without navigating the user into a blocked page. Marketing Analyzer is excluded from the generic Expenses sub-navigation so its own workspace has a clean full-width view.
- Constant expense forms now reveal optional reference, department, title and description fields only when switched on; turning a field off clears that optional value before save.
- The supplied logo artwork had a checkerboard background baked into its PNG. The brand icon and wordmark assets have been converted to transparent PNGs; the application displays the ScholarshipHive name as live text beside the icon.
- Vercel frontend deployment is documented as a hybrid deployment in `VERCEL_DEPLOYMENT.md`; the API and scheduler remain on a persistent Node host.


## Central-login / session hardening update (2026-11-16)

- The browser `/attendance-admin` page now bootstraps against `/api/workforce/admin/session` using the main AMS `sh_sid` cookie. It no longer asks for a separate Attendance username/password or creates a second admin Bearer token. Users without an AMS session are redirected to the main `/login` route.
- Legacy Attendance admin/network management now requires AMS admin status or the dedicated Workforce `attendance.security` permission; `attendance.manage` by itself is not sufficient for that surface.
- Blocking an ERP account now atomically revokes `public.sessions`, disables its linked Workforce account, and revokes `workforce.auth_sessions` and closes active Attendance session tokens without fabricating a checkout time. Unblocking restores only Workforce identities marked as disabled by the ERP block action. This relies on the new Workforce migration `20261116000001_erp_account_block_sync.js`.
- Main Express proxy trust now reads `TRUST_PROXY`; use the exact trusted proxy hop count/range for the host. The sample `.env` uses `1` as a common single-proxy example, not a universal production value.


## Marketing identity key update (2026-11-16)

- Added Marketing migration `018_erp_user_identity_link.sql`. It backfills existing Marketing profiles by matching the current ERP email once, then stores a unique `marketing.users.erp_user_id` reference to `public.users(id)`.
- Updated the ERP SSO bridge to upsert and retrieve Marketing profiles by immutable `erp_user_id`; email is now a mutable profile/contact attribute rather than the account identity key. If an email conflicts with another profile, the write fails safely rather than merging two ERP identities.
- The original 17 Marketing migrations remain unchanged; migration 018 is an additional ScholarshipHive integration migration.
