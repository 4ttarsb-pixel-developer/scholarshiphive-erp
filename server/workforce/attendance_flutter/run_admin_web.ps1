# The Attendance Administration web page is now served by the unified backend.
# Start the backend first (see START_HERE.md), then run this script.
$ErrorActionPreference = "Stop"
$Url = "http://localhost:4000/attendance-admin"
Write-Host "Opening $Url (served by the Express + PostgreSQL backend)" -ForegroundColor Cyan
Start-Process $Url
