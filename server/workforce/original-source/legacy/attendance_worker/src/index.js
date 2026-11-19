function corsHeaders(contentType = "application/json; charset=utf-8") {
  return {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

function text(data, contentType = "text/plain; charset=utf-8", status = 200) {
  return new Response(data, { status, headers: corsHeaders(contentType) });
}

function nowIso() { return new Date().toISOString(); }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function newId() { return crypto.randomUUID(); }

async function sha256(value) {
  const bytes = new TextEncoder().encode(value ?? "");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function bodyJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function pick(body, ...names) {
  for (const n of names) if (body[n] !== undefined && body[n] !== null) return body[n];
  return undefined;
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
}

function expandIpv6(ip) {
  const value = String(ip || "").split("/")[0].trim().toLowerCase();
  if (!value.includes(":")) return [];
  const halves = value.split("::");
  if (halves.length > 2) return [];
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const missing = halves.length > 1 ? Math.max(0, 8 - left.length - right.length) : 0;
  const full = halves.length > 1 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (full.length !== 8) return [];
  return full.map(x => (x || "0").padStart(4, "0"));
}

function ipv6ToBigInt(ip) {
  const full = expandIpv6(ip);
  if (full.length !== 8) return null;
  try { return full.reduce((acc, part) => (acc << 16n) + BigInt(parseInt(part, 16)), 0n); }
  catch (_) { return null; }
}

function ipv4ToBigInt(ip) {
  const parts = String(ip || "").split("/")[0].trim().split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = (value << 8n) + BigInt(n);
  }
  return value;
}


function isPrivateIpv4(ip) {
  const parts = String(ip || "").split("/")[0].trim().split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

function normalizeOfficeNetwork(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const slash = raw.lastIndexOf("/");
  const ipOnly = slash >= 0 ? raw.slice(0, slash) : raw;
  const prefixText = slash >= 0 ? raw.slice(slash + 1) : "";
  if (ipOnly.includes(":")) {
    const full = expandIpv6(ipOnly);
    if (full.length !== 8) return "";
    let prefix = prefixText ? Number(prefixText) : 64;
    if (!Number.isInteger(prefix) || prefix < 1 || prefix > 128) prefix = 64;
    return `${full.join(":")}/${prefix}`;
  }
  if (ipv4ToBigInt(ipOnly) === null) return "";
  let prefix = prefixText ? Number(prefixText) : 32;
  if (!Number.isInteger(prefix) || prefix < 1 || prefix > 32) prefix = 32;
  return `${ipOnly}/${prefix}`;
}

function officeNetworkMatches(rule, ip) {
  const normalized = normalizeOfficeNetwork(rule);
  const current = String(ip || "").trim().toLowerCase();
  if (!normalized || !current) return false;
  const [ruleIp, prefixRaw] = normalized.split("/");
  const prefix = Number(prefixRaw);
  if (ruleIp.includes(":") && current.includes(":")) {
    const a = ipv6ToBigInt(ruleIp), b = ipv6ToBigInt(current);
    if (a === null || b === null) return false;
    const p = BigInt(prefix);
    const mask = ((1n << p) - 1n) << (128n - p);
    return (a & mask) === (b & mask);
  }
  if (!ruleIp.includes(":") && !current.includes(":")) {
    const a = ipv4ToBigInt(ruleIp), b = ipv4ToBigInt(current);
    if (a === null || b === null) return false;
    const p = BigInt(prefix);
    const mask = ((1n << p) - 1n) << (32n - p);
    return (a & mask) === (b & mask);
  }
  return false;
}

async function approvedOfficeNetwork(db, request) {
  const ip = clientIp(request);
  const rows = (await db.prepare(
    "SELECT Id,Name,Rule AS PublicIp,IsActive FROM OfficeNetworkRules WHERE IsActive=1 ORDER BY Id DESC"
  ).all()).results || [];
  const matched = rows.find(r => officeNetworkMatches(r.PublicIp, ip)) || null;
  return { ip, rows, matched };
}

function managementRole(role) {
  return ["owner", "country actor", "head of marketing", "head of processing"].includes((role || "").toLowerCase());
}

function authToken(request) {
  return (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

async function requireAdmin(request, db) {
  const token = authToken(request);
  if (!token) return null;
  return await db.prepare("SELECT * FROM AdminSessions WHERE Token = ? LIMIT 1").bind(token).first();
}

async function logIp(db, username, ip, action, allowed = 1, message = "") {
  // Supports the original minimal IpLogs table without requiring ALTER TABLE.
  try {
    await db.prepare("INSERT INTO IpLogs (Username, IpAddress, CreatedAt) VALUES (?, ?, ?)")
      .bind(`${username || "unknown"}|${action}|${allowed ? "OK" : "DENIED"}|${message}`.slice(0, 220), ip, nowIso()).run();
  } catch (_) {}
}

async function ensureTables(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS AdminSessions (Token TEXT PRIMARY KEY, UserId INTEGER NOT NULL, Username TEXT NOT NULL, Role TEXT NOT NULL, CreatedAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ShiftRecords (Id INTEGER PRIMARY KEY AUTOINCREMENT, Username TEXT NOT NULL, ShiftType TEXT, CustomTiming TEXT, RequestedAt TEXT NOT NULL, Status TEXT NOT NULL DEFAULT 'Pending', FinalRemarks TEXT)`,
    `CREATE TABLE IF NOT EXISTS LeaveRequests (Id INTEGER PRIMARY KEY AUTOINCREMENT, Username TEXT NOT NULL, LeaveType TEXT, Reason TEXT, LeaveDate TEXT, RequestedAt TEXT NOT NULL, Status TEXT NOT NULL DEFAULT 'Pending', SupervisorSignature TEXT, FinalRemarks TEXT)`,
    `CREATE TABLE IF NOT EXISTS NotesNotifications (Id INTEGER PRIMARY KEY AUTOINCREMENT, Title TEXT NOT NULL, Content TEXT NOT NULL, AuthorRole TEXT, TargetType TEXT NOT NULL DEFAULT 'All', TargetValue TEXT NOT NULL DEFAULT 'All', CreatedAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS VisitorRecords (Id INTEGER PRIMARY KEY AUTOINCREMENT, FullName TEXT NOT NULL, ContactNumber TEXT, PhoneOrCnic TEXT, Purpose TEXT, WhomToMeet TEXT, InterestedCountry TEXT, InterestedProgram TEXT, CounsellorName TEXT, LastQualification TEXT, CgpaOrPercentage TEXT, RegisteredBy TEXT, CheckInTime TEXT NOT NULL, CheckOutTime TEXT, Status TEXT NOT NULL DEFAULT 'Inside')`,
    `CREATE TABLE IF NOT EXISTS ItalyConsentForms (Id INTEGER PRIMARY KEY AUTOINCREMENT, ClientFullName TEXT NOT NULL, FamilyName TEXT, Gender TEXT, DomicileCity TEXT, CnicNumber TEXT, PhoneNumber TEXT, PassportNumber TEXT, FullAddress TEXT, QualificationDetails TEXT, PolicyVariant TEXT, TotalPackageFee INTEGER, CounselorName TEXT, RepresentativeSignature TEXT, CreatedAt TEXT NOT NULL, Status TEXT NOT NULL DEFAULT 'Issued')`,
    `CREATE TABLE IF NOT EXISTS OfficeNetworks (Id INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT NOT NULL, PublicIp TEXT NOT NULL UNIQUE, IsActive INTEGER NOT NULL DEFAULT 1, CreatedAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS OfficeNetworkRules (Id INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT NOT NULL, Rule TEXT NOT NULL, IsActive INTEGER NOT NULL DEFAULT 1, CreatedAt TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS IX_OfficeNetworkRules_Active ON OfficeNetworkRules(IsActive)`,
  ];
  for (const s of statements) await db.prepare(s).run();
  try {
    await db.prepare(`
      INSERT INTO OfficeNetworkRules (Name,Rule,IsActive,CreatedAt)
      SELECT o.Name,o.PublicIp,o.IsActive,o.CreatedAt
      FROM OfficeNetworks o
      WHERE NOT EXISTS (
        SELECT 1 FROM OfficeNetworkRules n
        WHERE lower(n.Name)=lower(o.Name) AND lower(n.Rule)=lower(o.PublicIp)
      )
    `).run();
  } catch (_) {}
}

function attendanceDto(r) {
  const checkIn = r.CheckIn || "";
  return {
    id: r.Id,
    sessionId: r.SessionId,
    username: r.Username,
    user: r.Username,
    date: checkIn ? checkIn.slice(0, 10) : "",
    checkIn: r.CheckIn,
    checkOut: r.CheckOut,
    checkInIp: r.CheckInIp,
    checkOutIp: r.CheckOutIp,
    report: r.Report,
    status: r.IsActive ? "Active" : "Checked Out",
  };
}

function durationText(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function mergedAwaySeconds(logs, sessionStartMs, sessionEndMs) {
  if (!Number.isFinite(sessionStartMs) || !Number.isFinite(sessionEndMs) || sessionEndMs <= sessionStartMs) return 0;

  const intervals = [];
  for (const log of logs || []) {
    const rawStart = Date.parse(log.DisconnectedAt || "");
    const rawEnd = log.ReconnectedAt ? Date.parse(log.ReconnectedAt) : sessionEndMs;
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;

    const start = Math.max(sessionStartMs, rawStart);
    const end = Math.min(sessionEndMs, rawEnd);
    if (end > start) intervals.push([start, end]);
  }

  intervals.sort((a, b) => a[0] - b[0]);
  let totalMs = 0;
  let currentStart = null;
  let currentEnd = null;

  for (const [start, end] of intervals) {
    if (currentStart === null) {
      currentStart = start;
      currentEnd = end;
      continue;
    }
    if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
    } else {
      totalMs += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    }
  }
  if (currentStart !== null) totalMs += currentEnd - currentStart;
  return Math.max(0, Math.floor(totalMs / 1000));
}

async function enrichAttendanceRows(db, rows) {
  const allLogs = (await db.prepare(
    "SELECT * FROM NetworkDisconnectLogs ORDER BY Id DESC LIMIT 10000"
  ).all()).results || [];

  const bySession = new Map();
  for (const log of allLogs) {
    const key = String(log.SessionId || "");
    if (!key) continue;
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key).push(log);
  }

  const nowMs = Date.now();
  return (rows || []).map((r) => {
    const dto = attendanceDto(r);
    const startMs = Date.parse(r.CheckIn || "");
    const parsedEnd = r.CheckOut ? Date.parse(r.CheckOut) : nowMs;
    const endMs = Number.isFinite(parsedEnd) ? parsedEnd : nowMs;
    const spanSeconds = Number.isFinite(startMs)
      ? Math.max(0, Math.floor((endMs - startMs) / 1000))
      : 0;

    const awaySeconds = Math.min(
      spanSeconds,
      mergedAwaySeconds(bySession.get(String(r.SessionId || "")) || [], startMs, endMs)
    );
    const actualOfficeSeconds = Math.max(0, spanSeconds - awaySeconds);

    return {
      ...dto,
      totalSpanSeconds: spanSeconds,
      networkAwaySeconds: awaySeconds,
      actualOfficeSeconds,
      totalSpanText: durationText(spanSeconds),
      networkAwayText: durationText(awaySeconds),
      actualOfficeTimeText: durationText(actualOfficeSeconds),
      completedEightHours: actualOfficeSeconds >= 8 * 3600,
    };
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    const db = env.attendance_db;

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

    try {
      await ensureTables(db);

      if (method === "GET" && path === "/") {
        return json({ success: true, message: "Attendance backend is running on Cloudflare Workers", version: "full-routes-v2" });
      }

      if ((method === "GET" || method === "POST") && path === "/api/attendance/check-network") {
        const { ip, rows, matched } = await approvedOfficeNetwork(db, request);
        if (rows.length === 0) {
          return json({ allowed: true, clientIp: ip, suggestedRule: normalizeOfficeNetwork(ip), setupMode: true, message: "No office Wi-Fi IP is configured yet." });
        }
        if (!matched) {
          const suggestedRule = normalizeOfficeNetwork(ip);
          return json({ allowed: false, clientIp: ip, suggestedRule, setupMode: false,
            message: `Not approved. Current phone public IP/range: ${suggestedRule || ip}` }, 403);
        }
        return json({ allowed: true, clientIp: ip, suggestedRule: normalizeOfficeNetwork(ip), setupMode: false,
          networkId: matched.Id, networkName: matched.Name, networkRule: matched.PublicIp,
          message: `Connected through approved office network: ${matched.Name}` });
      }

      if (method === "POST" && path === "/api/attendance/register-biometric") {
        const b = await bodyJson(request);
        const username = String(pick(b, "Username", "username") || "").trim();
        const password = String(pick(b, "Password", "password") || "");
        const deviceId = String(pick(b, "DeviceId", "deviceId") || "").trim();
        if (!username || !password || !deviceId) return json({ success: false, message: "Username, password and deviceId are required." }, 400);
        const user = await db.prepare("SELECT * FROM AppUsers WHERE lower(Username)=lower(?) LIMIT 1").bind(username).first();
        if (!user || user.PasswordHash !== await sha256(password)) return json({ success: false, message: "Invalid username or password." }, 401);
        const token = newId();
        await db.prepare("UPDATE AppUsers SET BiometricDeviceId=?, BiometricTokenHash=? WHERE Id=?")
          .bind(deviceId, await sha256(token), user.Id).run();
        return json({ success: true, token, message: "Fingerprint registered successfully." });
      }

      if (method === "POST" && path === "/api/attendance/login") {
        const b = await bodyJson(request);
        const username = String(pick(b, "Username", "username") || "").trim();
        const password = String(pick(b, "Password", "password") || "");
        const deviceId = String(pick(b, "DeviceId", "deviceId") || "chrome-browser").trim();
        const biometricToken = String(pick(b, "BiometricToken", "biometricToken") || "");
        if (!username) return json({ success: false, message: "Username is required." }, 400);
        if (!password && !biometricToken) return json({ success: false, message: "Password or fingerprint authentication is required." }, 400);

        // Enforce approved office network at the actual login endpoint too.
        // This prevents bypassing the app's separate check-network screen.
        const network = await approvedOfficeNetwork(db, request);
        if (network.rows.length > 0 && !network.matched) {
          await logIp(db, username, network.ip, "NETWORK_DENIED", false, "Login outside approved office network");
          return json({
            success: false,
            clientIp: network.ip,
            suggestedRule: normalizeOfficeNetwork(network.ip),
            message: `This network is not approved for attendance. Current detected network: ${normalizeOfficeNetwork(network.ip) || network.ip}`
          }, 403);
        }

        const user = await db.prepare("SELECT * FROM AppUsers WHERE lower(Username)=lower(?) LIMIT 1").bind(username).first();
        if (!user) return json({ success: false, message: "Invalid username or password." }, 401);

        if (biometricToken) {
          if (!user.BiometricDeviceId || !user.BiometricTokenHash) return json({ success: false, message: "Fingerprint is not registered for this account." }, 401);
          if (user.BiometricDeviceId !== deviceId) return json({ success: false, message: "Fingerprint is registered on another device. Re-register fingerprint on this device." }, 401);
          if (user.BiometricTokenHash !== await sha256(biometricToken)) return json({ success: false, message: "Fingerprint token is invalid. Re-register fingerprint." }, 401);
        } else if (user.PasswordHash !== await sha256(password)) {
          await logIp(db, username, clientIp(request), "LOGIN_FAILED", false, "Bad credentials");
          return json({ success: false, message: "Invalid username or password." }, 401);
        }

        const role = user.Role || "Staff";
        const isManagement = managementRole(role);
        const isReception = role.toLowerCase() === "receptionist";
        const ip = clientIp(request);

        // Non-management device binding, preserving management/reception usability.
        if (!isManagement && !isReception && deviceId) {
          const byUser = await db.prepare("SELECT * FROM DeviceBindings WHERE UserId=? LIMIT 1").bind(user.Id).first();
          const byDevice = await db.prepare("SELECT * FROM DeviceBindings WHERE DeviceId=? LIMIT 1").bind(deviceId).first();
          if (byDevice && byDevice.UserId !== user.Id) return json({ success: false, message: "This device is registered to another employee." }, 403);
          if (byUser && byUser.DeviceId && byUser.DeviceId !== deviceId) return json({ success: false, message: "This employee is registered on another device. Ask Owner to reset device." }, 403);
          if (!byUser) await db.prepare("INSERT INTO DeviceBindings (UserId, Username, DeviceId, IpAddress) VALUES (?, ?, ?, ?)").bind(user.Id, user.Username, deviceId, ip).run();
        }

        let record = await db.prepare("SELECT * FROM AttendanceRecords WHERE UserId=? AND IsActive=1 ORDER BY Id DESC LIMIT 1").bind(user.Id).first();
        let alreadyCheckedIn = !!record;
        if (!record) {
          const sessionId = newId();
          const checkInTime = nowIso();
          await db.prepare("INSERT INTO AttendanceRecords (SessionId,UserId,Username,CheckIn,CheckInIp,IsActive) VALUES (?,?,?,?,?,1)")
            .bind(sessionId, user.Id, user.Username, checkInTime, ip).run();
          record = await db.prepare("SELECT * FROM AttendanceRecords WHERE SessionId=?").bind(sessionId).first();
        }

        let adminToken = null;
        if (isManagement) {
          adminToken = newId();
          await db.prepare("INSERT INTO AdminSessions (Token,UserId,Username,Role,CreatedAt) VALUES (?,?,?,?,?)")
            .bind(adminToken, user.Id, user.Username, role, nowIso()).run();
        }
        await logIp(db, user.Username, ip, biometricToken ? "LOGIN_BIOMETRIC" : "LOGIN", true, role);
        return json({
          success: true,
          sessionId: record.SessionId,
          userName: user.Username,
          username: user.Username,
          fullName: user.FullName || user.Username,
          role,
          team: user.Team || "",
          isManagement,
          isReception,
          adminToken,
          allowMobile: !!user.AllowMobile,
          allowWeb: !!user.AllowWeb,
          hasCctvAccess: !!user.HasCctvAccess,
          alreadyCheckedIn,
          checkInTime: record.CheckIn || "",
        });
      }

      if (method === "POST" && path === "/api/attendance/change-password") {
        const b = await bodyJson(request);
        const username = String(pick(b, "Username", "username") || "").trim();
        const currentPassword = String(pick(b, "CurrentPassword", "currentPassword") || "");
        const newPassword = String(pick(b, "NewPassword", "newPassword") || "");
        if (!username || !currentPassword || newPassword.length < 4) return json({ success: false, message: "Username, current password and a new password of at least 4 characters are required." }, 400);
        const user = await db.prepare("SELECT * FROM AppUsers WHERE lower(Username)=lower(?) LIMIT 1").bind(username).first();
        if (!user || user.PasswordHash !== await sha256(currentPassword)) return json({ success: false, message: "Current password is incorrect." }, 401);
        await db.prepare("UPDATE AppUsers SET PasswordHash=? WHERE Id=?").bind(await sha256(newPassword), user.Id).run();
        return json({ success: true, message: "Password changed successfully." });
      }

      if (method === "GET" && path === "/api/attendance/session-status") {
        const sessionId = url.searchParams.get("sessionId") || "";
        const r = await db.prepare("SELECT * FROM AttendanceRecords WHERE SessionId=? LIMIT 1").bind(sessionId).first();
        return json({ success: true, active: !!(r && r.IsActive), sessionId, checkInTime: r?.CheckIn || "" });
      }

      if (method === "POST" && path === "/api/attendance/network-interval") {
        const b = await bodyJson(request);
        const sessionId = String(pick(b, "SessionId", "sessionId") || "");
        const deviceId = String(pick(b, "DeviceId", "deviceId") || "");
        const disconnectedAt = String(pick(b, "DisconnectedAt", "disconnectedAt") || nowIso());
        const reconnectedAt = String(pick(b, "ReconnectedAt", "reconnectedAt") || nowIso());
        const r = await db.prepare("SELECT * FROM AttendanceRecords WHERE SessionId=? LIMIT 1").bind(sessionId).first();
        if (!r) return json({ success: false, message: "Attendance session not found." }, 404);
        const seconds = Math.max(0, Math.floor((Date.parse(reconnectedAt) - Date.parse(disconnectedAt)) / 1000) || 0);
        await db.prepare("INSERT INTO NetworkDisconnectLogs (SessionId,UserId,Username,DisconnectedAt,ReconnectedAt,DurationSeconds,DeviceId,LastKnownIp) VALUES (?,?,?,?,?,?,?,?)")
          .bind(sessionId, r.UserId, r.Username, disconnectedAt, reconnectedAt, seconds, deviceId, clientIp(request)).run();
        return json({ success: true, durationSeconds: seconds });
      }

      if (method === "POST" && path === "/api/attendance/network-disconnected") {
        const b = await bodyJson(request); const sessionId = String(pick(b,"SessionId","sessionId")||"");
        const r = await db.prepare("SELECT * FROM AttendanceRecords WHERE SessionId=? LIMIT 1").bind(sessionId).first();
        if (!r) return json({success:false,message:"Attendance session not found."},404);
        const open = await db.prepare("SELECT Id FROM NetworkDisconnectLogs WHERE SessionId=? AND ReconnectedAt IS NULL ORDER BY Id DESC LIMIT 1").bind(sessionId).first();
        if (!open) await db.prepare("INSERT INTO NetworkDisconnectLogs (SessionId,UserId,Username,DisconnectedAt,DurationSeconds,DeviceId,LastKnownIp) VALUES (?,?,?,?,0,?,?)")
          .bind(sessionId,r.UserId,r.Username,nowIso(),String(pick(b,"DeviceId","deviceId")||""),clientIp(request)).run();
        return json({success:true,message:"Network disconnection recorded."});
      }

      if (method === "POST" && path === "/api/attendance/network-reconnected") {
        const b = await bodyJson(request); const sessionId = String(pick(b,"SessionId","sessionId")||"");
        const open = await db.prepare("SELECT * FROM NetworkDisconnectLogs WHERE SessionId=? AND ReconnectedAt IS NULL ORDER BY Id DESC LIMIT 1").bind(sessionId).first();
        if (!open) return json({success:true,message:"No open disconnection interval."});
        const re = nowIso(); const sec = Math.max(0,Math.floor((Date.parse(re)-Date.parse(open.DisconnectedAt))/1000));
        await db.prepare("UPDATE NetworkDisconnectLogs SET ReconnectedAt=?,DurationSeconds=? WHERE Id=?").bind(re,sec,open.Id).run();
        return json({success:true,durationSeconds:sec});
      }

      if (method === "POST" && path === "/api/attendance/verify-checkout") {
        const b = await bodyJson(request);
        const sessionId = String(pick(b,"SessionId","sessionId")||"");
        const r = await db.prepare("SELECT * FROM AttendanceRecords WHERE SessionId=? LIMIT 1").bind(sessionId).first();
        if (!r || !r.IsActive) {
          return json({ eligible:false, message:"No active attendance session found." });
        }

        // Checkout is intentionally stricter than setup-mode login/network checks:
        // at least one approved office network must exist and this request must
        // come through one of those approved public IP / IPv6 /64 rules.
        const network = await approvedOfficeNetwork(db, request);
        if (network.rows.length === 0) {
          return json({
            eligible:false,
            clientIp:network.ip,
            message:"Checkout is blocked until an office Wi-Fi/IP is configured by management."
          });
        }
        if (!network.matched) {
          return json({
            eligible:false,
            clientIp:network.ip,
            message:"Checkout is only allowed while connected to an approved office Wi-Fi network."
          });
        }

        return json({
          eligible:true,
          clientIp:network.ip,
          networkId:network.matched.Id,
          networkName:network.matched.Name,
          message:"Checkout allowed on approved office Wi-Fi."
        });
      }

      if (method === "POST" && path === "/api/attendance/submit-report") {
        const b = await bodyJson(request); const sessionId = String(pick(b,"SessionId","sessionId")||"");
        const report = String(pick(b,"Report","report","ReportContent","reportContent")||"").trim();
        const r = await db.prepare("SELECT * FROM AttendanceRecords WHERE SessionId=? LIMIT 1").bind(sessionId).first();
        if (!r || !r.IsActive) return json({success:false,message:"Attendance session is already closed or invalid."},400);

        // Server-side enforcement prevents checkout from mobile data / another Wi-Fi
        // even if a client bypasses the verify-checkout screen.
        const network = await approvedOfficeNetwork(db, request);
        if (network.rows.length === 0) {
          return json({
            success:false,
            clientIp:network.ip,
            message:"Checkout is blocked until an office Wi-Fi/IP is configured by management."
          },403);
        }
        if (!network.matched) {
          return json({
            success:false,
            clientIp:network.ip,
            message:"Checkout is only allowed while connected to an approved office Wi-Fi network."
          },403);
        }

        const checkOutAt = nowIso();
        await db.prepare("UPDATE AttendanceRecords SET CheckOut=?,CheckOutIp=?,Report=?,IsActive=0 WHERE SessionId=?")
          .bind(checkOutAt,clientIp(request),report,sessionId).run();

        // Close any server-side open disconnect interval at checkout so it is counted as away time.
        const openDisconnect = await db.prepare(
          "SELECT * FROM NetworkDisconnectLogs WHERE SessionId=? AND ReconnectedAt IS NULL ORDER BY Id DESC LIMIT 1"
        ).bind(sessionId).first();
        if (openDisconnect) {
          const seconds = Math.max(0, Math.floor((Date.parse(checkOutAt) - Date.parse(openDisconnect.DisconnectedAt)) / 1000) || 0);
          await db.prepare("UPDATE NetworkDisconnectLogs SET ReconnectedAt=?,DurationSeconds=? WHERE Id=?")
            .bind(checkOutAt, seconds, openDisconnect.Id).run();
        }

        const closed = await db.prepare("SELECT * FROM AttendanceRecords WHERE SessionId=? LIMIT 1").bind(sessionId).first();
        const metrics = (await enrichAttendanceRows(db, [closed]))[0];
        return json({
          success:true,
          message:"Report submitted and checkout completed.",
          actualOfficeSeconds: metrics.actualOfficeSeconds,
          actualOfficeTimeText: metrics.actualOfficeTimeText,
          networkAwaySeconds: metrics.networkAwaySeconds,
          networkAwayText: metrics.networkAwayText,
          totalSpanSeconds: metrics.totalSpanSeconds,
          totalSpanText: metrics.totalSpanText
        });
      }

      // ---------------- Shift / Leave ----------------
      if (method === "POST" && path === "/api/attendance/shift/select") {
        const b = await bodyJson(request); const username=String(pick(b,"Username","username")||"").trim(); const password=String(pick(b,"Password","password")||"");
        const user=await db.prepare("SELECT * FROM AppUsers WHERE lower(Username)=lower(?) LIMIT 1").bind(username).first();
        if(!user || user.PasswordHash!==await sha256(password)) return json({success:false,message:"Invalid username or password."},401);
        const shiftType=String(pick(b,"ShiftType","shiftType","shift")||"Morning"); const customTiming=String(pick(b,"CustomTiming","customTiming")||"");
        await db.prepare("INSERT INTO ShiftRecords (Username,ShiftType,CustomTiming,RequestedAt,Status) VALUES (?,?,?,?, 'Pending')").bind(user.Username,shiftType,customTiming,nowIso()).run();
        return json({success:true,message:"Shift request submitted successfully.",status:"Pending"});
      }

      if (method === "POST" && path === "/api/attendance/leave/apply") {
        const b=await bodyJson(request); const username=String(pick(b,"Username","username")||"").trim(); const password=String(pick(b,"Password","password")||"");
        const user=await db.prepare("SELECT * FROM AppUsers WHERE lower(Username)=lower(?) LIMIT 1").bind(username).first();
        if(!user || user.PasswordHash!==await sha256(password)) return json({success:false,message:"Invalid username or password."},401);
        const leaveType=String(pick(b,"LeaveType","leaveType")||"Leave"); const reason=String(pick(b,"Reason","reason")||""); const leaveDate=String(pick(b,"LeaveDate","leaveDate")||todayIso());
        await db.prepare("INSERT INTO LeaveRequests (Username,LeaveType,Reason,LeaveDate,RequestedAt,Status) VALUES (?,?,?,?,?,'Pending')").bind(user.Username,leaveType,reason,leaveDate,nowIso()).run();
        return json({success:true,message:"Leave application submitted successfully.",status:"Pending"});
      }

      if (method === "POST" && path === "/api/attendance/leave/status") {
        const b=await bodyJson(request); const username=String(pick(b,"Username","username")||"").trim(); const password=String(pick(b,"Password","password")||"");
        const user=await db.prepare("SELECT * FROM AppUsers WHERE lower(Username)=lower(?) LIMIT 1").bind(username).first();
        if(!user || user.PasswordHash!==await sha256(password)) return json({success:false,message:"Invalid username or password."},401);
        const r=await db.prepare("SELECT * FROM LeaveRequests WHERE lower(Username)=lower(?) ORDER BY Id DESC LIMIT 1").bind(user.Username).first();
        if(!r) return json({success:false,message:"No leave request found."},404);
        return json({success:true,id:r.Id,username:r.Username,leaveType:r.LeaveType,reason:r.Reason,leaveDate:r.LeaveDate,status:r.Status,supervisorSignature:r.SupervisorSignature||"",finalRemarks:r.FinalRemarks||""});
      }

      // ---------------- Reception ----------------
      if (method === "POST" && path === "/api/reception/visitor/register") {
        const b=await bodyJson(request); const fullName=String(pick(b,"FullName","fullName","VisitorName","visitorName")||"").trim();
        if(!fullName) return json({success:false,message:"Visitor full name is required."},400);
        const contact=String(pick(b,"ContactNumber","contactNumber")||""); const phoneOrCnic=String(pick(b,"PhoneOrCnic","phoneOrCnic")||contact);
        const fields=[fullName,contact,phoneOrCnic,String(pick(b,"Purpose","purpose")||""),String(pick(b,"WhomToMeet","whomToMeet")||""),String(pick(b,"InterestedCountry","interestedCountry")||""),String(pick(b,"InterestedProgram","interestedProgram")||""),String(pick(b,"CounsellorName","counsellorName","CounselorName","counselorName")||""),String(pick(b,"LastQualification","lastQualification")||""),String(pick(b,"CgpaOrPercentage","cgpaOrPercentage")||""),String(pick(b,"RegisteredBy","registeredBy")||"Reception"),nowIso()];
        const res=await db.prepare("INSERT INTO VisitorRecords (FullName,ContactNumber,PhoneOrCnic,Purpose,WhomToMeet,InterestedCountry,InterestedProgram,CounsellorName,LastQualification,CgpaOrPercentage,RegisteredBy,CheckInTime,Status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'Inside')").bind(...fields).run();
        return json({success:true,id:res.meta.last_row_id,message:"Visitor registered successfully."});
      }

      if (method === "GET" && path === "/api/reception/visitor/list") {
        const rows=(await db.prepare("SELECT * FROM VisitorRecords ORDER BY Id DESC LIMIT 500").all()).results;
        return json(rows.map(r=>({id:r.Id,Id:r.Id,fullName:r.FullName,FullName:r.FullName,visitorName:r.FullName,contactNumber:r.ContactNumber,ContactNumber:r.ContactNumber,phoneOrCnic:r.PhoneOrCnic,purpose:r.Purpose,whomToMeet:r.WhomToMeet,interestedCountry:r.InterestedCountry,InterestedCountry:r.InterestedCountry,interestedProgram:r.InterestedProgram,InterestedProgram:r.InterestedProgram,counsellorName:r.CounsellorName,CounsellorName:r.CounsellorName,lastQualification:r.LastQualification,LastQualification:r.LastQualification,cgpaOrPercentage:r.CgpaOrPercentage,CgpaOrPercentage:r.CgpaOrPercentage,registeredBy:r.RegisteredBy,checkInTime:r.CheckInTime,CheckInTime:r.CheckInTime,checkOutTime:r.CheckOutTime,CheckOutTime:r.CheckOutTime,status:r.Status,Status:r.Status})));
      }

      let m=path.match(/^\/api\/reception\/visitor\/checkout\/(\d+)$/);
      if(method==="POST" && m){ const id=Number(m[1]); const r=await db.prepare("SELECT * FROM VisitorRecords WHERE Id=?").bind(id).first(); if(!r)return json({success:false,message:"Visitor not found."},404); await db.prepare("UPDATE VisitorRecords SET CheckOutTime=?,Status='Checked Out' WHERE Id=?").bind(nowIso(),id).run(); return json({success:true,message:"Visitor checked out."}); }

      if(method==="POST" && path==="/api/consent/create-or-send"){
        const b=await bodyJson(request); const client=String(pick(b,"ClientFullName","clientFullName")||"").trim(); if(!client)return json({success:false,message:"Client full name is required."},400);
        const counselor=String(pick(b,"CounselorName","counselorName","CounsellorName","counsellorName")||"Muazzam"); const signature=`Digitally Authorized by ${counselor}`;
        const vals=[client,String(pick(b,"FamilyName","familyName")||""),String(pick(b,"Gender","gender")||""),String(pick(b,"DomicileCity","domicileCity")||""),String(pick(b,"CnicNumber","cnicNumber")||""),String(pick(b,"PhoneNumber","phoneNumber")||""),String(pick(b,"PassportNumber","passportNumber")||""),String(pick(b,"FullAddress","fullAddress")||""),String(pick(b,"QualificationDetails","qualificationDetails")||""),String(pick(b,"PolicyVariant","policyVariant")||""),Number(pick(b,"TotalPackageFee","totalPackageFee")||250000),counselor,signature,nowIso()];
        const res=await db.prepare("INSERT INTO ItalyConsentForms (ClientFullName,FamilyName,Gender,DomicileCity,CnicNumber,PhoneNumber,PassportNumber,FullAddress,QualificationDetails,PolicyVariant,TotalPackageFee,CounselorName,RepresentativeSignature,CreatedAt,Status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Issued')").bind(...vals).run();
        return json({success:true,id:res.meta.last_row_id,counselorName:counselor,signature,message:"Consent form saved successfully."});
      }

      if(method==="GET" && path==="/api/consent/list"){
        const rows=(await db.prepare("SELECT * FROM ItalyConsentForms ORDER BY Id DESC LIMIT 500").all()).results;
        return json(rows.map(r=>({id:r.Id,Id:r.Id,clientFullName:r.ClientFullName,ClientFullName:r.ClientFullName,policyVariant:r.PolicyVariant,PolicyVariant:r.PolicyVariant,totalPackageFee:r.TotalPackageFee,TotalPackageFee:r.TotalPackageFee,counselorName:r.CounselorName,CounselorName:r.CounselorName,counsellorName:r.CounselorName,representativeSignature:r.RepresentativeSignature,RepresentativeSignature:r.RepresentativeSignature,signature:r.RepresentativeSignature,createdAt:r.CreatedAt,CreatedAt:r.CreatedAt,status:r.Status,Status:r.Status})));
      }

      m=path.match(/^\/api\/consent\/mark-signed\/(\d+)$/);
      if(method==="POST" && m){ const id=Number(m[1]); const r=await db.prepare("SELECT * FROM ItalyConsentForms WHERE Id=?").bind(id).first(); if(!r)return json({success:false,message:"Consent Form not found."},404); await db.prepare("UPDATE ItalyConsentForms SET Status='Signed & Archived' WHERE Id=?").bind(id).run(); return json({success:true,message:"Consent Form marked as officially signed & archived."}); }

      if(method==="POST" && path==="/api/reception/cctv/login"){
        const b=await bodyJson(request); const username=String(pick(b,"Username","username")||"").trim(); const password=String(pick(b,"Password","password")||""); const u=await db.prepare("SELECT * FROM AppUsers WHERE lower(Username)=lower(?) LIMIT 1").bind(username).first();
        if(!u || u.PasswordHash!==await sha256(password) || !u.HasCctvAccess)return json({success:false,message:"CCTV Access Denied: Unauthorized credentials."},403);
        return json({success:true,streamServer:"rtsp://cctv.local.scholarshiphive.internal:554/live",cameras:[{id:1,name:"Front Reception & Entrance Gate",status:"Online",streamUrl:"Cam-01-Gate"},{id:2,name:"Main Waiting Lounge",status:"Online",streamUrl:"Cam-02-Lounge"},{id:3,name:"Processing Hall Corridor",status:"Online",streamUrl:"Cam-03-Processing"},{id:4,name:"Executive Corridor",status:"Online",streamUrl:"Cam-04-Executive"}]});
      }

      // ---------------- Admin auth/session ----------------
      if(method==="GET" && path==="/api/admin/session"){ const s=await requireAdmin(request,db); return s?json({success:true,username:s.Username,role:s.Role}):json({success:false,message:"Invalid admin session."},401); }
      if(method==="DELETE" && path==="/api/admin/session"){ const t=authToken(request); if(t) await db.prepare("DELETE FROM AdminSessions WHERE Token=?").bind(t).run(); return json({success:true}); }

      if(method==="POST" && path==="/api/admin/web-login"){
        const b=await bodyJson(request); const username=String(pick(b,"Username","username")||""); const password=String(pick(b,"Password","password")||"");
        const u=await db.prepare("SELECT * FROM AppUsers WHERE lower(Username)=lower(?) LIMIT 1").bind(username).first(); if(!u||u.PasswordHash!==await sha256(password)||!managementRole(u.Role))return json({success:false,message:"Management credentials required."},401);
        const token=newId(); await db.prepare("INSERT INTO AdminSessions (Token,UserId,Username,Role,CreatedAt) VALUES (?,?,?,?,?)").bind(token,u.Id,u.Username,u.Role,nowIso()).run(); return json({success:true,token,adminToken:token,username:u.Username,userName:u.Username,fullName:u.FullName||u.Username,role:u.Role});
      }

      if(path.startsWith("/api/admin/") && !["/api/admin/session","/api/admin/web-login"].includes(path)){
        const s=await requireAdmin(request,db); if(!s)return json({success:false,message:"Management authorization required."},401);
      }

      // Office Wi-Fi / public IP management
      if(method==="GET" && path==="/api/admin/networks"){
        const rows=(await db.prepare("SELECT Id,Name,Rule,IsActive,CreatedAt FROM OfficeNetworkRules ORDER BY Id DESC").all()).results||[];
        return json(rows.map(r=>({id:r.Id,name:r.Name,publicIp:r.Rule,rule:r.Rule,isActive:!!r.IsActive,createdAt:r.CreatedAt})));
      }

      if(method==="GET" && path==="/api/admin/networks/current-ip"){
        const raw=clientIp(request);
        return json({success:true,publicIp:raw,suggestedRule:normalizeOfficeNetwork(raw)});
      }

      if(method==="POST" && path==="/api/admin/networks"){
        const b=await bodyJson(request);
        const name=String(pick(b,"Name","name")||"Office WiFi").trim();
        const raw=String(pick(b,"PublicIp","publicIp","Rule","rule")||"").trim();
        const detectedIp=clientIp(request);
        // A cloud backend cannot see a router's private 192.168/10/172 address.
        // If an admin enters one while on that office Wi-Fi, save the actual
        // public address observed by Cloudflare instead. This is what all NAT
        // clients on that Wi-Fi normally share.
        const source=(isPrivateIpv4(raw) ? detectedIp : (raw || detectedIp));
        const rule=normalizeOfficeNetwork(source);
        if(!name||!rule||rule==="unknown")return json({success:false,message:"Network name and a valid IP/range are required."},400);
        const existing=await db.prepare("SELECT Id FROM OfficeNetworkRules WHERE lower(Name)=lower(?) AND lower(Rule)=lower(?) LIMIT 1").bind(name,rule).first();
        if(existing)return json({success:true,existing:true,id:existing.Id,message:"This Wi-Fi rule is already saved.",publicIp:rule});
        const result=await db.prepare("INSERT INTO OfficeNetworkRules (Name,Rule,IsActive,CreatedAt) VALUES (?,?,1,?)").bind(name,rule,nowIso()).run();
        return json({success:true,id:result.meta?.last_row_id||null,message:isPrivateIpv4(raw)?"Private router IP detected; the office public network seen by the server was saved successfully.":"Office Wi-Fi rule added successfully.",publicIp:rule,detectedIp});
      }

      m=path.match(/^\/api\/admin\/networks\/(\d+)$/);
      if(method==="DELETE" && m){
        const id=Number(m[1]);
        const existing=await db.prepare("SELECT Id,Name,Rule FROM OfficeNetworkRules WHERE Id=? LIMIT 1").bind(id).first();
        if(!existing)return json({success:false,message:"Office Wi-Fi rule not found."},404);
        await db.prepare("DELETE FROM OfficeNetworkRules WHERE Id=?").bind(id).run();
        return json({success:true,message:"Office Wi-Fi rule removed successfully."});
      }

      if(method==="GET" && path==="/api/admin/overview"){
        const leaves=(await db.prepare("SELECT * FROM LeaveRequests ORDER BY Id DESC LIMIT 100").all()).results.map(r=>({id:r.Id,username:r.Username,leaveType:r.LeaveType,reason:r.Reason,leaveDate:r.LeaveDate,requestedAt:r.RequestedAt,status:r.Status,finalRemarks:r.FinalRemarks||""}));
        const shifts=(await db.prepare("SELECT * FROM ShiftRecords ORDER BY Id DESC LIMIT 100").all()).results.map(r=>({id:r.Id,username:r.Username,department:"",customTiming:r.CustomTiming||r.ShiftType,requestedAt:r.RequestedAt,status:r.Status,finalRemarks:r.FinalRemarks||""}));
        const notes=(await db.prepare("SELECT * FROM NotesNotifications ORDER BY Id DESC LIMIT 100").all()).results.map(r=>({id:r.Id,title:r.Title,content:r.Content,authorRole:r.AuthorRole,targetType:r.TargetType,targetValue:r.TargetValue,createdAt:r.CreatedAt}));
        const visitors=(await db.prepare("SELECT * FROM VisitorRecords ORDER BY Id DESC LIMIT 100").all()).results.map(r=>({id:r.Id,visitorName:r.FullName,fullName:r.FullName,contactNumber:r.ContactNumber,phoneOrCnic:r.PhoneOrCnic,purpose:r.Purpose,whomToMeet:r.WhomToMeet,interestedCountry:r.InterestedCountry,interestedProgram:r.InterestedProgram,counsellorName:r.CounsellorName,registeredBy:r.RegisteredBy,checkInTime:r.CheckInTime,checkOutTime:r.CheckOutTime,status:r.Status}));
        return json({leaves,shifts,notes,visitors});
      }

      if(method==="GET" && path==="/api/admin/dashboard"){
        const totalUsers=(await db.prepare("SELECT COUNT(*) c FROM AppUsers").first()).c||0;
        const presentUsers=(await db.prepare("SELECT COUNT(*) c FROM AttendanceRecords WHERE IsActive=1").first()).c||0;
        const checkedOutToday=(await db.prepare("SELECT COUNT(*) c FROM AttendanceRecords WHERE IsActive=0 AND substr(CheckOut,1,10)=?").bind(todayIso()).first()).c||0;
        const activityToday=(await db.prepare("SELECT COUNT(*) c FROM AttendanceRecords WHERE substr(CheckIn,1,10)=?").bind(todayIso()).first()).c||0;
        const recent=(await db.prepare("SELECT * FROM AttendanceRecords ORDER BY Id DESC LIMIT 10").all()).results.map(r=>({user:r.Username,action:r.IsActive?"CHECK_IN":"CHECK_OUT",date:(r.CheckOut||r.CheckIn||"").slice(0,10),time:(r.CheckOut||r.CheckIn||"").slice(11,19),ip:r.CheckOutIp||r.CheckInIp||""}));
        return json({totalUsers,presentUsers,checkedOutToday,activityToday,recentActivity:recent});
      }

      if(method==="GET" && path==="/api/admin/attendance"){
        let rows=(await db.prepare("SELECT * FROM AttendanceRecords ORDER BY Id DESC LIMIT 1000").all()).results;
        const username=(url.searchParams.get("username")||url.searchParams.get("search")||"").toLowerCase(); const status=(url.searchParams.get("status")||"").toLowerCase(); const from=url.searchParams.get("fromDate")||""; const to=url.searchParams.get("toDate")||"";
        rows=rows.filter(r=>{const d=(r.CheckIn||"").slice(0,10); return (!username||r.Username.toLowerCase().includes(username))&&(!status||(status.includes("active")?!!r.IsActive:status.includes("out")?!r.IsActive:true))&&(!from||d>=from)&&(!to||d<=to)});
        return json(await enrichAttendanceRows(db, rows));
      }

      if(method==="GET" && path==="/api/admin/users"){
        const search=(url.searchParams.get("search")||"").toLowerCase(); const users=(await db.prepare("SELECT * FROM AppUsers ORDER BY Id DESC").all()).results; const out=[];
        for(const u of users){ if(search && !`${u.Username} ${u.FullName||""} ${u.Email||""}`.toLowerCase().includes(search))continue; const d=await db.prepare("SELECT * FROM DeviceBindings WHERE UserId=? LIMIT 1").bind(u.Id).first(); out.push({id:u.Id,username:u.Username,fullName:u.FullName||"",email:u.Email||"",role:u.Role||"Staff",team:u.Team||"",allowMobile:!!u.AllowMobile,allowWeb:!!u.AllowWeb,hasCctvAccess:!!u.HasCctvAccess,deviceBindingId:d?.Id??null,deviceId:d?.DeviceId||"",ipAddress:d?.IpAddress||"",registeredAt:""}); }
        return json(out);
      }

      if(method==="POST" && path==="/api/admin/users"){
        const s=await requireAdmin(request,db); if(!s||s.Role!=="Owner")return json({success:false,message:"Only the Owner can add new users."},403);
        const b=await bodyJson(request); const username=String(pick(b,"Username","username")||"").trim(); const fullName=String(pick(b,"FullName","fullName")||"").trim(); const password=String(pick(b,"Password","password")||"");
        if(!username||!fullName||password.length<4)return json({success:false,message:"Username, full name, and a password of at least 4 characters are required."},400);
        if(await db.prepare("SELECT Id FROM AppUsers WHERE lower(Username)=lower(?)").bind(username).first())return json({success:false,message:"Username already exists."},409);
        await db.prepare("INSERT INTO AppUsers (Username,FullName,Email,PasswordHash,Role,Team,AllowMobile,AllowWeb,HasCctvAccess) VALUES (?,?,?,?,?,?,?,?,?)")
          .bind(username,fullName,String(pick(b,"Email","email")||""),await sha256(password),String(pick(b,"Role","role")||"Staff"),String(pick(b,"Team","team")||""),pick(b,"AllowMobile","allowMobile")===false?0:1,pick(b,"AllowWeb","allowWeb")===false?0:1,pick(b,"HasCctvAccess","hasCctvAccess")===true?1:0).run();
        return json({success:true,message:"User created successfully."});
      }

      m=path.match(/^\/api\/admin\/users\/(\d+)$/);
      if(method==="DELETE" && m){
        const admin=await requireAdmin(request,db);
        if(!admin || String(admin.Role||"").toLowerCase()!=="owner")return json({success:false,message:"Only the Owner can delete users."},403);
        const id=Number(m[1]);
        const target=await db.prepare("SELECT * FROM AppUsers WHERE Id=? LIMIT 1").bind(id).first();
        if(!target)return json({success:false,message:"User not found."},404);
        const protectedNames=["admin","superadmin"];
        if(protectedNames.includes(String(target.Username||"").toLowerCase()))return json({success:false,message:"The Super Admin account cannot be deleted."},403);
        await db.prepare("DELETE FROM AdminSessions WHERE UserId=?").bind(id).run();
        await db.prepare("DELETE FROM DeviceBindings WHERE UserId=?").bind(id).run();
        await db.prepare("DELETE FROM AppUsers WHERE Id=?").bind(id).run();
        return json({success:true,message:"User deleted successfully."});
      }

      m=path.match(/^\/api\/admin\/devices\/(\d+)\/reset$/);
      if(method==="POST" && m){ await db.prepare("DELETE FROM DeviceBindings WHERE Id=?").bind(Number(m[1])).run(); return json({success:true,message:"Device registration reset."}); }

      if(method==="GET" && path==="/api/admin/ip-logs"){
        let rows=(await db.prepare("SELECT * FROM IpLogs ORDER BY Id DESC LIMIT 1000").all()).results; const q=(url.searchParams.get("search")||url.searchParams.get("username")||"").toLowerCase(); if(q)rows=rows.filter(r=>`${r.Username} ${r.IpAddress}`.toLowerCase().includes(q));
        return json(rows.map(r=>{const parts=String(r.Username||"").split("|"); return {id:r.Id,username:parts[0]||"",action:parts[1]||"ACTIVITY",allowed:(parts[2]||"")==="OK",message:parts.slice(3).join("|"),ipAddress:r.IpAddress,ip:r.IpAddress,createdAt:r.CreatedAt,date:(r.CreatedAt||"").slice(0,10),time:(r.CreatedAt||"").slice(11,19)};}));
      }

      if(method==="GET" && path==="/api/admin/attendance/export-separate"){
        const raw=(await db.prepare("SELECT * FROM AttendanceRecords ORDER BY Username, Id DESC LIMIT 5000").all()).results;
        const rows=await enrichAttendanceRows(db,raw);
        const esc=v=>`"${String(v??"").replaceAll('"','""')}"`;
        const lines=["Username,Date,CheckIn,CheckOut,TotalSpan,NetworkAway,ActualOfficeTime,Status,CheckInIp,CheckOutIp,Report"];
        for(const r of rows) lines.push([r.username,r.date,r.checkIn,r.checkOut,r.totalSpanText,r.networkAwayText,r.actualOfficeTimeText,r.status,r.checkInIp,r.checkOutIp,r.report].map(esc).join(","));
        return text(lines.join("\r\n"),"text/csv; charset=utf-8");
      }

      if(method==="GET" && path==="/api/admin/attendance/export"){
        const raw=(await db.prepare("SELECT * FROM AttendanceRecords ORDER BY Id DESC LIMIT 5000").all()).results;
        const rows=await enrichAttendanceRows(db,raw);
        const esc=v=>`"${String(v??"").replaceAll('"','""')}"`;
        const lines=["Username,Date,CheckIn,CheckOut,TotalSpan,NetworkAway,ActualOfficeTime,Status,CheckInIp,CheckOutIp,Report"];
        for(const r of rows) lines.push([r.username,r.date,r.checkIn,r.checkOut,r.totalSpanText,r.networkAwayText,r.actualOfficeTimeText,r.status,r.checkInIp,r.checkOutIp,r.report].map(esc).join(","));
        return text(lines.join("\r\n"),"text/csv; charset=utf-8");
      }

      if(method==="POST" && path==="/api/admin/leave/action"){
        const b=await bodyJson(request); const id=Number(pick(b,"RequestId","requestId")||0); const action=String(pick(b,"Action","action")||""); if(!id)return json({success:false,message:"Request id required."},400); const status=/approve/i.test(action)?"Approved":/reject/i.test(action)?"Rejected":action; await db.prepare("UPDATE LeaveRequests SET Status=?,FinalRemarks=? WHERE Id=?").bind(status,`${status} by management`,id).run(); return json({success:true,message:`Leave ${status}.`});
      }

      if(method==="POST" && path==="/api/admin/shift/action"){
        const b=await bodyJson(request); const id=Number(pick(b,"ShiftId","shiftId","id")||0); const action=String(pick(b,"Action","action")||"");
        const status=/approve/i.test(action)?"Approved":/(reject|deny)/i.test(action)?"Denied":action;
        const shift=await db.prepare("SELECT * FROM ShiftRecords WHERE Id=? LIMIT 1").bind(id).first();
        if(!shift)return json({success:false,message:"Shift request not found."},404);
        await db.prepare("UPDATE ShiftRecords SET Status=?,FinalRemarks=? WHERE Id=?").bind(status,`${status} by management`,id).run();
        await db.prepare("INSERT INTO NotesNotifications (Title,Content,AuthorRole,TargetType,TargetValue,CreatedAt) VALUES (?,?,?,?,?,?)")
          .bind(status==="Approved"?"Shift Approved":"Shift Request Denied",`Your shift request has been ${status.toLowerCase()}.`,"Management","Individual",shift.Username,nowIso()).run();
        return json({success:true,message:`Shift ${status}.`});
      }

      if(method==="POST" && path==="/api/admin/notes/create"){
        const b=await bodyJson(request); const title=String(pick(b,"Title","title")||"").trim(); const content=String(pick(b,"Content","content")||"").trim(); if(!title||!content)return json({success:false,message:"Title and content are required."},400);
        await db.prepare("INSERT INTO NotesNotifications (Title,Content,AuthorRole,TargetType,TargetValue,CreatedAt) VALUES (?,?,?,?,?,?)").bind(title,content,String(pick(b,"AuthorRole","authorRole")||"Management"),String(pick(b,"TargetType","targetType")||"All"),String(pick(b,"TargetValue","targetValue")||"All"),nowIso()).run(); return json({success:true,message:"Announcement published successfully."});
      }

      m=path.match(/^\/api\/admin\/notes\/delete\/(\d+)$/);
      if(method==="DELETE" && m){ await db.prepare("DELETE FROM NotesNotifications WHERE Id=?").bind(Number(m[1])).run(); return json({success:true,message:"Announcement deleted."}); }

      m=path.match(/^\/api\/notes\/feed\/([^/]+)$/);
      if(method==="GET" && m){ const username=decodeURIComponent(m[1]).toLowerCase(); const team=(url.searchParams.get("team")||"").toLowerCase(); const rows=(await db.prepare("SELECT * FROM NotesNotifications ORDER BY Id DESC LIMIT 100").all()).results.filter(r=>{const t=(r.TargetType||"All").toLowerCase(),v=(r.TargetValue||"All").toLowerCase(); return t==="all"||(t==="individual"&&v===username)||(t==="team"&&v===team);}); return json(rows.map(r=>({id:r.Id,title:r.Title,content:r.Content,authorRole:r.AuthorRole,targetType:r.TargetType,targetValue:r.TargetValue,createdAt:r.CreatedAt}))); }

      if(method==="GET" && path==="/api/admin/network-disconnects"){ const rows=(await db.prepare("SELECT * FROM NetworkDisconnectLogs ORDER BY Id DESC LIMIT 500").all()).results; return json(rows); }

      return json({ success:false, message:`Route not found: ${method} ${path}` }, 404);
    } catch (error) {
      return json({ success:false, message:error?.message || String(error), route:path }, 500);
    }
  }
};
