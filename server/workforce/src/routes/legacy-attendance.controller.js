'use strict';
/**
 * Flutter / attendance-admin compatibility layer.
 * Same paths and JSON field names as attendance_worker/src/index.js, now backed by
 * PostgreSQL and wired into payroll. Every check-in/out recalculates Draft payroll.
 */
const knex = require('../db');
const config = require('../config');
const auth = require('../services/auth.service');
const attendance = require('../services/attendance.service');
const payroll = require('../services/payroll.service');
const leaves = require('../services/leave.service');
const network = require('../services/network.service');
const events = require('../services/events.service');
const { audit, activity } = require('../services/audit.service');
const { clientIp, pick } = require('../utils/request');
const { sha256Hex, uuid, hashPassword, safeEqual } = require('../utils/crypto');
const { normalizeOfficeNetwork } = require('../utils/ip');
const { toCsv } = require('../utils/csv');
const { todayInTz, isValidDate } = require('../utils/time');
const { HttpError } = require('../utils/errors');

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });
const today = () => todayInTz(config.businessTimezone);

async function afterAttendanceChange(employeeId, date) {
  if (!employeeId) { events.publish('attendance.changed', {}); return; }
  try { await payroll.recalcForDate(employeeId, date); } catch (e) { console.error('[payroll] recalc after attendance failed:', e.message); }
  events.publish('attendance.changed', { employeeId, date });
  events.publish('payroll.changed', { employeeId });
}

// ------------------------------------------------------------------ network
async function checkNetwork(req, res) {
  const ip = clientIp(req);
  const { rows, matched } = await network.approvedOfficeNetwork(ip);
  const suggestedRule = normalizeOfficeNetwork(ip);
  if (rows.length === 0) {
    return res.json({ allowed: true, ip, clientIp: ip, suggestedRule, setupMode: true, networkRestrictionConfigured: false, message: 'No office Wi-Fi IP is configured yet.' });
  }
  if (!matched) {
    return res.status(403).json({ allowed: false, ip, clientIp: ip, suggestedRule, setupMode: false, networkRestrictionConfigured: true, message: `Not approved. Current phone public IP/range: ${suggestedRule || ip}` });
  }
  return res.json({
    allowed: true, ip, clientIp: ip, suggestedRule, setupMode: false, networkRestrictionConfigured: true,
    networkId: matched.id, networkName: matched.name, networkRule: matched.rule, message: `Connected through approved office network: ${matched.name}`,
  });
}

// ------------------------------------------------------------------ login / biometrics
async function registerBiometric(req, res) {
  const b = req.body || {};
  const username = String(pick(b, 'Username', 'username') || '').trim();
  const password = String(pick(b, 'Password', 'password') || '');
  const deviceId = String(pick(b, 'DeviceId', 'deviceId') || '').trim();
  if (!username || !password || !deviceId) return fail(res, 400, 'Username, password and deviceId are required.');
  const { user, error } = await auth.checkPassword(username, password);
  if (!user) return fail(res, 401, error);
  const token = uuid();
  await knex('users').where({ id: user.id }).update({ biometric_device_id: deviceId, biometric_token_hash: sha256Hex(token), updated_at: new Date() });
  await activity(null, { username: user.username, userId: user.id, action: 'BIOMETRIC_REGISTERED', ip: clientIp(req) });
  return res.json({ success: true, token, message: 'Fingerprint registered successfully.' });
}

