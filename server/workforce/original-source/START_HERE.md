# START HERE — exact command order (Windows + VS Code)

First time? Install the prerequisites in **SETUP_WINDOWS.md §1** (Node.js 20/22 LTS,
PostgreSQL 16, VS Code, and Flutter only if you will run the mobile app).

All commands are typed in **VS Code › Terminal › New Terminal** (PowerShell), starting
in the project folder `Integrated_ERP`.

## One-time setup

```powershell
# 1. Install all JavaScript dependencies (backend + web dashboard)
npm install

# 2. Create your environment file, then open it and replace YOUR_PASSWORD
Copy-Item backend\.env.example backend\.env
code backend\.env

# 3. Create the database, build the tables, load the admin + demo data
npm run db:create
npm run db:migrate
npm run db:seed
```

`npm run db:seed` prints the **admin password** and demo passwords once and saves
them to `backend\.seed-credentials.txt`. Note them, then delete that file.
(Set `SEED_ADMIN_PASSWORD` in `.env` before seeding if you want to choose it.)

## Every day

| Terminal | Command | What it runs | Open |
|---|---|---|---|
| **Terminal 1** | `npm run dev` | API (port 4000) **and** web dashboard (port 5173) together | Chrome → http://localhost:5173 |
| Terminal 2 *(optional)* | `cd attendance_flutter` then `flutter run -d chrome --web-port 8080` | Flutter Attendance app in Chrome, talking to the API | opens automatically |

Prefer separate terminals? `npm run dev:api` in one and `npm run dev:web` in another.

Sign in at http://localhost:5173 with `admin` and the printed password.

## First things to do in the dashboard
1. **Policy Settings › Attendance security → Use my current IP → Add network**
   (checkout from the Attendance app is only allowed from an approved network — same rule as before).
2. **Employees** → check base salaries; map any imported attendance logins.
3. **Commissions** → set each employee's fixed commission %.

## Check it works
```powershell
curl.exe http://localhost:4000/api/health          # {"success":true,"status":"ok",...}
npm test                                            # 41 automated tests against a separate test database
```

## Production-style single server
```powershell
npm run build      # builds the web dashboard into frontend\dist
npm start          # API + dashboard on http://localhost:4000
```

## Importing your existing data (optional)
See `database/documentation/03_MIGRATION_STRATEGY.md`:
```powershell
npm run db:backup
npm run import:d1 -w backend -- --file ..\legacy\attendance_worker\d1-export.sql --dry-run
npm run import:sqlite -w backend -- --dry-run
```

Something wrong? → **TROUBLESHOOTING.md**
