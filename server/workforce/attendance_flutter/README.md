> ## ⚠ Integrated build (Workforce ERP)
> This app now talks to the unified **Express + PostgreSQL** backend in `../backend`
> (default `http://localhost:4000`). The Cloudflare Worker / D1 and the ASP.NET API are
> retired (see `../legacy/README_LEGACY.md`). Screens and flows are unchanged.
>
> * Run: `flutter pub get` then `flutter run -d chrome --web-port 8080`
> * Emulator: `--dart-define=API_BASE_URL=http://10.0.2.2:4000` · Phone: `--dart-define=API_BASE_URL=http://<PC-IP>:4000`
> * APK: `.\build_mobile_apk.ps1 -BackendUrl http://<server>:4000`
> * Code changes: `lib/services/attendance_service.dart` (default URL + `ApiConfig.sessionHeaders`),
>   `lib/screens/reception_dashboard_screen.dart` and `lib/screens/home_screen.dart`
>   (send `X-Attendance-Session`, required now that visitor/consent data is protected).
> * Older notes below (Cloudflare deployment etc.) describe the previous architecture.

# Attendance Administration

This workspace contains a Flutter attendance/reception app and an ASP.NET Core
10 API. The API and its SQLite database are the source of truth for attendance,
device registrations, notices, visitor records, leave requests, shifts, and
login/IP activity.

## Run locally

Start the API from `AttendanceTestApi`:

```powershell
dotnet run
```

The launch profile serves HTTP on `http://localhost:5267`. Start the Flutter
app from the project root:

```powershell
flutter run
```

For an Android emulator, `localhost` means the emulator itself. Point Flutter
at the host machine's emulator bridge address when launching:

```powershell
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:5267
```

For a physical device, set `API_BASE_URL` to the reachable HTTPS URL of the API.
Do not expose the development HTTP endpoint to an untrusted network.

The API stores `attendance.db` under its content root by default. Set
`Attendance__DatabasePath` to use a different database location. On startup it
creates missing tables and adds the `Email` column to older `AppUsers` tables;
existing rows are retained.

## Network and email configuration

Office-network validation is enabled by setting one or more allowed IP ranges,
for example:

```powershell
$env:Attendance__AllowedNetworks__0 = "192.168.1.0/24"
dotnet run
```

When no allowed range is configured, the API permits networks for backward
compatibility and reports `networkRestrictionConfigured: false`. Configure
office CIDR ranges before relying on IP-based access control. When deployed
behind a reverse proxy, configure trusted forwarded-header handling before
using client IP restrictions.

Security notification email is disabled unless `Email__Sender`,
`Email__Password`, and `Email__AdminRecipient` are configured. Optional
`Email__SmtpHost` and `Email__SmtpPort` settings can override the Gmail defaults.
Do not put SMTP credentials in source control.

## Attendance flow

1. The Flutter splash screen calls `GET /api/attendance/check-network`.
2. Login calls `POST /api/attendance/login`; the API validates credentials,
   checks any configured IP range, checks the device binding, writes the login
   activity, and creates or resumes the day's attendance record.
   Employees can register fingerprint sign-in from **Change Password** using
   their current password and a device biometric prompt. The API associates a
   one-time secret with that employee and their already-bound device, stores
   only its SHA-256 hash, and accepts that secret at the existing login route
   after the device biometric check. The secret is stored in platform-secure
   storage; biometric templates and employee passwords are not stored by the
   fingerprint flow. Fingerprint sign-in is unavailable on web.
3. Employee check-out calls `POST /api/attendance/verify-checkout`, then
   submits the required report to `POST /api/attendance/submit-report`. The API
   verifies the open session and configured network before recording check-out.
4. Reception, leave, shift, and notice workflows continue to use their existing
   API routes and the same SQLite database.

The management login returns a short-lived, in-memory bearer token. Existing
management functions and the attendance administration screen use this token;
admin API requests without a valid management token are rejected. Tokens expire
after eight hours and are invalidated when the API process restarts.

## Attendance Administration screen

Sign in with a management account and use the **Attendance Administration**
button on the management console. The screen reads live API/database data:

