'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDays, businessDateFor, mergedAwaySeconds } = require('../src/services/attendance-engine');
const { calculatePayroll, lateAmountForDay } = require('../src/services/payroll-engine');
const { verifyPassword, hashPassword } = require('../src/utils/crypto');
const { officeNetworkMatches, normalizeForSave, normalizeOfficeNetwork } = require('../src/utils/ip');
const { zonedToUtc, zonedParts } = require('../src/utils/time');
const { D } = require('../src/utils/money');
require('./helpers');

const TZ = 'Asia/Karachi';
const night = { id: 3, name: 'Night', start_time: '21:00:00', end_time: '06:00:00' };
const morning = { id: 1, name: 'Morning', start_time: '09:00:00', end_time: '18:00:00' };
const policy = { graceMinutes: 10, severeLateMinutes: 60, severeLateRequiresReview: false, lateDeductionEnabled: true, lateRuleType: 'per_hour', lateRatePercent: '5', lateBasis: 'daily', lateRounding: 'started_hour', lateTiers: [], lateCapPercent: '10', earlyDeductionEnabled: false, earlyGraceMinutes: 10, earlyRatePercent: '5', absenceDeductionEnabled: true, paidLeaveDaysPerMonth: '2', workingDaysBasis: 'fixed', fixedWorkingDays: 26, blockApprovalUntilPeriodEnd: false };

test('timezone helpers convert Asia/Karachi wall time correctly (UTC+5)', () => {
  assert.equal(zonedToUtc('2026-10-01', '09:00', TZ).toISOString(), '2026-10-01T04:00:00.000Z');
  assert.equal(zonedParts(new Date('2026-10-01T20:30:00Z'), TZ).date, '2026-10-02');
});

test('overnight business date and no double paid day for two sessions in one shift', () => {
  const shiftFor = () => night;
  assert.equal(businessDateFor(zonedToUtc('2026-10-02', '01:30', TZ), TZ, shiftFor), '2026-10-01');
  assert.equal(businessDateFor(zonedToUtc('2026-10-02', '20:30', TZ), TZ, shiftFor), '2026-10-02');
  assert.equal(businessDateFor(zonedToUtc('2026-10-02', '08:50', TZ), TZ, () => morning), '2026-10-02');
  const sessions = [
    { business_date: '2026-10-01', check_in_at: zonedToUtc('2026-10-01', '21:20', TZ), check_out_at: zonedToUtc('2026-10-02', '01:00', TZ), is_active: false, logs: [] },
    { business_date: '2026-10-01', check_in_at: zonedToUtc('2026-10-02', '01:30', TZ), check_out_at: zonedToUtc('2026-10-02', '06:00', TZ), is_active: false, logs: [] },
  ];
  const days = computeDays({ employee: { id: 1, joining_date: '2026-01-01' }, dates: ['2026-10-01'], today: '2026-10-20', nowMs: Date.parse('2026-10-20T00:00:00Z'), tz: TZ, policy, schedule: () => ({ working: true, shift: night }), holidays: new Map(), sessions, leaves: [], approvedCorrections: new Map(), pendingCorrections: new Map() });
  assert.equal(days.length, 1, 'one record per employee-day');
  assert.equal(days[0].status, 'Late');
  assert.equal(days[0].late_minutes, 20);
  assert.equal(days[0].worked_seconds, (3 * 60 + 40 + 4 * 60 + 30) * 60);
});

test('away intervals are merged (overlaps not double-subtracted)', () => {
  const s = Date.parse('2026-10-01T04:00:00Z'); const e = s + 8 * 3600e3;
  const logs = [
    { disconnected_at: new Date(s + 3600e3), reconnected_at: new Date(s + 2 * 3600e3) },
    { disconnected_at: new Date(s + 1.5 * 3600e3), reconnected_at: new Date(s + 2.5 * 3600e3) },
  ];
  assert.equal(mergedAwaySeconds(logs, s, e), 1.5 * 3600);
});

