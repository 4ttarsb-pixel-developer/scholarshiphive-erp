'use strict';
const express = require('express');
const knex = require('../db');
const c = require('../controllers/legacy-attendance.controller');
const auth = require('../services/auth.service');
const { requireLegacyAdmin } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rate-limit');
const { ah } = require('../utils/errors');

const router = express.Router();
const openReception = String(process.env.LEGACY_OPEN_RECEPTION_ENDPOINTS || 'false').toLowerCase() === 'true';

/**
 * Reception / consent / feed endpoints were unauthenticated in the Cloudflare Worker,
 * exposing visitor CNIC and passport data. They now require either an admin Bearer
 * token or the caller's active attendance session (header X-Attendance-Session),
 * which the updated Flutter app sends. LEGACY_OPEN_RECEPTION_ENDPOINTS=true restores
 * the old open behaviour for un-updated APKs during cut-over only.
 */
function requireAttendanceSession({ roles = null, matchUsernameParam = false } = {}) {
  return ah(async (req, res, next) => {
    if (req.user && (req.user.legacyManagement || req.user.permissions.has('attendance.security'))) return next();
    const sid = req.get('x-attendance-session') || '';
    if (/^[0-9a-f-]{36}$/i.test(sid)) {
      const row = await knex('attendance_sessions as s').join('users as u', 'u.id', 's.user_id')
        .where({ 's.session_id': sid, 's.is_active': true, 'u.is_active': true }).first('u.*');
      if (row) {
        const roleOk = !roles || roles(row);
        const userOk = !matchUsernameParam || decodeURIComponent(req.params.username || '').toLowerCase() === row.username.toLowerCase();
        if (roleOk && userOk) { req.legacyUser = row; return next(); }
      }
    }
    if (openReception) return next();
    return res.status(401).json({ success: false, message: 'An active attendance session is required.' });
  });
}
const receptionOnly = requireAttendanceSession({ roles: (u) => auth.isReceptionRole(u.attendance_role) || auth.isManagementRole(u.attendance_role) });

// --- employee app ---
router.all('/attendance/check-network', ah(c.checkNetwork));
router.post('/attendance/register-biometric', loginLimiter, ah(c.registerBiometric));
router.post('/attendance/login', loginLimiter, ah(c.login));
router.post('/attendance/change-password', loginLimiter, ah(c.changePassword));
router.get('/attendance/session-status', ah(c.sessionStatus));
router.post('/attendance/network-interval', ah(c.networkInterval));
router.post('/attendance/network-disconnected', ah(c.networkDisconnected));
router.post('/attendance/network-reconnected', ah(c.networkReconnected));
router.post('/attendance/verify-checkout', ah(c.verifyCheckout));
router.post('/attendance/submit-report', ah(c.submitReport));
router.get('/attendance/available-shifts', ah(c.availableShifts));
router.post('/attendance/shift/select', loginLimiter, ah(c.shiftSelect));
router.post('/attendance/leave/apply', loginLimiter, ah(c.leaveApply));
router.post('/attendance/leave/status', loginLimiter, ah(c.leaveStatus));
router.get('/notes/feed/:username', requireAttendanceSession({ matchUsernameParam: true }), ah(c.notesFeed));

// --- reception ---
router.post('/reception/visitor/register', receptionOnly, ah(c.visitorRegister));
router.get('/reception/visitor/list', receptionOnly, ah(c.visitorList));
router.post('/reception/visitor/checkout/:id(\\d+)', receptionOnly, ah(c.visitorCheckout));
router.post('/consent/create-or-send', receptionOnly, ah(c.consentCreate));
router.get('/consent/list', receptionOnly, ah(c.consentList));
router.post('/consent/mark-signed/:id(\\d+)', receptionOnly, ah(c.consentMarkSigned));
router.post('/reception/cctv/login', loginLimiter, ah(c.cctvLogin));

// --- management / attendance admin (Bearer token from login or web-login) ---
router.post('/admin/web-login', loginLimiter, ah(c.adminWebLogin));
router.get('/admin/session', requireLegacyAdmin, ah(c.adminSession));
router.delete('/admin/session', requireLegacyAdmin, ah(c.adminLogout));
router.get('/admin/networks', requireLegacyAdmin, ah(c.networksList));
router.get('/admin/networks/current-ip', requireLegacyAdmin, ah(c.networksCurrentIp));
router.post('/admin/networks', requireLegacyAdmin, ah(c.networksAdd));
router.delete('/admin/networks/:id(\\d+)', requireLegacyAdmin, ah(c.networksDelete));
router.get('/admin/overview', requireLegacyAdmin, ah(c.overview));
router.get('/admin/dashboard', requireLegacyAdmin, ah(c.dashboard));
router.get('/admin/attendance', requireLegacyAdmin, ah(c.adminAttendance));
router.get('/admin/attendance/export', requireLegacyAdmin, ah(c.adminAttendanceExport));
router.get('/admin/attendance/export-separate', requireLegacyAdmin, ah(c.adminAttendanceExport));
router.get('/admin/users', requireLegacyAdmin, ah(c.usersList));
router.post('/admin/users', requireLegacyAdmin, ah(c.usersAdd));
router.delete('/admin/users/:id(\\d+)', requireLegacyAdmin, ah(c.usersDelete));
router.post('/admin/devices/:id(\\d+)/reset', requireLegacyAdmin, ah(c.deviceReset));
router.get('/admin/ip-logs', requireLegacyAdmin, ah(c.ipLogs));
router.post('/admin/leave/action', requireLegacyAdmin, ah(c.leaveAction));
router.post('/admin/shift/action', requireLegacyAdmin, ah(c.shiftAction));
router.post('/admin/notes/create', requireLegacyAdmin, ah(c.notesCreate));
router.delete('/admin/notes/delete/:id(\\d+)', requireLegacyAdmin, ah(c.notesDelete));
router.get('/admin/network-disconnects', requireLegacyAdmin, ah(c.networkDisconnects));

module.exports = router;
