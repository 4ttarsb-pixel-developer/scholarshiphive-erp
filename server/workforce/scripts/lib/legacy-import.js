'use strict';
/**
 * Shared importer for the two retired attendance databases:
 *   dialect 'sqlite' : ASP.NET AttendanceTestApi/attendance.db (local times, PBKDF2 hashes)
 *   dialect 'd1'     : Cloudflare D1 export (ISO-UTC times, SHA-256 hashes)
 *
 * Safety rules
 *  - Never overwrites existing PostgreSQL rows: users matched by username are kept as-is,
 *    sessions/leave/etc. are skipped if their legacy id was already imported.
 *  - The same source file can only be imported once (import_batches unique hash).
 *  - Imported logins are NOT mapped to employees automatically (names are never matched);
 *    map them in the web dashboard: Employees › Unmapped attendance logins.
 *  - Accounts whose password is a known default ("123", "12345", …) are flagged
 *    must_change_password, and nobody is granted the Admin role by import.
 *  - Runs in one transaction; --dry-run rolls everything back and only prints the report.
 */
const crypto = require('crypto');
const { verifyPassword, sha256Hex } = require('../../src/utils/crypto');
const { normalizeOfficeNetwork } = require('../../src/utils/ip');
const { zonedToUtc, addDays } = require('../../src/utils/time');
const { isManagementRole } = require('../../src/services/auth.service');

const WEAK = ['123', '1234', '12345', '123456', 'password', 'admin', 'admin123'];

function rows(db, sql) {
  try {
    const res = db.exec(sql);
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
  } catch (e) {
    if (/no such table/i.test(e.message)) return [];
    throw e;
  }
}

