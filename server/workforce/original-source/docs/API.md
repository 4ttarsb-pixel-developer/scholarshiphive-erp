# API reference

Base URL: `http://localhost:4000`. JSON in/out. Errors: `{ "success": false, "message": "...", "details"?: [...] }`.

**Auth**
* Web dashboard: `POST /api/auth/login` sets an httpOnly cookie; state-changing requests must send `X-Requested-With: XMLHttpRequest`.
* API clients: `POST /api/auth/login` with `"client":"mobile"` returns `token` → send `Authorization: Bearer <token>`.
* Flutter management: the `adminToken` returned by `/api/attendance/login` is a Bearer token.
* Money values are decimal strings (`"61000.00"`), percentages strings (`"3.000"`). Months are `YYYY-MM`.

Permission names are in brackets.

## Health & auth
| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | DB check |
| POST | `/api/auth/login` | `{username,password,client?}` (rate-limited, lockout after 10 failures) |
| POST | `/api/auth/logout` | |
| GET | `/api/auth/me` | user, roles, permissions |
| POST | `/api/auth/change-password` | `{currentPassword,newPassword}` |
| GET | `/api/events` | Server-Sent Events: `change` events `{type, employeeId?, month?}` |

## Employees [employees.view / employees.manage]
| GET | `/api/employees?search=&status=&department=&includeInactive=` | list (+ current-month payment status) |
|---|---|---|
| GET | `/api/employees/:id` | |
| POST | `/api/employees` | `{employeeCode, fullName, department, designation, joiningDate, baseSalary, shiftId?, fixedCommissionPercent?, username?, password?}` |
| PATCH | `/api/employees/:id` | any of the above except code; `employmentStatus` Active/Inactive/Terminated + `leavingDate` (deactivates login) |
| GET | `/api/employees/unmapped-logins` | attendance logins not linked to an employee |
| POST | `/api/employees/:id/link-user` | `{userId, confirmUsername}` — verified mapping, back-fills unlocked attendance |
| POST | `/api/employees/:id/create-login` | `{username,password}` |
| GET | `/api/departments` | |

## Attendance (ERP) 
| GET | `/api/attendance?month=&employeeId=&date=&status=&includeUpcoming=` | official day records [attendance.view_all] |
|---|---|---|
| GET | `/api/attendance/employee/:id?month=` | own or [attendance.view_all] |
| GET | `/api/attendance/live` | today's sessions [attendance.view_all] |
| GET | `/api/attendance/export?month=` | CSV |
| POST | `/api/attendance/check-in` | authenticated user, network rules enforced |
| POST | `/api/attendance/check-out` | `{report?}` |
| GET | `/api/attendance/corrections?status=` | |
| POST | `/api/attendance/corrections` | `{employeeId, attendanceDate, requestedStatus(Present/Absent/PaidLeave/UnpaidLeave/Holiday/WeeklyOff/Recompute), checkIn?, checkOut?, reason, autoApprove?}` [attendance.manage] |
| POST | `/api/attendance/corrections/:id/decide` | `{decision: Approved/Rejected, note?, checkIn?, checkOut?}` [attendance.approve_corrections] |
| POST | `/api/attendance/review` | `{employeeId, date, note}` severe-late review |

## Leave [leave.manage]
| GET | `/api/leaves?status=&employeeId=&month=&search=` | |
|---|---|---|
| POST | `/api/leaves` | `{employeeId, leaveType, startDate, endDate?, halfDay?, reason}` |
| POST | `/api/leaves/:id/approve` | `{payType: Paid/Unpaid, note?}` |
| POST | `/api/leaves/:id/reject` | `{note}` |
| POST | `/api/leaves/:id/cancel` | |

## Revenue [revenue.*]
| GET | `/api/revenue?month=&employeeId=&status=&search=` | |
|---|---|---|
| POST | `/api/revenue` | `{employeeId, saleReference, saleDate, saleAmount, units?, commissionMethod: FIXED_EMPLOYEE / MANUAL_PERCENT, manualRatePercent? (manual only), notes?, verifyNow?, isDemo?}` → 409 on duplicate reference |
| PATCH | `/api/revenue/:id` | edit Pending/Verified unlocked sale; `{version}` for optimistic locking; FIXED keeps its historical rate |
| POST | `/api/revenue/:id/verify` | idempotent |
| POST | `/api/revenue/:id/reject` | `{reason}` Pending only |
| POST | `/api/revenue/:id/cancel` | `{reason}` Pending/Verified; locked → pending reversal adjustment |
| GET | `/api/revenue/export?month=` | CSV |

## Commissions
| GET | `/api/commissions?month=` | per-employee summary + verified entries |
|---|---|---|
| GET | `/api/commissions/employee/:id?month=` | |
| GET | `/api/commission-settings/:employeeId` | `{fixedRatePercent, history[]}` |
| PUT | `/api/commission-settings/:employeeId` | `{fixedRatePercent, reason}` [commission.settings] |