async function login(req, res) {
  const b = req.body || {};
  const username = String(pick(b, 'Username', 'username') || '').trim();
  const password = String(pick(b, 'Password', 'password') || '');
  const deviceId = String(pick(b, 'DeviceId', 'deviceId') || 'chrome-browser').trim().slice(0, 200);
  const biometricToken = String(pick(b, 'BiometricToken', 'biometricToken') || '');
  const ip = clientIp(req);
  if (!username) return fail(res, 400, 'Username is required.');
  if (!password && !biometricToken) return fail(res, 400, 'Password or fingerprint authentication is required.');

  // Approved office network is enforced at login itself (cannot bypass the check-network screen).
  const net = await network.approvedOfficeNetwork(ip);
  if (net.rows.length > 0 && !net.matched) {
    await activity(null, { username, action: 'NETWORK_DENIED', allowed: false, message: 'Login outside approved office network', ip });
    return fail(res, 403, `This network is not approved for attendance. Current detected network: ${normalizeOfficeNetwork(ip) || ip}`, { clientIp: ip, suggestedRule: normalizeOfficeNetwork(ip) });
  }

  let user;
  if (biometricToken) {
    user = await auth.findUserByUsername(username);
    if (!user || !user.is_active) return fail(res, 401, 'Invalid username or password.');
    if (!user.biometric_device_id || !user.biometric_token_hash) return fail(res, 401, 'Fingerprint is not registered for this account.');
    if (user.biometric_device_id !== deviceId) {
      await activity(null, { username, userId: user.id, action: 'BIOMETRIC_DEVICE_MISMATCH', allowed: false, ip });
      return fail(res, 401, 'Fingerprint is registered on another device. Re-register fingerprint on this device.');
    }
    if (!safeEqual(user.biometric_token_hash.toLowerCase(), sha256Hex(biometricToken))) {
      return fail(res, 401, 'Fingerprint token is invalid. Re-register fingerprint.');
    }
    await knex('users').where({ id: user.id }).update({ last_login_at: new Date(), failed_logins: 0 });
  } else {
    const r = await auth.checkPassword(username, password);
    if (!r.user) {
      await activity(null, { username, action: 'LOGIN_FAILED', allowed: false, message: 'Bad credentials', ip });
      return fail(res, 401, r.error);
    }
    user = r.user;
  }

  const role = user.attendance_role || 'Staff';
  const isManagement = auth.isManagementRole(role);
  const isReception = auth.isReceptionRole(role);

  try {
    const result = await knex.transaction(async (trx) => {
      // Device binding (non-management, non-reception), identical to the Worker.
      if (!isManagement && !isReception && deviceId) {
        const byDevice = await trx('device_bindings').where({ device_id: deviceId }).first();
        const byUser = await trx('device_bindings').where({ user_id: user.id }).first();
        if (byDevice && byDevice.user_id !== user.id) throw new HttpError(403, 'This device is registered to another employee.');
        if (byUser && byUser.device_id !== deviceId) throw new HttpError(403, 'This employee is registered on another device. Ask Owner to reset device.');
        if (!byUser) await trx('device_bindings').insert({ user_id: user.id, device_id: deviceId, ip_address: ip });
      }
      const ci = await attendance.checkIn(user, { deviceId, ip, source: deviceId === 'chrome-browser' ? 'web' : 'mobile' }, trx);
      let adminToken = null;
      if (isManagement) adminToken = await auth.createSession(user.id, 'admin', { ip, userAgent: req.get('user-agent') }, trx);
      return { ...ci, adminToken };
    });
    await activity(null, { username: user.username, userId: user.id, action: biometricToken ? 'LOGIN_BIOMETRIC' : 'LOGIN', allowed: true, message: role, ip });
    if (!result.alreadyCheckedIn) {
      await afterAttendanceChange(user.employee_id, result.session.business_date);
      if (result.closedStale) await afterAttendanceChange(user.employee_id, result.closedStale.business_date);
    }
    return res.json({
      success: true,
      sessionId: result.session.session_id,
      userName: user.username,
      username: user.username,
      fullName: user.full_name || user.username,
      role,
      team: user.team || 'General',
      isManagement,
      isReception,
      adminToken: result.adminToken,
      allowMobile: !!user.allow_mobile,
      allowWeb: !!user.allow_web,
      hasCctvAccess: !!user.has_cctv_access,
      alreadyCheckedIn: result.alreadyCheckedIn,
      checkInTime: new Date(result.session.check_in_at).toISOString(),
      employeeLinked: !!user.employee_id,
    });
  } catch (e) {
    if (e instanceof HttpError) {
      await activity(null, { username: user.username, userId: user.id, action: 'DEVICE_MISMATCH', allowed: false, message: e.message, ip });
      return fail(res, e.status, e.message);
    }
    if (e.code === '23505' && /ux_sessions_one_active/.test(e.constraint || e.message)) {
      return fail(res, 409, 'A check-in is already being processed for this account. Please retry.');
    }
    throw e;
  }
}

async function changePassword(req, res) {
  const b = req.body || {};
  const username = String(pick(b, 'Username', 'username') || '').trim();
  const currentPassword = String(pick(b, 'CurrentPassword', 'currentPassword') || '');
  const newPassword = String(pick(b, 'NewPassword', 'newPassword') || '');
  if (!username || !currentPassword || newPassword.length < 8) {
    return fail(res, 400, 'Username, current password and a new password of at least 8 characters are required.');
  }
  const { user } = await auth.checkPassword(username, currentPassword);
  if (!user) return fail(res, 401, 'Current password is incorrect.');
  await knex('users').where({ id: user.id }).update({ password_hash: hashPassword(newPassword), must_change_password: false, updated_at: new Date() });
  await audit(null, { actor: { id: user.id, username: user.username, fullName: user.full_name }, action: 'Password changed', entityType: 'user', entityId: user.id, ip: clientIp(req) });
  return res.json({ success: true, message: 'Password changed successfully.' });
}

// ------------------------------------------------------------------ session lifecycle
async function sessionStatus(req, res) {
  const sessionId = String(req.query.sessionId || '');
  const r = /^[0-9a-f-]{36}$/i.test(sessionId) ? await knex('attendance_sessions').where({ session_id: sessionId }).first() : null;
  return res.json({ success: true, active: !!(r && r.is_active), sessionId, checkInTime: r ? new Date(r.check_in_at).toISOString() : '' });
}

async function findSession(sessionId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(sessionId || ''))) return null;
  return knex('attendance_sessions').where({ session_id: sessionId }).first();
}

function parseInstant(v, fallback) {
  const t = Date.parse(v || '');
  return Number.isFinite(t) ? new Date(t) : fallback;
}

async function networkInterval(req, res) {
  const b = req.body || {};
  const s = await findSession(pick(b, 'SessionId', 'sessionId'));
  if (!s) return fail(res, 404, 'Attendance session not found.');
  const now = new Date();
  let from = parseInstant(pick(b, 'DisconnectedAt', 'disconnectedAt'), now);
  let to = parseInstant(pick(b, 'ReconnectedAt', 'reconnectedAt'), now);
  const sessionStart = new Date(s.check_in_at);
  const sessionEnd = s.check_out_at ? new Date(s.check_out_at) : now;
  // Clamp to the session window; ignore client clocks in the future.
  if (from < sessionStart) from = sessionStart;
  if (to > sessionEnd) to = sessionEnd;
  if (to < from) to = from;
  const seconds = Math.max(0, Math.floor((to - from) / 1000));
  await knex('network_disconnect_logs').insert({
    session_id: s.session_id, user_id: s.user_id, disconnected_at: from, reconnected_at: to, duration_seconds: seconds,
    device_id: String(pick(b, 'DeviceId', 'deviceId') || '').slice(0, 200), last_known_ip: clientIp(req),
  });
  await afterAttendanceChange(s.employee_id, s.business_date);
  return res.json({ success: true, durationSeconds: seconds });
}