| Screen | Backend route | Actions |
| --- | --- | --- |
| Overview cards and recent activity | `GET /api/admin/dashboard` | Refresh counts/activity |
| Attendance & Reports | `GET /api/admin/attendance` | Search, user/date/status filters, reset, refresh |
| Attendance CSV | `GET /api/admin/attendance/export` | Downloads the filtered CSV in a browser |
| Users & Devices | `GET /api/admin/users` | Search users and see email/device/IP binding |
| Reset device | `POST /api/admin/devices/{id}/reset` | Removes that binding and writes an audit event |
| Login & IP Logs | `GET /api/admin/ip-logs` | Search, user/date/allow-status filters |
| Register employee fingerprint sign-in | `POST /api/attendance/register-biometric` | Verifies current password, network, and existing employee-device binding |

The dashboard API limits large table responses to keep browser requests
bounded. CSV output is generated by the backend with the same selected filters.
On non-web Flutter platforms the CSV is copied to the clipboard instead of
downloaded as a file.

## Existing management routes

The management console also uses:

- `GET /api/admin/overview`
- `POST /api/admin/leave/action`
- `POST /api/admin/shift/action`
- `POST /api/admin/notes/create`
- `DELETE /api/admin/notes/delete/{id}`

The reception app continues to use visitor and consent routes. Employee notices
are read from `GET /api/notes/feed/{username}`. CCTV login currently returns
configured camera metadata; it is not a camera-streaming implementation.

## Deployment notes

- Replace the development seed accounts/passwords before production use.
  Employee passwords are stored as salted PBKDF2 hashes; existing plaintext
  database passwords are upgraded to hashes on API startup.
- Add a schema migration process before evolving SQLite models beyond the
  backward-compatible `Email` column addition.
- Restrict CORS to the actual dashboard origins in production and serve the API
  over HTTPS.
- `Email` is blank for previously stored users until it is populated.


## Quick start on Windows

Open one PowerShell terminal for the backend:

```powershell
Set-Location "C:\Users\Nabeel Ahmad\Desktop\saad attendance app\attendance_app_final - Copy\AttendanceTestApi"
dotnet run
```

Open a second terminal for Flutter Web:

```powershell
Set-Location "C:\Users\Nabeel Ahmad\Desktop\saad attendance app\attendance_app_final - Copy"
flutter pub get
flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:5267
```

The configured HTTP launch profile uses port `5267`; keep the Flutter
`API_BASE_URL` pointed at the same port.






### Commands

# =========================================================
# TERMINAL 1 = BACKEND
# =========================================================

cd "C:\Users\Nabeel Ahmad\Desktop\saad attendance app\attendance_app_final - Copy\AttendanceTestApi"

dotnet run --urls "http://0.0.0.0:5267"

# Jab ye lines aa jayein:
# Now listening on: http://localhost:5267
# Application started. Press Ctrl+C to shut down.
#
# Terminal 1 ko OPEN rehne dena.
# Isko band nahi karna. 


# =========================================================
# TERMINAL 2 = FLUTTER WEB / FRONTEND
# =========================================================

cd "C:\Users\Nabeel Ahmad\Desktop\saad attendance app\attendance_app_final - Copy"

flutter pub get

flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:5267

# Flutter browser me open ho jayega.
# Terminal 2 ko bhi OPEN rehne dena.


# =========================================================
# AGAR PEHLE BACKEND TEST KARNA HO
# Terminal 2 me Flutter run karne se PEHLE ye command chala sakte ho:
# =========================================================

Invoke-RestMethod "http://localhost:5267/api/attendance/check-network"

# Expected:
# allowed = True


# =========================================================
# WEB ATTENDANCE ADMIN PANEL
# =========================================================

Start-Process "http://localhost:5267/admin"

# Ya browser me manually kholo:
# http://localhost:5267/admin


# =========================================================
# ADMIN LOGIN
# =========================================================

# Username:
# owner

# Password:
# 123


# =========================================================
# AGAR ANDROID EMULATOR PAR FLUTTER CHALANA HO
# Chrome wali flutter run command ki jagah:
# =========================================================

flutter devices

# Agar emulator-5556 show ho:
flutter run -d emulator-5556 --dart-define=API_BASE_URL=http://10.0.2.2:5267


# =========================================================
# SIMPLE YAAD RAKHO
# =========================================================

# TERMINAL 1:
# Backend
# dotnet run

# TERMINAL 2:
# Flutter
# flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:5267

# BROWSER:
# Admin Panel
# http://localhost:5267/admin


# =========================================================
# PROJECT BAND KARNA HO
# =========================================================

# Terminal 1 me:
# Ctrl + C

# Terminal 2 me:
# Ctrl + C