const tableExists = (db, name) => rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`).length > 0;

function makeTime(dialect, tz) {
  /** Returns a Date for legacy (date, time) or ISO value. */
  return (dateOrIso, time) => {
    if (dateOrIso === null || dateOrIso === undefined || dateOrIso === '') return null;
    const s = String(dateOrIso);
    if (dialect === 'd1' || /T|Z|\+/.test(s) || time === undefined) {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return zonedToUtc(s.slice(0, 10), s.slice(11, 19), tz); // ASP.NET local "s" format
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) return zonedToUtc(s.slice(0, 10), s.slice(11, 19), tz);
      const t = Date.parse(s);
      return Number.isFinite(t) ? new Date(t) : null;
    }
    return zonedToUtc(s, String(time), tz);
  };
}

async function importLegacy(knex, db, { dialect, sourceBytes, dryRun, tz, actorName = 'legacy-import' }) {
  const hash = crypto.createHash('sha256').update(sourceBytes).digest('hex');
  const at = makeTime(dialect, tz);
  const report = { dialect, dryRun, sourceHash: hash.slice(0, 16), users: { created: 0, existing: 0, weakPasswordsFlagged: 0 }, sessions: { imported: 0, skipped: 0, closedStale: 0 }, intervals: 0, deviceBindings: { imported: 0, skipped: 0 }, activityLogs: 0, leaves: 0, shifts: 0, notes: 0, visitors: 0, consents: 0, networks: { imported: 0, existing: 0 }, warnings: [] };

  const run = async (trx) => {
    if (await trx('import_batches').where({ source: dialect, source_hash: hash }).first()) {
      throw new Error(`This ${dialect} file was already imported (hash ${hash.slice(0, 12)}…). Nothing changed.`);
    }
    const roleEmployee = await trx('roles').where({ code: 'EMPLOYEE' }).first();
    const roleHr = await trx('roles').where({ code: 'HR' }).first();

    // ---------------- users
    const userMap = new Map(); // legacy id -> pg user row
    const byName = new Map();
    for (const u of rows(db, 'SELECT * FROM AppUsers ORDER BY Id')) {
      const username = String(u.Username || '').trim();
      if (!username) continue;
      const existing = await trx('users').whereRaw('lower(username)=lower(?)', [username]).first();
      if (existing) {
        userMap.set(u.Id, existing); byName.set(username.toLowerCase(), existing); report.users.existing += 1;
        continue;
      }
      const hashValue = dialect === 'd1' ? u.PasswordHash : u.Password;
      const weak = WEAK.some((w) => verifyPassword(w, hashValue || '').ok);
      if (weak) report.users.weakPasswordsFlagged += 1;
      const role = u.Role || 'Staff';
      const [row] = await trx('users').insert({
        username, password_hash: hashValue || null, full_name: u.FullName || username, email: u.Email || '',
        attendance_role: role, team: u.Team || '', allow_mobile: !!u.AllowMobile, allow_web: u.AllowWeb === undefined ? true : !!u.AllowWeb,
        has_cctv_access: !!u.HasCctvAccess, biometric_device_id: u.BiometricDeviceId || null,
        biometric_token_hash: u.BiometricTokenHash ? String(u.BiometricTokenHash).toLowerCase() : null,
        must_change_password: weak, legacy_source: dialect, legacy_id: String(u.Id),
      }).returning('*');
      await trx('user_roles').insert({ user_id: row.id, role_id: (isManagementRole(role) ? roleHr : roleEmployee).id }).onConflict(['user_id', 'role_id']).ignore();
      userMap.set(u.Id, row); byName.set(username.toLowerCase(), row); report.users.created += 1;
    }
    const userFor = (id, name) => userMap.get(id) || (name ? byName.get(String(name).toLowerCase()) : null);

    // ---------------- attendance sessions
    const sessTable = dialect === 'd1' ? 'AttendanceRecords' : 'Records';
    const legacySessions = rows(db, `SELECT * FROM ${sessTable}`);
    const prepared = [];
    for (const r of legacySessions) {
      const user = userFor(r.UserId, r.Username);
      if (!user) { report.sessions.skipped += 1; continue; }
      let checkIn; let checkOut; let businessDate;
      if (dialect === 'd1') {
        checkIn = at(r.CheckIn); checkOut = r.CheckOut ? at(r.CheckOut) : null;
        businessDate = checkIn ? new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(checkIn) : null;
      } else {
        businessDate = r.Date;
        checkIn = at(r.Date, r.CheckIn);
        checkOut = r.CheckOut ? at(r.Date, r.CheckOut) : null;
        if (checkOut && checkIn && checkOut < checkIn) checkOut = at(addDays(r.Date, 1), r.CheckOut);
      }
      if (!checkIn || !businessDate) { report.sessions.skipped += 1; continue; }
      const open = dialect === 'd1' ? !!r.IsActive && !checkOut : !checkOut;
      prepared.push({ r, user, checkIn, checkOut, businessDate, open });
    }
    // Only the newest open session per user may stay open; older open ones become "missing check-out".
    const newestOpen = new Map();
    for (const p of prepared.filter((x) => x.open)) {
      const cur = newestOpen.get(p.user.id);
      if (!cur || p.checkIn > cur.checkIn) newestOpen.set(p.user.id, p);
    }
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    for (const p of prepared) {
      const sid = String(p.r.SessionId);
      if (!/^[0-9a-f-]{36}$/i.test(sid) || await trx('attendance_sessions').where({ session_id: sid }).first()) { report.sessions.skipped += 1; continue; }
      let isActive = p.open && newestOpen.get(p.user.id) === p && p.businessDate === today;
      if (isActive && await trx('attendance_sessions').where({ user_id: p.user.id, is_active: true }).first()) isActive = false;
      if (p.open && !isActive) report.sessions.closedStale += 1;
      await trx('attendance_sessions').insert({
        session_id: sid, user_id: p.user.id, employee_id: p.user.employee_id || null, business_date: p.businessDate,
        check_in_at: p.checkIn, check_out_at: p.checkOut, check_in_ip: p.r.CheckInIp || null, check_out_ip: p.r.CheckOutIp || null,
        device_id: p.r.DeviceId || null, report: p.r.Report || null, is_active: isActive,
        closed_reason: p.checkOut ? 'checkout' : (isActive ? null : 'superseded_missing_checkout'),
        source: dialect === 'd1' ? 'import_d1' : 'import_sqlite', legacy_id: sid,
      });
      report.sessions.imported += 1;
    }

    // ---------------- network away intervals
    for (const l of rows(db, 'SELECT * FROM NetworkDisconnectLogs')) {
      const s = await trx('attendance_sessions').where({ session_id: String(l.SessionId) }).first();
      if (!s) continue;
      const from = at(l.DisconnectedAt); const to = l.ReconnectedAt ? at(l.ReconnectedAt) : null;
      if (!from) continue;
      await trx('network_disconnect_logs').insert({
        session_id: s.session_id, user_id: s.user_id, disconnected_at: from, reconnected_at: to && to >= from ? to : null,
        duration_seconds: Math.max(0, Number(l.DurationSeconds) || 0), device_id: l.DeviceId || null, last_known_ip: l.LastKnownIp || null,
      });
      report.intervals += 1;
    }

    // ---------------- device bindings (one device per user, one user per device)
    for (const d of rows(db, 'SELECT * FROM DeviceBindings ORDER BY Id')) {
      const user = userFor(d.BoundUserId ?? d.UserId, d.BoundUsername ?? d.Username);
      if (!user || !d.DeviceId) { report.deviceBindings.skipped += 1; continue; }
      const clash = await trx('device_bindings').where({ user_id: user.id }).orWhere({ device_id: d.DeviceId }).first();
      if (clash) { report.deviceBindings.skipped += 1; continue; }
      await trx('device_bindings').insert({ user_id: user.id, device_id: d.DeviceId, ip_address: d.IpAddress || null, registered_at: at(d.RegisteredAt) || new Date() });
      report.deviceBindings.imported += 1;
    }

    // ---------------- activity logs
    for (const l of rows(db, 'SELECT * FROM IpLogs')) {
      let username = l.Username; let action = l.Action; let allowed = l.Allowed; let message = '';
      if (dialect === 'd1') { const parts = String(l.Username || '').split('|'); [username, action] = parts; allowed = parts[2] === 'OK'; message = parts.slice(3).join('|'); }
      await trx('activity_logs').insert({ username: username || null, action: action || 'ACTIVITY', allowed: !!allowed, message, ip_address: l.Ip || l.IpAddress || null, created_at: at(l.Time || l.CreatedAt) || new Date() });
      report.activityLogs += 1;
    }

    // ---------------- leave
    for (const l of rows(db, 'SELECT * FROM LeaveRequests')) {
      const user = userFor(null, l.Username);
      if (await trx('leave_requests').where({ legacy_id: `${dialect}:${l.Id}` }).first()) continue;
      const date = /^\d{4}-\d{2}-\d{2}/.test(String(l.LeaveDate)) ? String(l.LeaveDate).slice(0, 10) : null;
      if (!date) { report.warnings.push(`Leave ${l.Id}: invalid date ${l.LeaveDate}`); continue; }
      const st = /approve/i.test(l.Status) ? 'Approved' : /(deni|reject)/i.test(l.Status) ? 'Rejected' : 'Pending';
      await trx('leave_requests').insert({
        employee_id: user?.employee_id || null, user_id: user?.id || null, username: l.Username, leave_type: l.LeaveType || 'Leave',
        start_date: date, end_date: date, day_fraction: /half/i.test(l.LeaveType || '') ? 0.5 : 1, reason: l.Reason || '',
        department: l.Department || null, status: st, pay_type: st === 'Approved' ? 'Paid' : null,
        employee_signature: l.EmployeeSignature || null, supervisor_signature: l.SupervisorSignature || null,
        decision_note: l.FinalRemarks || null, source: `import_${dialect}`, legacy_id: `${dialect}:${l.Id}`,
        created_at: at(l.AppliedAt || l.RequestedAt) || new Date(),
      });
      report.leaves += 1;
    }

    for (const s of rows(db, 'SELECT * FROM ShiftRecords')) {
      if (await trx('shift_requests').where({ legacy_id: `${dialect}:${s.Id}` }).first()) continue;
      const user = userFor(null, s.Username);
      const st = /approve/i.test(s.Status) ? 'Approved' : /(deni|reject)/i.test(s.Status) ? 'Denied' : 'Pending';
      await trx('shift_requests').insert({ user_id: user?.id || null, employee_id: user?.employee_id || null, username: s.Username, shift_type: s.ShiftType, custom_timing: s.CustomTiming, status: st, final_remarks: s.ApprovedBy || s.FinalRemarks || null, requested_at: at(s.RequestedAt) || new Date(), legacy_id: `${dialect}:${s.Id}` });
      report.shifts += 1;
    }
    for (const n of rows(db, 'SELECT * FROM NotesNotifications')) {
      const tt = ['All', 'Team', 'Individual'].includes(n.TargetType) ? n.TargetType : 'All';
      await trx('notes_notifications').insert({ title: n.Title, content: n.Content, author_role: n.AuthorRole, target_type: tt, target_value: n.TargetValue || 'All', created_at: at(n.CreatedAt) || new Date() });
      report.notes += 1;
    }
    for (const v of rows(db, 'SELECT * FROM VisitorRecords')) {
      if (await trx('visitor_records').where({ legacy_id: `${dialect}:${v.Id}` }).first()) continue;
      await trx('visitor_records').insert({
        full_name: v.FullName, contact_number: v.ContactNumber, phone_or_cnic: v.PhoneOrCnic || null, email_address: v.EmailAddress || null,
        purpose: v.Purpose || v.InquiryVisitType || null, whom_to_meet: v.WhomToMeet || null, interested_country: v.InterestedCountry,
        interested_program: v.InterestedProgram, counsellor_name: v.CounsellorName, last_qualification: v.LastQualification,
        cgpa_or_percentage: v.CgpaOrPercentage, registered_by: v.RegisteredBy, check_in_time: at(v.CheckInTime) || new Date(),
        check_out_time: at(v.CheckOutTime), status: v.Status || 'Inside', legacy_id: `${dialect}:${v.Id}`,
      });
      report.visitors += 1;
    }
    for (const c of rows(db, 'SELECT * FROM ItalyConsentForms')) {
      if (await trx('consent_forms').where({ legacy_id: `${dialect}:${c.Id}` }).first()) continue;
      await trx('consent_forms').insert({
        client_full_name: c.ClientFullName, family_name: c.FamilyName, gender: c.Gender, domicile_city: c.DomicileCity, cnic_number: c.CnicNumber,
        phone_number: c.PhoneNumber, passport_number: c.PassportNumber, full_address: c.FullAddress, qualification_details: c.QualificationDetails,
        policy_variant: c.PolicyVariant, total_package_fee: Number(c.TotalPackageFee) || null, counselor_name: c.CounselorName,
        representative_signature: c.RepresentativeSignature, status: c.Status || 'Issued', created_at: at(c.CreatedAt) || new Date(), legacy_id: `${dialect}:${c.Id}`,
      });
      report.consents += 1;
    }
    const netRows = [...(tableExists(db, 'OfficeNetworkRules') ? rows(db, 'SELECT Name, Rule, IsActive FROM OfficeNetworkRules') : []),
      ...(tableExists(db, 'OfficeNetworks') ? rows(db, 'SELECT Name, PublicIp AS Rule, IsActive FROM OfficeNetworks') : [])];
    for (const n of netRows) {
      const rule = normalizeOfficeNetwork(n.Rule, { privateDefaultPrefix: 24 });
      if (!rule) continue;
      const ex = await trx('office_network_rules').whereRaw('lower(name)=lower(?) AND lower(rule)=lower(?)', [n.Name || 'Office WiFi', rule]).first();
      if (ex) { report.networks.existing += 1; continue; }
      await trx('office_network_rules').insert({ name: n.Name || 'Office WiFi', rule, is_active: n.IsActive === undefined ? true : !!n.IsActive });
      report.networks.imported += 1;
    }

    await trx('import_batches').insert({ source: dialect, source_hash: hash, summary: JSON.stringify(report) });
    await trx('audit_logs').insert({ actor_name: actorName, action: `Legacy ${dialect} import${dryRun ? ' (dry run)' : ''}`, entity_type: 'import', entity_id: hash.slice(0, 12), detail: JSON.stringify(report).slice(0, 3000) });
    if (dryRun) throw Object.assign(new Error('DRY_RUN'), { dryRun: true });
  };

  try {
    await knex.transaction(run);
  } catch (e) {
    if (!e.dryRun) throw e;
  }
  return report;
}

module.exports = { importLegacy, sha256Hex };
