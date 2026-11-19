function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
    }
  });
}

function nowIso() {
  return new Date().toISOString();
}

function createSessionId() {
  return crypto.randomUUID();
}

async function sha256(text) {
  const data = new TextEncoder().encode(text ?? "");
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    const db = env.attendance_db;

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
        }
      });
    }

    try {

      // =========================================================
      // ROOT
      // =========================================================
      if (method === "GET" && path === "/") {
        return json({
          success: true,
          message: "Attendance backend is running on Cloudflare Workers"
        });
      }

      // =========================================================
      // CHECK NETWORK
      // =========================================================
      if (method === "GET" && path === "/api/attendance/check-network") {
        const clientIp =
          request.headers.get("CF-Connecting-IP") ??
          request.headers.get("X-Forwarded-For") ??
          "unknown";

        return json({
          allowed: true,
          clientIp,
          message: "Network verified successfully."
        });
      }

      if (method === "POST" && path === "/api/attendance/check-network") {
        const clientIp =
          request.headers.get("CF-Connecting-IP") ??
          request.headers.get("X-Forwarded-For") ??
          "unknown";

        return json({
          allowed: true,
          clientIp,
          message: "Network verified successfully."
        });
      }

      // =========================================================
      // LOGIN
      // =========================================================
      if (method === "POST" && path === "/api/attendance/login") {
        const body = await readBody(request);

        const username = body.Username ?? body.username ?? "";
        const password = body.Password ?? body.password ?? "";
        const deviceId = body.DeviceId ?? body.deviceId ?? "";

        if (!username || !password) {
          return json({
            success: false,
            message: "Username and password are required."
          }, 400);
        }

        const user = await db
          .prepare(`
            SELECT *
            FROM AppUsers
            WHERE lower(Username) = lower(?)
            LIMIT 1
          `)
          .bind(username)
          .first();

        if (!user) {
          return json({
            success: false,
            message: "Invalid username or password."
          }, 401);
        }

        const passwordHash = await sha256(password);

        if (user.PasswordHash && user.PasswordHash !== passwordHash) {
          return json({
            success: false,
            message: "Invalid username or password."
          }, 401);
        }

        const existing = await db
          .prepare(`
            SELECT *
            FROM AttendanceRecords
            WHERE Username = ?
              AND IsActive = 1
            ORDER BY Id DESC
            LIMIT 1
          `)
          .bind(user.Username)
          .first();

        let sessionId;
        let alreadyCheckedIn = false;
        let checkInTime;

        const clientIp =
          request.headers.get("CF-Connecting-IP") ??
          "unknown";

        if (existing) {
          sessionId = existing.SessionId;
          alreadyCheckedIn = true;
          checkInTime = existing.CheckIn;
        } else {
          sessionId = createSessionId();
          checkInTime = nowIso();

          await db
            .prepare(`
              INSERT INTO AttendanceRecords
              (
                SessionId,
                UserId,
                Username,
                CheckIn,
                CheckInIp,
                IsActive
              )
              VALUES (?, ?, ?, ?, ?, 1)
            `)
            .bind(
              sessionId,
              user.Id,
              user.Username,
              checkInTime,
              clientIp
            )
            .run();
        }

        if (deviceId) {
          const binding = await db
            .prepare(`
              SELECT Id
              FROM DeviceBindings
              WHERE UserId = ?
              LIMIT 1
            `)
            .bind(user.Id)
            .first();

          if (!binding) {
            await db
              .prepare(`
                INSERT INTO DeviceBindings
                (
                  UserId,
                  Username,
                  DeviceId,
                  IpAddress
                )
                VALUES (?, ?, ?, ?)
              `)
              .bind(
                user.Id,
                user.Username,
                deviceId,
                clientIp
              )
              .run();
          }
        }

        const role = user.Role ?? "Employee";

        const managementRoles = [
          "Owner",
          "Country Actor",
          "Head of Marketing",
          "Head of Processing"
        ];

        const isManagement = managementRoles
          .map(x => x.toLowerCase())
          .includes(role.toLowerCase());

        const isReception =
          role.toLowerCase() === "receptionist";

        let adminToken = null;

        if (isManagement) {
          adminToken = crypto.randomUUID();

          await db
            .prepare(`
              INSERT INTO AdminSessions
              (Token, UserId, Username, Role, CreatedAt)
              VALUES (?, ?, ?, ?, ?)
            `)
            .bind(
              adminToken,
              user.Id,
              user.Username,
              role,
              nowIso()
            )
            .run();
        }

        return json({
          success: true,
          sessionId,
          userName: user.Username,
          username: user.Username,
          fullName: user.FullName ?? user.Username,
          role,
          team: user.Team ?? "",
          isManagement,
          isReception,
          adminToken,
          allowMobile: Boolean(user.AllowMobile),
          allowWeb: Boolean(user.AllowWeb),
          hasCctvAccess: Boolean(user.HasCctvAccess),
          alreadyCheckedIn,
          checkInTime
        });
      }

      // =========================================================
      // VERIFY CHECKOUT
      // =========================================================
      if (
        method === "POST" &&
        path === "/api/attendance/verify-checkout"
      ) {
        const body = await readBody(request);

        const sessionId =
          body.SessionId ??
          body.sessionId ??
          "";

        const record = await db
          .prepare(`
            SELECT *
            FROM AttendanceRecords
            WHERE SessionId = ?
            LIMIT 1
          `)
          .bind(sessionId)
          .first();

        if (!record || !record.IsActive) {
          return json({
            eligible: false,
            message: "No active attendance session found."
          });
        }

        return json({
          eligible: true,
          message: "Checkout allowed."
        });
      }

      // =========================================================
      // SUBMIT REPORT + CHECKOUT
      // =========================================================
      if (
        method === "POST" &&
        path === "/api/attendance/submit-report"
      ) {
        const body = await readBody(request);

        const sessionId =
          body.SessionId ??
          body.sessionId ??
          "";

        const report =
          body.Report ??
          body.report ??
          "";

        if (!sessionId) {
          return json({
            success: false,
            message: "SessionId is required."
          }, 400);
        }

        const record = await db
          .prepare(`
            SELECT *
            FROM AttendanceRecords
            WHERE SessionId = ?
            LIMIT 1
          `)
          .bind(sessionId)
          .first();

        if (!record || !record.IsActive) {
          return json({
            success: false,
            message: "Attendance session is already closed or invalid."
          }, 400);
        }

        const clientIp =
          request.headers.get("CF-Connecting-IP") ??
          "unknown";

        await db
          .prepare(`
            UPDATE AttendanceRecords
            SET
              CheckOut = ?,
              CheckOutIp = ?,
              Report = ?,
              IsActive = 0
            WHERE SessionId = ?
          `)
          .bind(
            nowIso(),
            clientIp,
            report,
            sessionId
          )
          .run();

        return json({
          success: true,
          message: "Report submitted and checkout completed."
        });
      }

      // =========================================================
      // NETWORK DISCONNECTED
      // =========================================================
      if (
        method === "POST" &&
        path === "/api/attendance/network-disconnected"
      ) {
        const body = await readBody(request);

        const sessionId =
          body.SessionId ??
          body.sessionId ??
          "";

        const username =
          body.Username ??
          body.username ??
          "";

        const deviceId =
          body.DeviceId ??
          body.deviceId ??
          "";

        const userId =
          body.UserId ??
          body.userId ??
          null;

        const activeLog = await db
          .prepare(`
            SELECT Id
            FROM NetworkDisconnectLogs
            WHERE SessionId = ?
              AND ReconnectedAt IS NULL
            ORDER BY Id DESC
            LIMIT 1
          `)
          .bind(sessionId)
          .first();

        if (!activeLog) {
          await db
            .prepare(`
              INSERT INTO NetworkDisconnectLogs
              (
                SessionId,
                UserId,
                Username,
                DisconnectedAt,
                DurationSeconds,
                DeviceId,
                LastKnownIp
              )
              VALUES (?, ?, ?, ?, 0, ?, ?)
            `)
            .bind(
              sessionId,
              userId,
              username,
              nowIso(),
              deviceId,
              request.headers.get("CF-Connecting-IP") ?? "unknown"
            )
            .run();
        }

        return json({
          success: true,
          message: "Network disconnection recorded."
        });
      }

      // =========================================================
      // NETWORK RECONNECTED
      // =========================================================
      if (
        method === "POST" &&
        path === "/api/attendance/network-reconnected"
      ) {
        const body = await readBody(request);

        const sessionId =
          body.SessionId ??
          body.sessionId ??
          "";

        const log = await db
          .prepare(`
            SELECT *
            FROM NetworkDisconnectLogs
            WHERE SessionId = ?
              AND ReconnectedAt IS NULL
            ORDER BY Id DESC
            LIMIT 1
          `)
          .bind(sessionId)
          .first();

        if (!log) {
          return json({
            success: true,
            message: "No open disconnection record found."
          });
        }

        const reconnectedAt = nowIso();

        const disconnectedTime =
          new Date(log.DisconnectedAt).getTime();

        const reconnectedTime =
          new Date(reconnectedAt).getTime();

        const durationSeconds = Math.max(
          0,
          Math.floor(
            (reconnectedTime - disconnectedTime) / 1000
          )
        );

        await db
          .prepare(`
            UPDATE NetworkDisconnectLogs
            SET
              ReconnectedAt = ?,
              DurationSeconds = ?
            WHERE Id = ?
          `)
          .bind(
            reconnectedAt,
            durationSeconds,
            log.Id
          )
          .run();

        return json({
          success: true,
          durationSeconds,
          message: "Network reconnection recorded."
        });
      }

      // =========================================================
      // ACTIVE SESSION
      // =========================================================
      if (
        method === "GET" &&
        path === "/api/attendance/active-session"
      ) {
        const username =
          url.searchParams.get("username") ?? "";

        const record = await db
          .prepare(`
            SELECT *
            FROM AttendanceRecords
            WHERE Username = ?
              AND IsActive = 1
            ORDER BY Id DESC
            LIMIT 1
          `)
          .bind(username)
          .first();

        return json({
          success: true,
          active: Boolean(record),
          record
        });
      }

      // =========================================================
      // ADMIN SESSION
      // =========================================================
      if (
        method === "GET" &&
        path === "/api/admin/session"
      ) {
        const auth = request.headers.get("Authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "").trim();

        if (!token) {
          return json({
            success: false,
            message: "Admin session required."
          }, 401);
        }

        const session = await db
          .prepare(`
            SELECT *
            FROM AdminSessions
            WHERE Token = ?
            LIMIT 1
          `)
          .bind(token)
          .first();

        if (!session) {
          return json({
            success: false,
            message: "Invalid admin session."
          }, 401);
        }

        return json({
          success: true,
          username: session.Username,
          role: session.Role
        });
      }

      if (
        method === "DELETE" &&
        path === "/api/admin/session"
      ) {
        const auth = request.headers.get("Authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "").trim();

        if (token) {
          await db
            .prepare(`DELETE FROM AdminSessions WHERE Token = ?`)
            .bind(token)
            .run();
        }

        return json({
          success: true
        });
      }

      // =========================================================
      // ADMIN OVERVIEW
      // =========================================================
      if (
        method === "GET" &&
        path === "/api/admin/overview"
      ) {
        return json({
          success: true,
          leaves: [],
          shifts: [],
          notes: [],
          visitors: []
        });
      }
      // =========================================================
      // ADMIN ATTENDANCE
      // =========================================================
      if (
        method === "GET" &&
        path === "/api/admin/attendance"
      ) {
        const result = await db
          .prepare(`
            SELECT *
            FROM AttendanceRecords
            ORDER BY Id DESC
            LIMIT 500
          `)
          .run();

        return json({
          success: true,
          records: result.results
        });
      }

      // =========================================================
      // ADMIN NETWORK LOGS
      // =========================================================
      if (
        method === "GET" &&
        path === "/api/admin/network-disconnects"
      ) {
        const result = await db
          .prepare(`
            SELECT *
            FROM NetworkDisconnectLogs
            ORDER BY Id DESC
            LIMIT 500
          `)
          .run();

        return json({
          success: true,
          records: result.results
        });
      }

      // =========================================================
      // ADD USER
      // =========================================================
      if (
        method === "POST" &&
        path === "/api/admin/users"
      ) {
        const body = await readBody(request);

        const username =
          body.Username ??
          body.username ??
          "";

        const fullName =
          body.FullName ??
          body.fullName ??
          "";

        const email =
          body.Email ??
          body.email ??
          "";

        const password =
          body.Password ??
          body.password ??
          "";

        const role =
          body.Role ??
          body.role ??
          "Employee";

        const team =
          body.Team ??
          body.team ??
          "";

        if (!username || !password) {
          return json({
            success: false,
            message: "Username and password are required."
          }, 400);
        }

        const exists = await db
          .prepare(`
            SELECT Id
            FROM AppUsers
            WHERE lower(Username) = lower(?)
            LIMIT 1
          `)
          .bind(username)
          .first();

        if (exists) {
          return json({
            success: false,
            message: "Username already exists."
          }, 409);
        }

        const passwordHash =
          await sha256(password);

        await db
          .prepare(`
            INSERT INTO AppUsers
            (
              Username,
              FullName,
              Email,
              PasswordHash,
              Role,
              Team,
              AllowMobile,
              AllowWeb,
              HasCctvAccess
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .bind(
            username,
            fullName,
            email,
            passwordHash,
            role,
            team,
            body.AllowMobile === false ? 0 : 1,
            body.AllowWeb === false ? 0 : 1,
            body.HasCctvAccess === true ? 1 : 0
          )
          .run();

        return json({
          success: true,
          message: "User created successfully."
        });
      }

      // =========================================================
      // GET USERS
      // =========================================================
      if (
        method === "GET" &&
        path === "/api/admin/users"
      ) {
        const result = await db
          .prepare(`
            SELECT
              Id,
              Username,
              FullName,
              Email,
              Role,
              Team,
              AllowMobile,
              AllowWeb,
              HasCctvAccess
            FROM AppUsers
            ORDER BY Id DESC
          `)
          .run();

        return json({
          success: true,
          users: result.results
        });
      }

      // =========================================================
      // CHANGE PASSWORD
      // =========================================================
      if (
        method === "POST" &&
        path === "/api/attendance/change-password"
      ) {
        const body = await readBody(request);

        const username =
          body.Username ??
          body.username ??
          "";

        const currentPassword =
          body.CurrentPassword ??
          body.currentPassword ??
          "";

        const newPassword =
          body.NewPassword ??
          body.newPassword ??
          "";

        const user = await db
          .prepare(`
            SELECT *
            FROM AppUsers
            WHERE lower(Username) = lower(?)
            LIMIT 1
          `)
          .bind(username)
          .first();

        if (!user) {
          return json({
            success: false,
            message: "User not found."
          }, 404);
        }

        const oldHash =
          await sha256(currentPassword);

        if (
          user.PasswordHash &&
          user.PasswordHash !== oldHash
        ) {
          return json({
            success: false,
            message: "Current password is incorrect."
          }, 401);
        }

        const newHash =
          await sha256(newPassword);

        await db
          .prepare(`
            UPDATE AppUsers
            SET PasswordHash = ?
            WHERE Id = ?
          `)
          .bind(newHash, user.Id)
          .run();

        return json({
          success: true,
          message: "Password changed successfully."
        });
      }

      return json({
        success: false,
        message: `Route not found: ${method} ${path}`
      }, 404);

    } catch (error) {
      return json({
        success: false,
        message: error?.message ?? String(error)
      }, 500);
    }
  }
};

