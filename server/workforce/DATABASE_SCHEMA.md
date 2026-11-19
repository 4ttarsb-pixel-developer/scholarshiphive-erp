# Database schema (PostgreSQL 14+)

All money is `NUMERIC(14,2)`, percentages `NUMERIC(7,3)`, times `TIMESTAMPTZ`,
business dates `DATE`. The full DDL is in `../schema.sql`.

## Identity & access
| Table | Notes |
|---|---|
| `users` | One login. `attendance_role` keeps the Flutter role (Owner, Receptionist, Staff…) so app routing is unchanged. `employee_id` UNIQUE → a login maps to at most one employee. Passwords: scrypt (legacy PBKDF2 / SHA-256 accepted once and upgraded). |
| `roles`, `permissions`, `role_permissions`, `user_roles` | RBAC: `ADMIN`, `HR`, `REVENUE_MANAGER`, `EMPLOYEE`, 27 permission codes. |
| `auth_sessions` | Opaque tokens; only `sha256(token)` stored. Web = httpOnly cookie, mobile/Flutter admin = Bearer. |

## Employees & calendar
| Table | Notes |
|---|---|
| `employees` | `employee_code` unique (case-insensitive) — the payroll identity; never matched by name. `base_salary ≥ 0`, `employment_status` check, `leaving_date ≥ joining_date`. |
| `departments`, `shifts` | Shifts may cross midnight (end < start). |
| `work_schedules` | Weekly working days; `employee_id NULL` = company default; versioned by `effective_from`. |
| `holidays` | Excluded from scheduled days; never an absence. |

## Attendance
| Table | Notes |
|---|---|
| `attendance_sessions` | Raw check-in/out from the Flutter app. `session_id` = the UUID Flutter holds. **Partial unique index `(user_id) WHERE is_active`** → impossible to have two open sessions → no duplicate paid day. `business_date` is the shift date (overnight aware). |
| `network_disconnect_logs` | Away intervals; merged and subtracted from office time (Worker formula). |
| `attendance_records` | Official day status, **UNIQUE (employee_id, attendance_date)**. Computed only by the server engine. Statuses: Present, Late, Absent, PaidLeave, UnpaidLeave, PendingLeave, MissingCheckIn, MissingCheckOut, Holiday, WeeklyOff, NotEmployed, Upcoming. |
| `attendance_corrections` | Request → approve flow; reason ≥ 5 chars (CHECK); one pending per employee-day (partial unique). |
| `leave_requests` | Range or half-day; Approved requires `pay_type` Paid/Unpaid (CHECK). |
| `shift_requests` | Preserved Flutter shift requests; approval assigns the matching shift. |
| `office_network_rules`, `device_bindings`, `activity_logs` | Preserved attendance security (device ↔ user both UNIQUE). |
| `notes_notifications`, `visitor_records`, `consent_forms` | Preserved reception / announcement features. |

## Revenue & commission
| Table | Notes |
|---|---|
| `commission_settings` | One fixed % per employee (0–100). |
| `commission_rate_history` | Every rate change with reason and user. |
| `revenue_sales` | **UNIQUE upper(sale_reference)**. Stores `commission_method`, `applied_rate_percent`, `commission_amount`, `accounting_month`. **CHECK commission_amount = round(sale_amount × rate / 100, 2)** — the database itself rejects a wrong commission. |
| `commission_entries` | Ledger, **UNIQUE (sale_id)** → one commission per sale forever. `payroll_record_id` set when paid in approved payroll; a trigger then forbids changing it. |

## Payroll
| Table | Notes |
|---|---|
| `payroll_periods` | One per month (cut-off aware). |
| `payroll_records` | **UNIQUE (period_id, employee_id)**. Totals + blockers/warnings JSON + immutable `snapshot` (required by CHECK when Approved/Paid). Trigger `payroll_records_lock` rejects any change to amounts/snapshot of Approved/Paid rows and any delete. |
| `payroll_line_items` | Every amount on the payslip; trigger blocks edits once the record is locked. |
| `payroll_approvals` | SUBMIT/APPROVE/REJECT/REOPEN/MARK_PAID history; partial unique indexes → APPROVE and MARK_PAID can happen **once** per record. |
| `payment_records` | **UNIQUE (payroll_record_id)** + unique `idempotency_key`. Records only — no bank transfer. |
| `payroll_adjustments` | Bonuses, authorised deductions, post-approval corrections (e.g. commission reversal). Pending ones block approval. |
| `salary_advances` | Amount, installment, remaining balance (CHECKs ensure ≤ amount, ≥ 0). |
| `advance_recoveries` | **UNIQUE (advance_id, payroll_record_id)** → an installment is recovered exactly once. Written inside the approval transaction. |
| `attendance_policies` | Versioned policy (grace, tiers, basis, rounding, cap, paid-leave allowance, cut-off…). |

## Audit & imports
| Table | Notes |
|---|---|
| `audit_logs` | Append-only (trigger rejects UPDATE/DELETE except FK nulling of a removed user). |
| `import_batches` | UNIQUE (source, sha256 of file) → the same legacy export can never be imported twice. |
| `idempotency_keys` | Reserved for idempotent API replays. |