async function networkDisconnected(req, res) {
  const b = req.body || {};
  const s = await findSession(pick(b, 'SessionId', 'sessionId'));
  if (!s) return fail(res, 404, 'Attendance session not found.');
  const open = await knex('network_disconnect_logs').where({ session_id: s.session_id }).whereNull('reconnected_at').first();
  if (!open) {
    await knex('network_disconnect_logs').insert({ session_id: s.session_id, user_id: s.user_id, disconnected_at: new Date(), device_id: String(pick(b, 'DeviceId', 'deviceId') || ''), last_known_ip: clientIp(req) });
  }
  return res.json({ success: true, message: 'Network disconnection recorded.' });
}

async function networkReconnected(req, res) {
  const b = req.body || {};
  const s = await findSession(pick(b, 'SessionId', 'sessionId'));
  if (!s) return res.json({ success: true, message: 'No open disconnection interval.' });
  const open = await knex('network_disconnect_logs').where({ session_id: s.session_id }).whereNull('reconnected_at').orderBy('id', 'desc').first();
  if (!open) return res.json({ success: true, message: 'No open disconnection interval.' });
  const re = new Date();
  const sec = Math.max(0, Math.floor((re - new Date(open.disconnected_at)) / 1000));
  await knex('network_disconnect_logs').where({ id: open.id }).update({ reconnected_at: re, duration_seconds: sec });
  await afterAttendanceChange(s.employee_id, s.business_date);
  return res.json({ success: true, durationSeconds: sec });
}

async function checkoutNetworkGate(req) {
  const net = await network.approvedOfficeNetwork(clientIp(req));
  if (!config.checkoutRequiresNetworkRule) return { ok: true, net };
  if (net.rows.length === 0) return { ok: false, net, message: 'Checkout is blocked until an office Wi-Fi/IP is configured by management.' };
  if (!net.matched) return { ok: false, net, message: 'Checkout is only allowed while connected to an approved office Wi-Fi network.' };
  return { ok: true, net };
}

async function verifyCheckout(req, res) {
  const s = await findSession(pick(req.body || {}, 'SessionId', 'sessionId'));
  if (!s || !s.is_active) return res.json({ eligible: false, message: 'No active attendance session found.' });
  const gate = await checkoutNetworkGate(req);
  if (!gate.ok) return res.json({ eligible: false, clientIp: gate.net.ip, message: gate.message });
  return res.json({
    eligible: true, clientIp: gate.net.ip, networkId: gate.net.matched?.id || null, networkName: gate.net.matched?.name || null,
    message: 'Checkout allowed on approved office Wi-Fi.',
  });
}

async function submitReport(req, res) {
  const b = req.body || {};
  const s = await findSession(pick(b, 'SessionId', 'sessionId'));
  const report = String(pick(b, 'Report', 'report', 'ReportContent', 'reportContent') || '').trim().slice(0, 5000);
  if (!s || !s.is_active) return fail(res, 400, 'Attendance session is already closed or invalid.');
  const gate = await checkoutNetworkGate(req);
  if (!gate.ok) return fail(res, 403, gate.message, { clientIp: gate.net.ip });
  const closed = await knex.transaction((trx) => attendance.checkOut(s.session_id, { ip: clientIp(req), report }, trx));
  if (!closed) return fail(res, 400, 'Attendance session is already closed or invalid.');
  await activity(null, { userId: s.user_id, action: 'CHECK_OUT', ip: clientIp(req) });
  await afterAttendanceChange(s.employee_id, s.business_date);
  const m = await attendance.sessionMetrics(closed);
  return res.json({ success: true, message: 'Report submitted and checkout completed.', ...m });
}

// ------------------------------------------------------------------ shift / leave (username+password)
// Read-only list for the pre-login Flutter Shift Management dialog.
async function availableShifts(_req, res) {
  const rows = await knex('shifts')
    .where({ is_active: true })
    .select('name', 'start_time', 'end_time')
    .orderBy('start_time');
  return res.json({ success: true, shifts: rows });
}

async function shiftSelect(req, res) {
  const b = req.body || {};
  const { user, error } = await auth.checkPassword(pick(b, 'Username', 'username'), pick(b, 'Password', 'password'));
  if (!user) return fail(res, 401, error);
  const shiftType = String(pick(b, 'ShiftType', 'shiftType', 'shift') || 'Morning').slice(0, 60);
  const customTiming = String(pick(b, 'CustomTiming', 'customTiming') || '').slice(0, 80);
  if (shiftType !== 'Custom') {
    const exists = await knex('shifts').where({ is_active: true })
      .whereRaw('lower(name) = lower(?)', [shiftType]).first('id');
    if (!exists) return fail(res, 400, 'Selected shift is unavailable. Refresh the shift list.');
  }
  await knex('shift_requests').insert({ user_id: user.id, employee_id: user.employee_id, username: user.username, shift_type: shiftType, custom_timing: customTiming, status: 'Pending' });
  events.publish('shift.changed', {});
  return res.json({ success: true, message: 'Shift request submitted successfully.', status: 'Pending' });
}

