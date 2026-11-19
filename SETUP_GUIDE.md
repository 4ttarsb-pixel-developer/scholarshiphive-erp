# ScholarshipHive ERP v6 — Setup & Deployment Guide

Yeh merged build **ONE Node.js host + ONE PostgreSQL/Neon database** ke liye hai. ERP, Salary Analyzer/Attendance aur Marketing Analyzer aik hi application process aur aik hi database connection string share karte hain. Frontend Vercel par deploy ho sakta hai; API + Marketing ad-sync scheduler + daily jobs ko persistent Node host par chalana zaroori hai. Hybrid setup ke liye `VERCEL_DEPLOYMENT.md` follow karein. Full backend ko Vercel serverless functions par deploy na karein.

## 1. Hosting aur database tayyar karein

1. Node.js **22.x** install karein.
2. Neon par aik PostgreSQL database/project banayein. Is project ke liye **aik hi** `DATABASE_URL` use hoga; `public`, `workforce` aur `marketing` sirf schemas hain.
3. Neon ka SSL-enabled connection string copy karein. Connection pooler URL (`-pooler`) application ke normal runtime ke liye use kiya ja sakta hai.
4. Database role ko migration ke waqt schemas/tables/indexes aur required extensions create karne ki permission honi chahiye.
5. Apne persistent Node host par project ZIP extract karein. Host par aik long-running service/process banayein; service ko crash par restart karne ka option enable karein.

## 2. Environment configuration

Project root par terminal mein:

```bash
npm run setup
```

Is se root `.env` create hoti hai, `COOKIE_SECRET` automatically random banta hai aur root/client packages install hote hain. `.env.example` ko manually copy karna zaroori nahi. Ab root `.env` mein yeh values set karein:

| Variable | Kya set karna hai |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | Hosting ka assigned port; warna `4000` |
| `APP_URL` | Aapki actual HTTPS website URL, misal `https://erp.example.com` |
| `DATABASE_URL` | Neon ka aik shared PostgreSQL connection string |
| `DATABASE_SSL` | `true` |
| `COOKIE_SECRET` | Setup se generate hua 96-character hex secret; kam az kam 32 characters |
| `PERSISTENCE_DRIVER` | `postgres` |
| `DB_SCHEMA` | `marketing` (Marketing schema ka fixed selector; separate DB nahi) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | `https://your-domain/api/auth/google/callback` |
| `BUSINESS_TIMEZONE` / `TZ` | `Asia/Karachi` |

Google Cloud Console mein OAuth redirect URI ko bilkul isi URL se match karein. `APP_URL` aur OAuth URL mein apna real domain use karein. SMTP/WhatsApp values optional hain; un integrations ko use karne se pehle unke valid credentials configure karein.

**Zaroori:** sirf root `.env` use hoti hai. `marketing-backend/.env.example` sirf reference note hai. `MARKETING_DATABASE_URL`, `DB_HOST` ya doosra database URL configure na karein. Teenon modules root `DATABASE_URL` share karte hain. Secrets ko source code, ZIP, Git repository ya chat mein commit/share na karein.

## 3. Fresh database migrations

Naye/empty Neon database ko root folder se prepare karein:

```bash
npm run migrate
```

Yeh command isi aik database mein ERP `public`, Salary/Attendance `workforce` aur Marketing `marketing` schemas ko migrate karti hai. Is mein Marketing ki 18 numbered migrations `database/migrations/001...018` shamil hain. Migration records version/checksum ke saath track hote hain.

Is ZIP ke SQL migrations sample employees, sample payroll, demo transactions ya fake ad expenses insert nahi karte. Production mein optional legacy `seed`/demo scripts na chalayein. Naya database business data ke lihaz se khaali rahega jab tak aap real users aur records add/import nahi karte.

**Existing database par reset command na chalayein.** `npm run db:reset` destructive hai. Is deployment ke liye normal unified migration command `npm run migrate` hai.

## 4. Build aur persistent service start

