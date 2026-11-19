# ScholarshipHive implementation checklist

## Source-code changes in this delivery

- [x] Preserve the existing ScholarshipHive ERP architecture, existing modules and current blue theme.
- [x] Add a separate **Marketing Expense Analyzer** permission to the server permission registry and Admin Settings permission matrix.
- [x] Protect the Marketing Analyzer frontend route and backend read/write actions with the new Marketing permission (View/Edit); administrators retain full access.
- [x] Keep locked sidebar links on the current page and show an access notice instead of navigating to a blocked route.
- [x] Give the Marketing Analyzer its own full-width workspace instead of showing the unrelated Expenses sub-navigation beside it.
- [x] Consolidate Approved Marketing Analyzer expense amounts into Expenses overview totals, category totals and monthly trend data.
- [x] Include Approved Marketing Analyzer spend in Cash Flow actual operating outflows and historical variable-spend averages.
- [x] Include Pending / In Review Marketing expenses in Cash Flow forecast payables, not in paid actuals.
- [x] Improve the Constant Expense form with per-field on/off controls for optional reference, department, title and description fields; show each detail input only when enabled.
- [x] Remove a duplicate validation check in the constant-expense form.
- [x] Add end-user Help content for marketing synchronization, permissions, sidebar access and expense reconciliation in English, Roman Urdu and Urdu.
- [x] Remove the checkerboard background baked into the existing ScholarshipHive icon and wordmark PNGs by making the neutral background transparent. The sidebar displays the brand name as text.
- [x] Add a Vercel frontend configuration and a hybrid Vercel + persistent Node API + Neon deployment guide.
- [x] Update setup and integration documentation to describe the dedicated Marketing permission and hybrid deployment.

## Requires your external accounts / production environment

- [ ] Create the fresh Neon project/database and provide its connection string to the deployment host. The SQL schemas and migrations already exist in this source package; run `npm run migrate` against the fresh database.
- [ ] Deploy the persistent Node API to a long-running Node host and set production secrets / OAuth configuration.
- [ ] Replace `YOUR-PERSISTENT-NODE-API-HOST` in `vercel.json`, connect the repository to Vercel and deploy the frontend.
- [ ] Configure the Vercel domain in `APP_URL` and Google OAuth callback settings.
- [ ] Verify live Neon connectivity, login/session cookies, payroll and marketing records, and expense/cash-flow reconciliation against real data.
- [ ] Run the full test suite and frontend build after installing dependencies in the deployment/test environment; run destructive integration tests only against a disposable test database.

## Verification performed in this workspace

- [x] Node syntax check passed for server and Marketing backend JavaScript files.
- [x] TypeScript JSX parser syntax check passed for all 94 JSX/TSX files.
- [ ] Full test suite is not fully verified here: the workspace has no installed `node_modules`; Marketing test run reported 47 passing tests and 8 Express-dependent test files unable to load because `express` is not installed.
- [ ] Frontend production build and live PostgreSQL integration could not be run here because dependencies and Neon credentials are not configured.

**Deployment note:** the backend is intentionally not configured as a Vercel serverless function. The ERP includes persistent schedulers and ad-sync jobs; Vercel hosts the frontend and proxies API requests to a continuously running Node backend.