async function leaveApply(req, res) {
  const b = req.body || {};
  const { user, error } = await auth.checkPassword(pick(b, 'Username', 'username'), pick(b, 'Password', 'password'));
  if (!user) return fail(res, 401, error);
  const leaveDate = String(pick(b, 'LeaveDate', 'leaveDate') || today());
  if (!isValidDate(leaveDate)) return fail(res, 400, 'Leave date must be yyyy-MM-dd.');
  const actor = { id: user.id, username: user.username, fullName: user.full_name };
  const q = events.deferred();
  try {
    await leaves.apply({
      employeeId: user.employee_id, userId: user.id, username: user.username,
      leaveType: String(pick(b, 'LeaveType', 'leaveType') || 'Leave'), startDate: leaveDate, endDate: leaveDate,
      reason: String(pick(b, 'Reason', 'reason') || ''), department: pick(b, 'Department', 'department'), source: 'mobile',
    }, actor, { ip: clientIp(req), events: q });
  } catch (e) {
    if (e instanceof HttpError) return fail(res, e.status, e.message);
    throw e;
  }
  q.flush();
  return res.json({ success: true, message: 'Leave application submitted successfully.', status: 'Pending' });
}

async function leaveStatus(req, res) {
  const b = req.body || {};
  const { user, error } = await auth.checkPassword(pick(b, 'Username', 'username'), pick(b, 'Password', 'password'));
  if (!user) return fail(res, 401, error);
  const r = await knex('leave_requests').where({ user_id: user.id }).orderBy('id', 'desc').first();
  if (!r) return fail(res, 404, 'No leave request found.');
  return res.json({
    success: true, id: r.id, username: r.username, leaveType: r.leave_type, reason: r.reason, leaveDate: r.start_date,
    status: r.status === 'Rejected' ? 'Denied' : r.status, payType: r.pay_type,
    supervisorSignature: r.supervisor_signature || '', finalRemarks: r.decision_note || '',
  });
}

// ------------------------------------------------------------------ reception / consent (session-guarded)
function visitorDto(r) {
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  return {
    id: r.id, Id: r.id, fullName: r.full_name, FullName: r.full_name, visitorName: r.full_name,
    contactNumber: r.contact_number, ContactNumber: r.contact_number, phoneOrCnic: r.phone_or_cnic, purpose: r.purpose,
    whomToMeet: r.whom_to_meet, interestedCountry: r.interested_country, InterestedCountry: r.interested_country,
    interestedProgram: r.interested_program, InterestedProgram: r.interested_program, counsellorName: r.counsellor_name,
    CounsellorName: r.counsellor_name, lastQualification: r.last_qualification, LastQualification: r.last_qualification,
    cgpaOrPercentage: r.cgpa_or_percentage, CgpaOrPercentage: r.cgpa_or_percentage, registeredBy: r.registered_by,
    checkInTime: iso(r.check_in_time), CheckInTime: iso(r.check_in_time), checkOutTime: iso(r.check_out_time), CheckOutTime: iso(r.check_out_time),
    status: r.status, Status: r.status,
  };
}

async function visitorRegister(req, res) {
  const b = req.body || {};
  const fullName = String(pick(b, 'FullName', 'fullName', 'VisitorName', 'visitorName') || '').trim();
  if (!fullName) return fail(res, 400, 'Visitor full name is required.');
  const contact = String(pick(b, 'ContactNumber', 'contactNumber') || '');
  const [row] = await knex('visitor_records').insert({
    full_name: fullName.slice(0, 160), contact_number: contact.slice(0, 60), phone_or_cnic: String(pick(b, 'PhoneOrCnic', 'phoneOrCnic') || contact).slice(0, 60),
    email_address: String(pick(b, 'EmailAddress', 'emailAddress') || '').slice(0, 160),
    purpose: String(pick(b, 'Purpose', 'purpose') || ''), whom_to_meet: String(pick(b, 'WhomToMeet', 'whomToMeet') || '').slice(0, 120),
    interested_country: String(pick(b, 'InterestedCountry', 'interestedCountry') || '').slice(0, 80),
    interested_program: String(pick(b, 'InterestedProgram', 'interestedProgram') || '').slice(0, 120),
    counsellor_name: String(pick(b, 'CounsellorName', 'counsellorName', 'CounselorName', 'counselorName') || '').slice(0, 120),
    last_qualification: String(pick(b, 'LastQualification', 'lastQualification') || '').slice(0, 120),
    cgpa_or_percentage: String(pick(b, 'CgpaOrPercentage', 'cgpaOrPercentage') || '').slice(0, 40),
    registered_by: String(pick(b, 'RegisteredBy', 'registeredBy') || req.legacyUser?.username || 'Reception').slice(0, 60),
  }).returning('*');
  return res.json({ success: true, id: row.id, message: 'Visitor registered successfully.' });
}

async function visitorList(_req, res) {
  const rows = await knex('visitor_records').orderBy('id', 'desc').limit(500);
  return res.json(rows.map(visitorDto));
}

async function visitorCheckout(req, res) {
  const id = Number(req.params.id);
  const r = await knex('visitor_records').where({ id }).first();
  if (!r) return fail(res, 404, 'Visitor not found.');
  await knex('visitor_records').where({ id }).update({ check_out_time: new Date(), status: 'Checked Out' });
  return res.json({ success: true, message: 'Visitor checked out.' });
}

function consentDto(r) {
  return {
    id: r.id, Id: r.id, clientFullName: r.client_full_name, ClientFullName: r.client_full_name, policyVariant: r.policy_variant,
    PolicyVariant: r.policy_variant, totalPackageFee: Number(r.total_package_fee), TotalPackageFee: Number(r.total_package_fee),
    counselorName: r.counselor_name, CounselorName: r.counselor_name, counsellorName: r.counselor_name,
    representativeSignature: r.representative_signature, RepresentativeSignature: r.representative_signature, signature: r.representative_signature,
    createdAt: new Date(r.created_at).toISOString(), CreatedAt: new Date(r.created_at).toISOString(), status: r.status, Status: r.status,
  };
}

