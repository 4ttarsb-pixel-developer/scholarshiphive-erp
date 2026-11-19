# Payroll calculation rules (server-side)

Source: `backend/src/services/attendance-engine.js` and `payroll-engine.js`.
The frontend never calculates final figures; it displays what PostgreSQL holds.

## 1. One status per employee-day
For each date of the payroll period (in the business timezone, default Asia/Karachi):

1. Before joining / after leaving → **NotEmployed** (scheduled working days are pro-rated out).
2. An **approved correction** for that day overrides everything (Present with times, Absent, Paid/Unpaid leave, Holiday, Weekly off; "Revert" removes the override).
3. Holiday or weekly-off day → **Holiday / WeeklyOff**; if the employee worked, **Present** (never late, never absent).
4. Approved full-day leave and no attendance → **PaidLeave / UnpaidLeave**. Attending on a leave day keeps the leave unused.
5. Sessions exist → **Present** or **Late** (late > grace). A session closed without check-out, or still open 4 h after shift end → **MissingCheckOut** (blocker).
6. No sessions: pending "present" correction → **MissingCheckIn** (blocker); pending leave → **PendingLeave** (blocker); future / shift not finished → **Upcoming**; otherwise **Absent** (this includes a rejected leave — counted once).

**Shift date for overnight shifts**: a check-in up to 6 h before shift start or before shift end belongs to that shift (21:00–06:00 shift: 01:30 belongs to the previous date).
**Late minutes** = first check-in − scheduled start. **Early departure** = scheduled end − last check-out.
**Worked time** = Σ (check-out − check-in − merged network-away intervals), same as the Worker.

## 2. Daily rate
`daily rate = base salary ÷ divisor`, divisor per policy:
* `schedule` (default): scheduled working days in the period (schedule minus holidays)
* `fixed`: e.g. 26 or 30
* `calendar`: days in the period

## 3. Formula
```
Gross Earnings   = Base Salary + Verified Commission + Approved Bonus
Total Deductions = Attendance Deductions + Unpaid Leave Deductions + Advance Recovery + Other Authorised Deductions
Net Salary       = Gross Earnings − Total Deductions
```
* **Attendance deductions**: late (if enabled) + early departure (if enabled) + absences (daily rate each, if enabled) + pro-rata for days outside employment.
* **Unpaid leave deductions**: unpaid leave days + paid leave beyond the monthly allowance + unpaid holidays.
* **Advance recovery**: `min(monthly installment, remaining balance)` for each Active advance whose recovery has started.
* **Bonus / other deductions**: Approved payroll adjustments for that month.

Every amount is a line item rounded half-up to 2 decimals with decimal.js; totals are sums of the rounded lines, so payslip = dashboard = database.

## 4. Late policy (configurable, OFF by default)
* Grace period (minutes) — no penalty within grace.
* **Tiered**: highest tier reached applies once per late day, e.g. ≥ 60 min → 5 %, ≥ 120 min → 10 %.
* **Per hour**: rate % × hours, rounded by *started hour* or *exact minutes*.
* Basis: daily salary or monthly salary. Monthly cap: % of base (late + early combined).
* Severe late (≥ threshold) needs a manager review before approval (configurable); the review never removes the penalty.

## 5. Commission
`Commission PKR = Sale Amount × Applied % ÷ 100` (half-up, 2 dp; also enforced by a DB CHECK).
* **Fixed Employee Commission**: % read from `commission_settings` by the server at save time and stored on the sale.
* **Manual Percentage**: % typed for that sale (0 – policy maximum, default 50 %).
* Only **Verified** sales count, in their **accounting month** (sale date, or next month if after a configured cut-off day).
* Editing a sale updates its single commission entry; changing an employee's fixed % affects new sales only.
* A sale already paid in approved payroll is locked; cancelling it creates a **pending reversal adjustment** in the next open month.

## 6. Blockers (approval refused while present)
Missing check-in/out · pending leave · pending attendance correction · pending payroll adjustment · unreviewed severe late (if required) · base salary not set · negative net · (optionally) period not yet ended.

## 7. Approval, payment
Approval (single or bulk) runs per record in its own transaction: fresh recalculation → blocker check →
immutable snapshot (totals, lines, attendance summary, commissions, policy) → commission entries locked →
advance recoveries inserted once and balances reduced. "Mark paid" records date, method, reference,
remarks and user; it is idempotent with an `Idempotency-Key` header and can happen once. No money moves.