```bash
npm run build
npm start
```

Host par start command `npm start` set karein aur working directory project root ho. Node process ko continuously running rehna chahiye; yeh process ERP HTTP API, Workforce API, Marketing ad-sync scheduler aur daily scheduled jobs chalayega. Marketing API ko alag server/port par deploy ya start na karein. `vercel.json`/serverless entry full integrated runtime ka supported deployment target nahi hai.

Health check ke liye `https://your-domain/api/health` kholein. Successful response mein database connected hona chahiye.

## 5. Pehli dafa login aur permissions

1. Website kholein aur ERP ka first-time setup complete karein; Google OAuth verification ke baad pehla authorized account Super Admin banega.
2. Staff accounts ko ERP Admin Settings → Users & Roles se approve karein.
3. HR/payroll staff ko **Salary** view/edit permissions assign karein. Salary Manager/Analyzer aur Attendance sidebar entries un users se hide hongi jin ke paas Salary view permission nahi. Direct URL aur backend API bhi permission check karte hain.
4. Marketing Analyzer ke liye Admin Settings → Users & Roles mein **Marketing Expense Analyzer** permission alag se grant karein; data change karne ke liye is permission ka Edit level chahiye. General Expenses permission is se separate hai.
5. Employee apni salary slip ke liye **My Salary** self-service use karein.
6. Attendance policies, shifts, holidays, overtime, leaves, commissions, advances aur payroll adjustments ko Salary Manager ke Policy/related operational sections mein review karein. User account/role access global Admin Settings mein rahega. Cash budgets, treasury, cashflow/payment controls Cash Flow Manager mein rahenge.

## 6. Attendance app

Existing Flutter source `server/workforce/attendance_flutter` mein preserved hai. App ka API base ScholarshipHive host ke `/api/workforce` endpoints par point hona chahiye. Device-specific attendance authentication/session model retained hai; web Salary Analyzer ke liye ERP login/permissions use hote hain. Is ZIP mein future Android app ka naya compiled package ya Play Store release shamil nahi. Flutter source ko apne Android build environment mein build/sign karna hoga.

## 7. Historical data limitation

Uploaded source ZIPs mein live Neon/database dump, original production users, ya Salary Analyzer historical records ka backup shamil nahi tha. Is liye source code, calculation engines, policies/migrations aur import tooling preserve ki gayi hai, lekin purane payroll_months ya historical attendance records is fresh database mein fabricate/copy nahi kiye gaye. Historical data chahiye to authorized original DB backup export karein, backup ki copy par restore/import test karein, phir production import karein. Original Analyzer import/backup tools ko `server/workforce` mein review karein.

## 8. Tests

Tests production database par kabhi na chalayein. Destructive integration tests ke liye separate throw-away PostgreSQL database banayein, uska naam `test` par end/contain ho, aur root `.env` mein `TEST_DATABASE_URL` set karein. Is database ko tests reset kar sakte hain. Phir:

```bash
npm test
```

`TEST_DATABASE_URL` na ho to ERP aur Workforce database integration suites skip ho jati hain. Marketing ke test runner alag test-only in-memory fixtures use karta hai.

## 9. Backup aur security checklist

- Neon automated backups/PITR ya daily encrypted logical backups enable karein aur restore test schedule karein.
- DB credentials aur OAuth secrets private rakhein; host environment variables/secret manager mein rakhein.
- Admin access limited rakhein; har employee ko sirf required module permissions dein.
- Production mein `GOOGLE_DEV_BYPASS=false` rakhein.
- HTTPS enforce karein; reverse-proxy trust settings sirf aapke host ke actual proxy setup ke mutabiq configure karein.
- Payroll paid action accounting record update karta hai; yeh bank transfer initiate nahi karta.
- Deployment ke baad backup restore, Google OAuth, permissions, attendance device flow aur ad-platform integrations ko staging/test accounts se verify karein. ZIP ko third-party penetration test ya live hosting deployment samajh kar na chalayein.
