CREATE TABLE IF NOT EXISTS AdminSessions (
  Token TEXT PRIMARY KEY,
  UserId INTEGER NOT NULL,
  Username TEXT NOT NULL,
  Role TEXT NOT NULL,
  CreatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ShiftRecords (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  Username TEXT NOT NULL,
  ShiftType TEXT,
  CustomTiming TEXT,
  RequestedAt TEXT NOT NULL,
  Status TEXT NOT NULL DEFAULT 'Pending',
  FinalRemarks TEXT
);

CREATE TABLE IF NOT EXISTS LeaveRequests (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  Username TEXT NOT NULL,
  LeaveType TEXT,
  Reason TEXT,
  LeaveDate TEXT,
  RequestedAt TEXT NOT NULL,
  Status TEXT NOT NULL DEFAULT 'Pending',
  SupervisorSignature TEXT,
  FinalRemarks TEXT
);

CREATE TABLE IF NOT EXISTS NotesNotifications (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  Title TEXT NOT NULL,
  Content TEXT NOT NULL,
  AuthorRole TEXT,
  TargetType TEXT NOT NULL DEFAULT 'All',
  TargetValue TEXT NOT NULL DEFAULT 'All',
  CreatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS VisitorRecords (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  FullName TEXT NOT NULL,
  ContactNumber TEXT,
  PhoneOrCnic TEXT,
  Purpose TEXT,
  WhomToMeet TEXT,
  InterestedCountry TEXT,
  InterestedProgram TEXT,
  CounsellorName TEXT,
  LastQualification TEXT,
  CgpaOrPercentage TEXT,
  RegisteredBy TEXT,
  CheckInTime TEXT NOT NULL,
  CheckOutTime TEXT,
  Status TEXT NOT NULL DEFAULT 'Inside'
);

CREATE TABLE IF NOT EXISTS ItalyConsentForms (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  ClientFullName TEXT NOT NULL,
  FamilyName TEXT,
  Gender TEXT,
  DomicileCity TEXT,
  CnicNumber TEXT,
  PhoneNumber TEXT,
  PassportNumber TEXT,
  FullAddress TEXT,
  QualificationDetails TEXT,
  PolicyVariant TEXT,
  TotalPackageFee INTEGER,
  CounselorName TEXT,
  RepresentativeSignature TEXT,
  CreatedAt TEXT NOT NULL,
  Status TEXT NOT NULL DEFAULT 'Issued'
);

CREATE INDEX IF NOT EXISTS IX_AttendanceRecords_Username_Active ON AttendanceRecords(Username, IsActive);
CREATE INDEX IF NOT EXISTS IX_Notes_Target ON NotesNotifications(TargetType, TargetValue);
CREATE INDEX IF NOT EXISTS IX_Leave_Username ON LeaveRequests(Username);
CREATE INDEX IF NOT EXISTS IX_Shift_Username ON ShiftRecords(Username);