## Payroll
| GET | `/api/payroll?month=&status=&search=` | all records (Draft records refreshed) [payroll.view] |
|---|---|---|
| GET | `/api/payroll/:employeeId?month=` | full detail: totals, lines, blockers, warnings, commissions, attendance summary |
| POST | `/api/payroll/calculate` | `{month, employeeIds?}` force recalculation [payroll.calculate] |
| POST | `/api/payroll/approve-bulk/preview` | `{ids}` → `{eligible[], blocked[]}` |
| POST | `/api/payroll/approve-bulk` | `{ids, note?}` → `{approved[], blocked[]}` [payroll.approve] |
| POST | `/api/payroll/reject-bulk` | `{ids, reason}` |
| POST | `/api/payroll/:id/submit` | Draft → Under Review |
| POST | `/api/payroll/:id/reopen` | Rejected → Draft |
| POST | `/api/payroll/:id/mark-paid` | `{paymentDate, paymentMethod, paymentReference, remarks?}` + optional `Idempotency-Key` header [payroll.pay] |
| GET | `/api/payroll/:id/payslip` | own or [payroll.view]; `official` true when Approved/Paid |
| POST | `/api/payroll/:id/bonus-deduction` | `{bonus, otherDeduction, reason}` [payroll.adjust] |
| GET | `/api/payroll/export?month=` | CSV |
| GET/POST | `/api/payroll-adjustments` | `{employeeId, periodMonth, adjustmentType EARNING/DEDUCTION, category, amount, reason, approveNow?}` |
| POST | `/api/payroll-adjustments/:id/approve|reject|cancel` | |

## Salary advances [advances.*]
| GET | `/api/advances?status=&employeeId=` | includes recovery history |
|---|---|---|
| GET | `/api/advances/employee/:id` | |
| POST | `/api/advances` | `{employeeId, amount, monthlyRecovery, advanceDate, recoveryStartMonth, reason, approveNow?}` |
| POST | `/api/advances/:id/approve|reject|cancel` | |

## Policy, calendar [policy.manage]
| GET | `/api/policies/current?date=` · `/api/policies` | current / history |
|---|---|---|
| POST | `/api/policies` | new version (see `04_PAYROLL_RULES.md` for fields), `reason` required |
| GET/POST/DELETE | `/api/holidays` | `{date, name, isPaid}` |
| GET/POST/PATCH | `/api/shifts` | `{name, startTime, endTime, breakMinutes}` |
| GET/PUT | `/api/schedules` | `{employeeId?, workingDays:[0..6], effectiveFrom?}` |

## Reports, audit, users
| GET | `/api/dashboard?month=` | KPIs + records |
|---|---|---|
| GET | `/api/exceptions?month=` | flattened blockers |
| GET | `/api/audit?search=` · `/api/audit/export` | [audit.view] |
| GET | `/api/users` · `/api/roles` | [users.manage] |
| PUT | `/api/users/:id/roles` | `{roles:[codes]}` |
| POST | `/api/users/:id/reset-password` | `{newPassword}` |
| PUT | `/api/roles/:code/permissions` | `{permissions:[codes]}` |
| POST | `/api/import/localstorage` | `{data, dryRun, includeDemoAttendance, backupConfirmed}` |

## Employee self-service
| GET | `/api/me/overview?month=` | own employee, statement, attendance, leave, advances |
|---|---|---|
| GET | `/api/me/payslips` | approved/paid months |
| POST | `/api/me/leaves` · `/api/me/leaves/:id/cancel` | |

## Flutter / attendance-admin compatibility (same contract as the old Cloudflare Worker)
| Method | Path | Auth |
|---|---|---|
| GET/POST | `/api/attendance/check-network` | none |
| POST | `/api/attendance/login` | username + password or biometricToken + deviceId |
| POST | `/api/attendance/register-biometric`, `/change-password` | credentials |
| GET | `/api/attendance/session-status?sessionId=` | none |
| POST | `/api/attendance/network-interval`, `/network-disconnected`, `/network-reconnected` | sessionId |
| POST | `/api/attendance/verify-checkout`, `/submit-report` | sessionId + approved network |
| POST | `/api/attendance/shift/select`, `/leave/apply`, `/leave/status` | username + password |
| GET | `/api/notes/feed/:username?team=` | `X-Attendance-Session` of that user |
| POST/GET | `/api/reception/visitor/register|list|checkout/:id`, `/api/consent/create-or-send|list|mark-signed/:id` | `X-Attendance-Session` (receptionist/management) or Bearer |
| POST | `/api/reception/cctv/login` | credentials + CCTV access |
| POST | `/api/admin/web-login` | management credentials |
| GET/DELETE | `/api/admin/session` | Bearer |
| GET/POST/DELETE | `/api/admin/networks`, `/api/admin/networks/current-ip`, `/api/admin/networks/:id` | Bearer |
| GET | `/api/admin/overview`, `/dashboard`, `/attendance`, `/attendance/export`, `/attendance/export-separate`, `/users`, `/ip-logs`, `/network-disconnects` | Bearer |
| POST | `/api/admin/users`, `/devices/:id/reset`, `/leave/action`, `/shift/action`, `/notes/create` | Bearer |
| DELETE | `/api/admin/users/:id` (deactivates, history kept), `/api/admin/notes/delete/:id` | Bearer |
