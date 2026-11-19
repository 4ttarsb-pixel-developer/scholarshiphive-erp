# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `DATABASE_URL is not set` | No `backend\.env` | `Copy-Item backend\.env.example backend\.env` and edit it |
| `password authentication failed for user "postgres"` | Wrong password in `.env` | Fix `YOUR_PASSWORD`; URL-encode special characters (`@`→`%40`, `#`→`%23`) |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL service not running | Windows → Services → **postgresql-x64-16** → Start |
| `database "workforce_erp" does not exist` | Not created | `npm run db:create` |
| `[startup] N database migration(s) pending` | New migrations | `npm run db:migrate` |
| `'knex' is not recognized` / missing modules | Dependencies not installed | Run `npm install` in the **project root** |
| PowerShell: "running scripts is disabled" | Execution policy | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Port 4000 or 5173 already in use | Another process | Close the other terminal, or set `PORT=4001` in `.env` and `VITE_BACKEND_URL=http://localhost:4001` before `npm run dev:web` |
| Dashboard shows "Cannot reach the server" | API not running | Start Terminal 1 (`npm run dev`) and check http://localhost:4000/api/health |
| Login works but page immediately returns to sign-in | Cookie blocked / wrong host | Use http://localhost:5173 (not 127.0.0.1 mixed with localhost) |
| Seed printed passwords but I lost them | — | `npm run user:create-admin -w backend -- admin NewPassword123` |
| "Account temporarily locked" | 10 wrong passwords | Wait 15 minutes, or reset via `user:create-admin` / Policy Settings › Users & roles |
| Flutter: `Network or server issue` / `XMLHttpRequest error` | Wrong API URL | Chrome build uses http://localhost:4000. Emulator: `--dart-define=API_BASE_URL=http://10.0.2.2:4000`. Phone: PC LAN IP + firewall rule (SETUP_WINDOWS §7) |
| Flutter: "This network is not approved for attendance" | Office network rules exist and don't include the device's IP | Policy Settings › Attendance security: add the IP shown in the message (or your LAN range) |
| Flutter: "Checkout is blocked until an office Wi-Fi/IP is configured" | No network rule yet (rule preserved from the original build) | Add the office network. For local testing only you may set `CHECKOUT_REQUIRES_NETWORK_RULE=false` |
| Flutter: "This device is registered to another employee" | Device binding (preserved) | Policy Settings › Attendance security → Reset device |
| Reception screen: "An active attendance session is required" | Old APK without the new session header | Install the updated app; temporarily `LEGACY_OPEN_RECEPTION_ENDPOINTS=true` |
| Employee checks in but nothing in payroll | Login not mapped to an employee | Employees › Unmapped attendance logins → Map to employee |
| "Payroll for 2026-09 is already approved…" | Month locked (by design) | Use a payroll adjustment in the next open month |
| Approve button disabled / "blocked" | Unresolved blockers | Open the Exception Queue: missing punches, pending leave, severe late review, pending corrections/adjustments, base salary = 0 |
| Every employee shows a big "pro-rata" deduction | Joining date set to today | Edit the employee's joining date |
| `npm run db:backup` fails | `pg_dump` not on PATH | Add `C:\Program Files\PostgreSQL\16\bin` to PATH, or back up in pgAdmin |
| `npm test` "Refusing to run tests" | `TEST_DATABASE_URL` name lacks "test" | Use `.../workforce_erp_test` |
| Live updates show "Reconnecting…" | SSE blocked by a proxy | Data still refreshes on focus/every minute; for nginx disable buffering on `/api/events` |
| Times look 5 hours off | Wrong timezone | `BUSINESS_TIMEZONE=Asia/Karachi` in `.env`; policy timezone in Policy Settings |
