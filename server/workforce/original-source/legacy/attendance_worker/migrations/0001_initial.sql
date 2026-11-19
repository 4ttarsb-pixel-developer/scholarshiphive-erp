CREATE TABLE IF NOT EXISTS AppUsers (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Username TEXT NOT NULL UNIQUE,
    FullName TEXT,
    Email TEXT,
    PasswordHash TEXT,
    Role TEXT,
    Team TEXT,
    AllowMobile INTEGER NOT NULL DEFAULT 1,
    AllowWeb INTEGER NOT NULL DEFAULT 1,
    HasCctvAccess INTEGER NOT NULL DEFAULT 0,
    BiometricDeviceId TEXT,
    BiometricTokenHash TEXT
);

CREATE TABLE IF NOT EXISTS AttendanceRecords (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    SessionId TEXT NOT NULL UNIQUE,
    UserId INTEGER,
    Username TEXT NOT NULL,
    CheckIn TEXT,
    CheckOut TEXT,
    CheckInIp TEXT,
    CheckOutIp TEXT,
    Report TEXT,
    IsActive INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS NetworkDisconnectLogs (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    SessionId TEXT NOT NULL,
    UserId INTEGER,
    Username TEXT,
    DisconnectedAt TEXT,
    ReconnectedAt TEXT,
    DurationSeconds INTEGER NOT NULL DEFAULT 0,
    DeviceId TEXT,
    LastKnownIp TEXT
);

CREATE TABLE IF NOT EXISTS DeviceBindings (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    UserId INTEGER,
    Username TEXT,
    DeviceId TEXT,
    IpAddress TEXT
);

CREATE TABLE IF NOT EXISTS IpLogs (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Username TEXT,
    IpAddress TEXT,
    CreatedAt TEXT
);