async function consentCreate(req, res) {
  const b = req.body || {};
  const client = String(pick(b, 'ClientFullName', 'clientFullName') || '').trim();
  if (!client) return fail(res, 400, 'Client full name is required.');
  const counselor = String(pick(b, 'CounselorName', 'counselorName', 'CounsellorName', 'counsellorName') || 'Muazzam').slice(0, 120);
  const signature = `Digitally Authorized by ${counselor}`;
  const fee = Number(pick(b, 'TotalPackageFee', 'totalPackageFee') || 250000);
  const [row] = await knex('consent_forms').insert({
    client_full_name: client.slice(0, 160), family_name: pick(b, 'FamilyName', 'familyName') || '', gender: pick(b, 'Gender', 'gender') || '',
    domicile_city: pick(b, 'DomicileCity', 'domicileCity') || '', cnic_number: pick(b, 'CnicNumber', 'cnicNumber') || '',
    phone_number: pick(b, 'PhoneNumber', 'phoneNumber') || '', passport_number: pick(b, 'PassportNumber', 'passportNumber') || '',
    full_address: pick(b, 'FullAddress', 'fullAddress') || '', qualification_details: pick(b, 'QualificationDetails', 'qualificationDetails') || '',
    policy_variant: pick(b, 'PolicyVariant', 'policyVariant') || '', total_package_fee: Number.isFinite(fee) ? fee : 250000,
    counselor_name: counselor, representative_signature: signature,
  }).returning('*');
  return res.json({ success: true, id: row.id, counselorName: counselor, signature, message: 'Consent form saved successfully.' });
}

async function consentList(_req, res) {
  const rows = await knex('consent_forms').orderBy('id', 'desc').limit(500);
  return res.json(rows.map(consentDto));
}

async function consentMarkSigned(req, res) {
  const id = Number(req.params.id);
  const r = await knex('consent_forms').where({ id }).first();
  if (!r) return fail(res, 404, 'Consent Form not found.');
  await knex('consent_forms').where({ id }).update({ status: 'Signed & Archived' });
  return res.json({ success: true, message: 'Consent Form marked as officially signed & archived.' });
}

async function cctvLogin(req, res) {
  const b = req.body || {};
  const { user } = await auth.checkPassword(pick(b, 'Username', 'username'), pick(b, 'Password', 'password'));
  if (!user || !user.has_cctv_access) return fail(res, 403, 'CCTV Access Denied: Unauthorized credentials.');
  return res.json({
    success: true,
    streamServer: process.env.CCTV_STREAM_SERVER || 'rtsp://cctv.local.scholarshiphive.internal:554/live',
    cameras: [
      { id: 1, name: 'Front Reception & Entrance Gate', status: 'Online', streamUrl: 'Cam-01-Gate' },
      { id: 2, name: 'Main Waiting Lounge', status: 'Online', streamUrl: 'Cam-02-Lounge' },
      { id: 3, name: 'Processing Hall Corridor', status: 'Online', streamUrl: 'Cam-03-Processing' },
      { id: 4, name: 'Executive Corridor', status: 'Online', streamUrl: 'Cam-04-Executive' },
    ],
  });
}

// ------------------------------------------------------------------ admin (Bearer admin token)
async function adminSession(req, res) {
  return res.json({ success: true, username: req.user.username, role: req.user.attendanceRole });
}

async function adminLogout(req, res) {
  await auth.revokeSession(req.authToken);
  return res.json({ success: true });
}

async function adminWebLogin(req, res) {
  const b = req.body || {};
  const { user } = await auth.checkPassword(pick(b, 'Username', 'username'), pick(b, 'Password', 'password'));
  if (!user) return fail(res, 401, 'Management credentials required.');
  const principal = await auth.loadPrincipal(user.id);
  if (!principal.legacyManagement && !principal.permissions.has('attendance.security')) return fail(res, 401, 'Management credentials required.');
  const token = await auth.createSession(user.id, 'admin', { ip: clientIp(req), userAgent: req.get('user-agent') });
  return res.json({ success: true, token, adminToken: token, username: user.username, userName: user.username, fullName: user.full_name || user.username, role: user.attendance_role });
}

async function networksList(_req, res) { return res.json(await network.list()); }

async function networksCurrentIp(req, res) {
  const raw = clientIp(req);
  return res.json({ success: true, publicIp: raw, suggestedRule: normalizeOfficeNetwork(raw, { privateDefaultPrefix: 24 }) });
}

async function networksAdd(req, res) {
  const b = req.body || {};
  const detectedIp = clientIp(req);
  const raw = String(pick(b, 'PublicIp', 'publicIp', 'Rule', 'rule') || '').trim();
  const r = await network.add({ name: pick(b, 'Name', 'name'), raw, detectedIp, actorId: req.user.id });
  if (r.error) return fail(res, 400, r.error);
  if (r.existing) return res.json({ success: true, existing: true, id: r.id, message: 'This Wi-Fi rule is already saved.', publicIp: r.rule });
  await audit(null, { actor: req.user, action: 'Office network added', entityType: 'office_network', entityId: r.id, detail: `${pick(b, 'Name', 'name') || 'Office WiFi'}: ${r.rule}`, ip: detectedIp });
  return res.json({ success: true, id: r.id, message: 'Office Wi-Fi rule added successfully.', publicIp: r.rule, detectedIp });
}

