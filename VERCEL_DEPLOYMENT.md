# Vercel + Neon deployment (hybrid architecture)

This repository now includes a Vercel static-frontend configuration. **The complete ERP backend must not run as a Vercel serverless function.** The integrated backend runs persistent Marketing ad-sync and scheduled jobs, so keep the Node.js 22 API on a persistent Node host (Render, Railway, Fly.io, or a VPS) and use Vercel for the React/Vite frontend. Both use the same Neon PostgreSQL database.

## 1. Create the Neon database

1. Create a fresh Neon PostgreSQL project and database.
2. Copy the pooled connection string for runtime and keep the direct connection string available for migrations if your provider requires it.
3. Configure the persistent API host with the root `.env.example` variables, especially `DATABASE_URL`, `DATABASE_SSL=true`, `PERSISTENCE_DRIVER=postgres`, `COOKIE_SECRET`, `APP_URL`, Google OAuth values, `BUSINESS_TIMEZONE=Asia/Karachi`, and `TZ=Asia/Karachi`.
4. Run migrations once from the project root: `npm run migrate`.
5. Build and start the persistent API: `npm run build && npm start`.
6. Verify `https://YOUR-PERSISTENT-NODE-API-HOST/api/health` reports a healthy database connection.

All application modules share one Neon database and three schemas: `public`, `workforce`, and `marketing`. Do not configure a second Marketing database URL.

## 2. Configure Vercel

1. Import this repository into Vercel.
2. Keep the project root at the repository root.
3. The included `vercel.json` installs root and client dependencies, builds the Vite frontend, and publishes `client/dist`.
4. **Before deploying, replace `YOUR-PERSISTENT-NODE-API-HOST` in `vercel.json`** with the HTTPS origin of your persistent Node API host (hostname only, no trailing slash or `/api`). The rewrite keeps browser requests same-origin at the Vercel domain, including session cookies and OAuth callback paths.
5. Deploy. Set the persistent API's `APP_URL` to the final Vercel HTTPS domain and set Google OAuth's authorized redirect URI to `https://YOUR-VERCEL-DOMAIN/api/auth/google/callback`.
6. Ensure the API host accepts the Vercel origin and forwarded HTTPS traffic according to its reverse-proxy configuration. Keep secure cookies enabled in production.

## 3. Important runtime limits

- Vercel hosts the frontend and proxies `/api/*` to the persistent backend; it does not run the long-lived ERP/Marketing scheduler.
- Keep the API process continuously running. Do not deploy `server/src/index.js` as a Vercel function and do not start the stand-alone `marketing-backend` in production.
- The `/attendance-admin` route is proxied to the API host. Flutter source remains in `server/workforce/attendance_flutter` and needs its own Android build/signing process.
- Never commit `.env`, Neon credentials, OAuth secrets, or service tokens.

## 4. Production verification checklist

- [ ] Neon migrations complete; `public`, `workforce`, and `marketing` schemas exist.
- [ ] API `/api/health` returns healthy.
- [ ] Vercel frontend loads and `/api/auth` requests reach the persistent backend.
- [ ] Google OAuth callback returns to the Vercel domain.
- [ ] Login/session cookie survives page refresh and SPA navigation.
- [ ] Marketing and Workforce modules load through the shared ERP session.
- [ ] Expense, payroll, marketing expense and Cash Flow totals reconcile for the same date range.
- [ ] Admin role permissions are tested with a non-admin test account.
- [ ] Database backups and restore procedure are tested.
