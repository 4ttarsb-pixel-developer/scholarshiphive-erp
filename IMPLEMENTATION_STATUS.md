# ScholarshipHive ERP v6 — implementation status

This archive is the merged v6 project supplied for the requested single-hosting / single-PostgreSQL deployment.

## Changes applied in this working pass

- Fixed the Expenses sub-navigation `quickLink` render-time reference error by moving the check into the item predicate.
- Moved Marketing Analyzer and Salary & Workforce shortcuts beside Expenses in the primary left navigation; removed their duplicate entries from the Expenses sub-navigation.
- Changed the module sub-navigation from a full-height right rail into a compact dropdown panel that opens vertically from the top bar. The main content no longer reserves a permanent right-side column.
- Removed Cash Flow Manager from the primary top-level navigation. Dashboard now opens with a prominent Cash Flow Manager heading and exposes its cash-management pages from the Dashboard card.
- Added explicit Office 1–4 assignment to new recurring constant-expense setup, an office filter in the recurring template list, and office display in that list. Recurring monthly cycles inherit the template's office through the existing `location` field, so existing expense and cashflow accounting paths continue to receive the location value.

## Important items not yet completed / verified

- The supplied Marketing Analyzer remains a separate Express API package with its own authentication/user model and a dedicated client API base URL. Its existing integration notes explicitly describe the separate API and authentication boundary. It has **not** yet been safely converted to ERP cookie/permission authentication and mounted into the ERP Express server. Therefore this working archive must not be represented as a completed one-service / one-auth integration.
- The Marketing Analyzer's original migrations are in its own `marketing` PostgreSQL schema and use the marketing backend pool. The schemas can share one PostgreSQL database URL, but the service is still separately started and its auth is separate. A deliberate auth bridge and server mounting/refactor are required before one-host deployment is satisfied.
- The four offices are currently represented as Office 1, Office 2, Office 3 and Office 4 because actual office names were not supplied. These values are stored in the existing recurring-expense `location` field; this is a compatibility step, not a normalized office master-data module.
- A frontend production build and full dependency-backed test run remain unverified in this workspace because `node_modules` is absent and package installation timed out. No `TEST_DATABASE_URL` or disposable PostgreSQL instance was provided.
- No live database, credentials, office names, or historical production records were supplied. Do not run destructive reset commands against production.


## Follow-up hardening pass (2026-11-16)

- Added Workforce migration `20261116000001_erp_account_block_sync.js` with an `erp_managed_disabled` marker so ERP block/unblock can preserve independent HR suspensions.
- Updated the AMS user block/unblock operations to use one PostgreSQL transaction across `public` and `workforce`: block revokes ERP sessions, disables the linked Workforce identity and revokes its Workforce auth sessions and invalidates active Attendance session tokens while preserving the incomplete shift for exception review; unblock restores only identities disabled by that ERP block operation.
- Converted `/attendance-admin` browser access to use the central AMS HttpOnly cookie and redirect unauthenticated visitors to `/login?next=%2Fattendance-admin`; removed the second username/password form from that browser page. Browser requests now send the required same-origin request header and do not create a second Attendance bearer session.
- Tightened legacy Attendance administration authorization: `attendance.manage` alone no longer grants access to the legacy admin/network-control surface; it requires central admin status or `attendance.security`.
- Made the main Express trusted-proxy setting environment-driven via `TRUST_PROXY` and changed the example default to one explicitly trusted proxy hop (`1`) rather than trusting all forwarded headers. Configure this value to match the actual hosting topology.
- These are source changes only. The new migration must be applied with `npm run migrate`; live database behavior and the frontend/Flutter build still require the deployment/test environment.

- Added Marketing migration `018_erp_user_identity_link.sql` and changed the ERP-to-Marketing SSO bridge to use immutable ERP user IDs instead of email as the identity key. Existing profiles are backfilled by email once during migration; the original 17 migrations are not modified.