async function networksDelete(req, res) {
  const id = Number(req.params.id);
  const existing = await knex('office_network_rules').where({ id }).first();
  if (!existing) return fail(res, 404, 'Office Wi-Fi rule not found.');
  await knex('office_network_rules').where({ id }).del();
  await audit(null, { actor: req.user, action: 'Office network removed', entityType: 'office_network', entityId: id, detail: `${existing.name}: ${existing.rule}`, ip: clientIp(req) });
  return res.json({ success: true, message: 'Office Wi-Fi rule removed successfully.' });
}

async function overview(_req, res) {
  const lv = await knex('leave_requests').orderBy('id', 'desc').limit(100);
  const sh = await knex('shift_requests').orderBy('id', 'desc').limit(100);
  const notes = await knex('notes_notifications').orderBy('id', 'desc').limit(100);
  const vis = await knex('visitor_records').orderBy('id', 'desc').limit(100);
  return res.json({
    leaves: lv.map((r) => ({ id: r.id, username: r.username, leaveType: r.leave_type, reason: r.reason, leaveDate: r.start_date, requestedAt: r.created_at, status: r.status === 'Rejected' ? 'Denied' : r.status, finalRemarks: r.decision_note || '' })),
    shifts: sh.map((r) => ({ id: r.id, username: r.username, department: '', customTiming: r.custom_timing || r.shift_type, shiftType: r.shift_type, requestedAt: r.requested_at, status: r.status, finalRemarks: r.final_remarks || '' })),
    notes: notes.map((r) => ({ id: r.id, title: r.title, content: r.content, authorRole: r.author_role, targetType: r.target_type, targetValue: r.target_value, createdAt: r.created_at })),
    visitors: vis.map(visitorDto),
  });
}

async function dashboard(_req, res) {
  const t = today();
  const [{ c: totalUsers }] = await knex('users').where({ is_active: true }).count('* as c');
  const [{ c: presentUsers }] = await knex('attendance_sessions').where({ is_active: true }).count('* as c');
  const [{ c: checkedOutToday }] = await knex('attendance_sessions').where({ is_active: false, business_date: t }).whereNotNull('check_out_at').count('* as c');
  const [{ c: activityToday }] = await knex('attendance_sessions').where({ business_date: t }).count('* as c');
  const recent = await knex('attendance_sessions as s').join('users as u', 'u.id', 's.user_id').orderBy('s.updated_at', 'desc').limit(10).select('s.*', 'u.username');
  return res.json({
    totalUsers: Number(totalUsers), presentUsers: Number(presentUsers), checkedOutToday: Number(checkedOutToday), activityToday: Number(activityToday),
    recentActivity: recent.map((r) => {
      const at = new Date(r.check_out_at || r.check_in_at).toISOString();
      return { user: r.username, action: r.is_active ? 'CHECK_IN' : 'CHECK_OUT', date: at.slice(0, 10), time: at.slice(11, 19), ip: r.check_out_ip || r.check_in_ip || '' };
    }),
  });
}

function legacyAttendanceQuery(q) {
  const query = knex('attendance_sessions as s').join('users as u', 'u.id', 's.user_id').leftJoin('employees as e', 'e.id', 's.employee_id')
    .select('s.*', 'u.username', 'e.employee_code').orderBy('s.id', 'desc').limit(5000);
  const username = String(q.username || q.search || '').toLowerCase();
  if (username) query.whereRaw('lower(u.username) like ?', [`%${username}%`]);
  const status = String(q.status || '').toLowerCase();
  if (status.includes('active')) query.where('s.is_active', true);
  else if (status.includes('out')) query.where('s.is_active', false);
  if (isValidDate(q.fromDate)) query.where('s.business_date', '>=', q.fromDate);
  if (isValidDate(q.toDate)) query.where('s.business_date', '<=', q.toDate);
  return query;
}

async function adminAttendance(req, res) {
  const rows = await legacyAttendanceQuery(req.query).limit(1000);
  return res.json(await attendance.enrichLegacyRows(rows));
}