test('late per-hour rule: started-hour rounding, monthly basis, and cap', () => {
  const daily = D(60000).dividedBy(26);
  assert.equal(lateAmountForDay(10, policy, daily).toFixed(2), '0.00', 'within grace');
  assert.equal(lateAmountForDay(61, policy, daily).toFixed(2), daily.times(2).times(0.05).toFixed(2), '61 min = 2 started hours');
  const monthly = lateAmountForDay(30, { ...policy, lateBasis: 'monthly' }, D(60000));
  assert.equal(monthly.toFixed(2), '3000.00', 'monthly basis honoured (bug in original HTML)');
  const days = Array.from({ length: 26 }, (_, i) => ({ attendance_date: `2026-10-${String(i + 1).padStart(2, '0')}`, status: 'Late', late_minutes: 180, scheduled_working: true, leave_fraction: 0 }));
  const calc = calculatePayroll({ employee: { base_salary: '60000' }, period: { month: '2026-10-01', start: '2026-10-01', end: '2026-10-31' }, policy, days, commissions: [], sales: [], adjustments: [], advances: [], pendingCorrections: [], today: '2026-11-15' });
  assert.equal(calc.totals.attendance_deductions, '6000.00', 'capped at 10% of base');
  assert.ok(calc.warnings.some((w) => w.code === 'LATE_CAP'));
});

test('negative net salary blocks approval', () => {
  const days = [{ attendance_date: '2026-10-01', status: 'Present', late_minutes: 0, scheduled_working: true, leave_fraction: 0 }];
  const calc = calculatePayroll({ employee: { base_salary: '1000' }, period: { month: '2026-10-01', start: '2026-10-01', end: '2026-10-31' }, policy, days, commissions: [], sales: [], adjustments: [{ status: 'Approved', adjustment_type: 'DEDUCTION', category: 'OTHER_DEDUCTION', amount: '5000', reason: 'test', id: 1 }], advances: [], pendingCorrections: [], today: '2026-11-15' });
  assert.ok(calc.blockers.some((b) => b.code === 'NEGATIVE_NET'));
});

test('legacy password formats verify and need rehash; scrypt does not', () => {
  const crypto = require('crypto');
  const salt = crypto.randomBytes(16);
  const pb = `$pbkdf2-sha256$210000$${salt.toString('base64')}$${crypto.pbkdf2Sync('123', salt, 210000, 32, 'sha256').toString('base64')}`;
  assert.deepEqual(verifyPassword('123', pb), { ok: true, needsRehash: true });
  assert.equal(verifyPassword('124', pb).ok, false);
  const sha = crypto.createHash('sha256').update('abc').digest('hex');
  assert.deepEqual(verifyPassword('abc', sha), { ok: true, needsRehash: true });
  const sc = hashPassword('S3cure-pass');
  assert.deepEqual(verifyPassword('S3cure-pass', sc), { ok: true, needsRehash: false });
});

test('office network matching preserved from the Worker (IPv4 exact, IPv6 /64, private router IP)', () => {
  assert.equal(officeNetworkMatches('154.80.1.10/32', '154.80.1.10'), true);
  assert.equal(officeNetworkMatches('154.80.1.10/32', '154.80.1.11'), false);
  assert.equal(officeNetworkMatches(normalizeOfficeNetwork('2001:db8:abcd:12::1'), '2001:db8:abcd:12:ffff::9'), true);
  assert.equal(officeNetworkMatches(normalizeOfficeNetwork('2001:db8:abcd:12::1'), '2001:db8:abcd:13::9'), false);
  assert.equal(normalizeForSave('192.168.10.1', '154.80.1.10'), '154.80.1.10/32', 'cloud: private router IP → observed public IP');
  assert.equal(normalizeForSave('192.168.10.1', '192.168.10.55'), '192.168.10.1/24', 'LAN: private router → /24');
  assert.equal(officeNetworkMatches('127.0.0.1/32', '::ffff:127.0.0.1'), true);
});
