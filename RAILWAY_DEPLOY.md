# Railway deployment guide — ScholarshipHive ERP v6

One Railway **web service** (this Node.js app) plus one Railway **PostgreSQL** database.
ERP, Salary/Attendance (Workforce) and Marketing Analyzer all run in the same service and use the same database (schemas `public`, `workforce`, `marketing`).

No config file is needed. Railway auto-detects Node.js and runs:

```
npm ci          → installs server packages (root package.json)
npm run build   → installs the React client packages and builds client/dist
npm start       → node server/src/index.js (runs all migrations, then serves the site + API)
```

Node 22 is selected from `engines` in `package.json` / `.nvmrc`.

> Note: Railway's `railway.json` / `railway.toml` (Config as Code) is deprecated. New services cannot use it and existing files stop being read on 2026-12-01. That is why this project ships **without** a railway.json; the settings below go in the Railway dashboard.

---

## Step by step (Roman Urdu + English)

### 1. Code upload
- **GitHub (recommended):** is folder ko ek GitHub repo mein push karein (`.env` push **na** karein — `.gitignore` already isko rokta hai). Railway → **New Project → Deploy from GitHub repo**.
- **Ya Railway CLI:** is folder ke andar `railway up` chalayein.

### 2. Database add karein
Same project mein **+ New → Database → PostgreSQL**.

### 3. Variables (web service → *Variables* tab)

| Variable | Value | Zaroori? |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway reference variable) | **Haan** |
| `DATABASE_SSL` | `false` for Railway's private `DATABASE_URL`. Use `true` only with `DATABASE_PUBLIC_URL` or Neon. | **Haan** |
| `COOKIE_SECRET` | 96 random hex chars — locally run `npm run secret` | **Haan** |
| `NODE_ENV` | `production` | **Haan** |
| `APP_URL` | `https://<your-domain>` — optional; if missing, Railway's `RAILWAY_PUBLIC_DOMAIN` is used automatically | Recommended |
| `TRUST_PROXY` | `1` (Railway has one edge proxy; attendance IP / Wi-Fi rules depend on this) | Recommended |
| `TZ` / `BUSINESS_TIMEZONE` | `Asia/Karachi` | Recommended |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From Google Cloud Console | Pehle admin setup aur new registrations ke liye **zaroori** |
| `GOOGLE_REDIRECT_URI` | `https://<your-domain>/api/auth/google/callback` (auto-derived from APP_URL if unset) | Optional |
| `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | Gmail app password etc. | Optional (emails) |
| `WHATSAPP_*` | Meta WhatsApp Cloud API | Optional |

**Never** set `GOOGLE_DEV_BYPASS=true` in production (it is ignored when `NODE_ENV=production` anyway).

### 4. Public domain
Web service → **Settings → Networking → Generate Domain**. Phir Google Cloud Console mein OAuth client ke **Authorized redirect URI** mein yeh add karein:
```
https://<your-domain>/api/auth/google/callback
```

### 5. Health check (Settings → Deploy)
- **Healthcheck Path:** `/api/health`
- **Healthcheck timeout:** 300 seconds (first deploy creates all tables)
- **Restart policy:** On Failure

### 6. Deploy & first login
Deploy ke baad logs mein yeh nazar aana chahiye:
```
✔ ScholarshipHive ERP running on https://<your-domain>  (port ..., production)
```
Site kholein → **Setup** page → Google se verify → Super Admin banayein. (Google keys ke baghair app chal jati hai aur purane users password se login kar sakte hain, magar pehla setup / new registration Google verification maangta hai.)

---

## Useful URLs after deploy
- Site: `https://<your-domain>/`
- Health: `https://<your-domain>/api/health`
- Salary Manager / Analyzer: `/expenses/workforce` · Attendance: `/attendance` · Marketing Analyzer: `/expenses/marketing`
- Attendance admin page: `/attendance-admin` (uses the main ERP login)

## Flutter Attendance app
The mobile app is not deployed on Railway. Build it pointing at your Railway domain (no `/api` at the end):
```
flutter build apk --dart-define=API_BASE_URL=https://<your-domain>
```

## Notes
- **Files/uploads** (photos, CVs, receipts) are stored inside PostgreSQL, so Railway redeploys do not lose them. Back up the Railway Postgres database regularly.
- Migrations run automatically on every start and are idempotent. You can also run them manually: `npm run migrate`.
- If the database is still waking up, the app retries the connection (default 6 attempts, `DB_CONNECT_RETRIES`).
- Do **not** run `npm test` or `npm run db:reset` against the production database.