async function adminAttendanceExport(req, res) {
  const rows = await attendance.enrichLegacyRows(await legacyAttendanceQuery(req.query));
  if (req.path.endsWith('export-separate')) rows.sort((a, b) => a.username.localeCompare(b.username) || b.id - a.id);
  const lines = [['Username', 'Date', 'CheckIn', 'CheckOut', 'TotalSpan', 'NetworkAway', 'ActualOfficeTime', 'Status', 'CheckInIp', 'CheckOutIp', 'Report']];
  for (const r of rows) lines.push([r.username, r.date, r.checkIn, r.checkOut, r.totalSpanText, r.networkAwayText, r.actualOfficeTimeText, r.status, r.checkInIp, r.checkOutIp, r.report]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  return res.send(toCsv(lines));
}

async function usersList(req, res) {
  const search = String(req.query.search || '').toLowerCase();
  const q = knex('users as u').leftJoin('device_bindings as d', 'd.user_id', 'u.id').leftJoin('employees as e', 'e.id', 'u.employee_id')
    .where('u.is_active', true).orderBy('u.id', 'desc')
    .select('u.*', 'd.id as binding_id', 'd.device_id', 'd.ip_address', 'd.registered_at', 'e.employee_code');
  if (search) q.where((w) => w.whereRaw('lower(u.username) like ?', [`%${search}%`]).orWhereRaw('lower(u.full_name) like ?', [`%${search}%`]).orWhereRaw('lower(u.email) like ?', [`%${search}%`]));
  const rows = await q;
  return res.json(rows.map((u) => ({
    id: u.id, username: u.username, fullName: u.full_name || '', email: u.email || '', role: u.attendance_role || 'Staff', team: u.team || '',
    allowMobile: u.allow_mobile, allowWeb: u.allow_web, hasCctvAccess: u.has_cctv_access, deviceBindingId: u.binding_id ?? null,
    deviceId: u.device_id || '', ipAddress: u.ip_address || '', registeredAt: u.registered_at || '', employeeCode: u.employee_code || null,
  })));
}

const isOwner = (u) => u.roles.includes('ADMIN') || String(u.attendanceRole || '').toLowerCase() === 'owner';

async function usersAdd(req, res) {
  if (!isOwner(req.user)) return fail(res, 403, 'Only the Owner can add new users.');
  const b = req.body || {};
  const username = String(pick(b, 'Username', 'username') || '').trim();
  const fullName = String(pick(b, 'FullName', 'fullName') || '').trim();
  const password = String(pick(b, 'Password', 'password') || '');
  if (!/^[A-Za-z0-9._-]{3,60}$/.test(username) || !fullName || password.length < 8) {
    return fail(res, 400, 'Username (3+ letters/numbers), full name, and a password of at least 8 characters are required.');
  }
  if (await auth.findUserByUsername(username)) return fail(res, 409, 'Username already exists.');
  const role = String(pick(b, 'Role', 'role') || 'Staff').slice(0, 60);
  const [u] = await knex('users').insert({
    username, full_name: fullName, email: String(pick(b, 'Email', 'email') || ''), password_hash: hashPassword(password), attendance_role: role,
    team: String(pick(b, 'Team', 'team') || ''), allow_mobile: pick(b, 'AllowMobile', 'allowMobile') !== false,
    allow_web: pick(b, 'AllowWeb', 'allowWeb') !== false, has_cctv_access: pick(b, 'HasCctvAccess', 'hasCctvAccess') === true,
  }).returning('*');
  const empRole = await knex('roles').where({ code: auth.isManagementRole(role) ? 'HR' : 'EMPLOYEE' }).first();
  await knex('user_roles').insert({ user_id: u.id, role_id: empRole.id, granted_by: req.user.id });
  await audit(null, { actor: req.user, action: 'Attendance user created', entityType: 'user', entityId: u.id, detail: `${username} (${role}); link to an employee in Employees › Unmapped logins`, ip: clientIp(req) });
  events.publish('employees.changed', {});
  return res.json({ success: true, message: 'User created successfully.' });
}

async function usersDelete(req, res) {
  if (!isOwner(req.user)) return fail(res, 403, 'Only the Owner can delete users.');
  const id = Number(req.params.id);
  const target = await knex('users').where({ id }).first();
  if (!target) return fail(res, 404, 'User not found.');
  if (target.is_protected || ['admin', 'superadmin'].includes(target.username.toLowerCase())) return fail(res, 403, 'The Super Admin account cannot be deleted.');
  if (target.id === req.user.id) return fail(res, 403, 'You cannot delete your own account.');
  // Attendance and payroll history must be kept, so the account is deactivated rather than erased.
  await knex.transaction(async (trx) => {
    await trx('users').where({ id }).update({ is_active: false, updated_at: new Date() });
    await trx('auth_sessions').where({ user_id: id }).whereNull('revoked_at').update({ revoked_at: new Date() });
    await trx('device_bindings').where({ user_id: id }).del();
    await audit(trx, { actor: req.user, action: 'Attendance user removed', entityType: 'user', entityId: id, detail: `${target.username} deactivated (history preserved)`, ip: clientIp(req) });
  });
  return res.json({ success: true, message: 'User deleted successfully. Attendance history is preserved.' });
}

async function deviceReset(req, res) {
  const id = Number(req.params.id);
  const d = await knex('device_bindings').where({ id }).first();
  await knex('device_bindings').where({ id }).del();
  if (d) await audit(null, { actor: req.user, action: 'Device binding reset', entityType: 'user', entityId: d.user_id, detail: d.device_id, ip: clientIp(req) });
  return res.json({ success: true, message: 'Device registration reset.' });
}

async function ipLogs(req, res) {
  const q = String(req.query.search || req.query.username || '').toLowerCase();
  const query = knex('activity_logs').orderBy('id', 'desc').limit(1000);
  if (q) query.where((w) => w.whereRaw('lower(username) like ?', [`%${q}%`]).orWhereRaw('lower(ip_address) like ?', [`%${q}%`]));
  const rows = await query;
  return res.json(rows.map((r) => {
    const at = new Date(r.created_at).toISOString();
    return { id: r.id, username: r.username || '', action: r.action, allowed: r.allowed, message: r.message || '', ipAddress: r.ip_address, ip: r.ip_address, createdAt: at, date: at.slice(0, 10), time: at.slice(11, 19) };
  }));
}

async function leaveAction(req, res) {
  const b = req.body || {};
  const id = Number(pick(b, 'RequestId', 'requestId', 'id') || 0);
  const action = String(pick(b, 'Action', 'action') || '');
  if (!id) return fail(res, 400, 'Request id required.');
  const decision = /approve/i.test(action) ? 'Approved' : /(reject|deny)/i.test(action) ? 'Rejected' : null;
  if (!decision) return fail(res, 400, 'Action must be Approve or Reject.');
  if (!req.user.permissions.has('leave.manage') && !req.user.legacyManagement) return fail(res, 403, 'Not authorised to decide leave.');
  const payType = /unpaid/i.test(action) || /unpaid/i.test(String(pick(b, 'PayType', 'payType') || '')) ? 'Unpaid' : 'Paid';
  const q = events.deferred();
  try {
    await leaves.decide(id, { decision, payType, note: `${decision} by management (attendance app)` }, req.user, { ip: clientIp(req), events: q });
  } catch (e) {
    if (e instanceof HttpError) return fail(res, e.status, e.message);
    throw e;
  }
  q.flush();
  return res.json({ success: true, message: `Leave ${decision === 'Approved' ? 'Approved' : 'Rejected'}.` });
}

async function shiftAction(req, res) {
  const b = req.body || {};
  const id = Number(pick(b, 'ShiftId', 'shiftId', 'id') || 0);
  const action = String(pick(b, 'Action', 'action') || '');
  const status = /approve/i.test(action) ? 'Approved' : /(reject|deny)/i.test(action) ? 'Denied' : null;
  if (!status) return fail(res, 400, 'Action must be Approve or Deny.');
  if (!id) return fail(res, 400, 'Shift request id required.');
  const shift = await knex('shift_requests').where({ id }).first();
  if (!shift) return fail(res, 404, 'Shift request not found.');
  if (shift.status !== 'Pending') return fail(res, 409, `This shift request was already ${String(shift.status).toLowerCase()}.`);
  let alreadyDecided = false;
  await knex.transaction(async (trx) => {
    // Only a still-Pending row may be decided; a concurrent second click updates 0 rows and changes nothing.
    const updated = await trx('shift_requests').where({ id, status: 'Pending' }).update({ status, final_remarks: `${status} by management`, decided_by: req.user.id, decided_at: new Date() });
    if (!updated) { alreadyDecided = true; return; }
    let assigned = '';
    if (status === 'Approved' && shift.employee_id) {
      const match = await trx('shifts').whereRaw('lower(name)=lower(?)', [shift.shift_type || '']).first();
      if (match) {
        await trx('employees').where({ id: shift.employee_id }).update({ shift_id: match.id, updated_at: new Date() });
        assigned = ` Assigned shift ${match.name} (${String(match.start_time).slice(0, 5)}–${String(match.end_time).slice(0, 5)}).`;
      }
    }
    await trx('notes_notifications').insert({
      title: status === 'Approved' ? 'Shift Approved' : 'Shift Request Denied', content: `Your shift request has been ${status.toLowerCase()}.`,
      author_role: 'Management', target_type: 'Individual', target_value: shift.username, created_by: req.user.id,
    });
    await audit(trx, { actor: req.user, action: `Shift request ${status.toLowerCase()}`, entityType: 'shift_request', entityId: id, detail: `${shift.username}: ${shift.shift_type} ${shift.custom_timing || ''}.${assigned}`, ip: clientIp(req) });
  });
  if (alreadyDecided) return fail(res, 409, 'This shift request was already decided.');
  if (status === 'Approved' && shift.employee_id) await afterAttendanceChange(shift.employee_id, today());
  return res.json({ success: true, message: `Shift ${status}.` });
}

async function notesCreate(req, res) {
  const b = req.body || {};
  const title = String(pick(b, 'Title', 'title') || '').trim();
  const content = String(pick(b, 'Content', 'content') || '').trim();
  if (!title || !content) return fail(res, 400, 'Title and content are required.');
  const tt = String(pick(b, 'TargetType', 'targetType') || 'All');
  await knex('notes_notifications').insert({
    title: title.slice(0, 200), content, author_role: String(pick(b, 'AuthorRole', 'authorRole') || 'Management').slice(0, 60),
    target_type: ['All', 'Team', 'Individual'].includes(tt) ? tt : 'All', target_value: String(pick(b, 'TargetValue', 'targetValue') || 'All').slice(0, 80), created_by: req.user.id,
  });
  return res.json({ success: true, message: 'Announcement published successfully.' });
}

async function notesDelete(req, res) {
  await knex('notes_notifications').where({ id: Number(req.params.id) }).del();
  return res.json({ success: true, message: 'Announcement deleted.' });
}

async function notesFeed(req, res) {
  const username = decodeURIComponent(req.params.username || '').toLowerCase();
  const team = String(req.query.team || '').toLowerCase();
  const rows = await knex('notes_notifications').orderBy('id', 'desc').limit(100);
  const visible = rows.filter((r) => {
    const t = (r.target_type || 'All').toLowerCase(); const v = (r.target_value || 'All').toLowerCase();
    return t === 'all' || (t === 'individual' && v === username) || (t === 'team' && v === team);
  });
  return res.json(visible.map((r) => ({ id: r.id, title: r.title, content: r.content, authorRole: r.author_role, targetType: r.target_type, targetValue: r.target_value, createdAt: r.created_at })));
}

async function networkDisconnects(_req, res) {
  const rows = await knex('network_disconnect_logs as l').leftJoin('users as u', 'u.id', 'l.user_id').orderBy('l.id', 'desc').limit(500)
    .select('l.*', 'u.username');
  return res.json(rows.map((r) => ({
    Id: r.id, SessionId: r.session_id, UserId: r.user_id, Username: r.username, DisconnectedAt: r.disconnected_at,
    ReconnectedAt: r.reconnected_at, DurationSeconds: r.duration_seconds, DeviceId: r.device_id, LastKnownIp: r.last_known_ip,
  })));
}

module.exports = {
  checkNetwork, registerBiometric, login, changePassword, sessionStatus, networkInterval, networkDisconnected, networkReconnected,
  verifyCheckout, submitReport, availableShifts, shiftSelect, leaveApply, leaveStatus, visitorRegister, visitorList, visitorCheckout,
  consentCreate, consentList, consentMarkSigned, cctvLogin, adminSession, adminLogout, adminWebLogin, networksList,
  networksCurrentIp, networksAdd, networksDelete, overview, dashboard, adminAttendance, adminAttendanceExport, usersList,
  usersAdd, usersDelete, deviceReset, ipLogs, leaveAction, shiftAction, notesCreate, notesDelete, notesFeed, networkDisconnects,
  afterAttendanceChange,
};
