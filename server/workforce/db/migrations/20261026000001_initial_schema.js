'use strict';
/**
 * Initial unified schema: identity + RBAC, employees, shifts/schedules/holidays,
 * attendance (sessions, daily records, corrections, leave), attendance security
 * (network rules, device bindings, activity logs), reception/announcements
 * (preserved from the Flutter app), policies, revenue + commissions,
 * payroll (periods, records, line items, approvals, payments, adjustments),
 * salary advances + recoveries and audit logs.
 *
 * Money is NUMERIC(14,2); percentages are NUMERIC(7,3). Never floating point.
 */

exports.up = async function up(knex) {
  await knex.raw(`
  -- ============================================================
  -- IDENTITY, ROLES, PERMISSIONS
  -- ============================================================
  CREATE TABLE roles (
    id            SERIAL PRIMARY KEY,
    code          VARCHAR(40)  NOT NULL UNIQUE,
    name          VARCHAR(80)  NOT NULL,
    description   TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
  );

  CREATE TABLE permissions (
    id            SERIAL PRIMARY KEY,
    code          VARCHAR(60)  NOT NULL UNIQUE,
    description   TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
  );

  CREATE TABLE role_permissions (
    role_id       INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
  );

  CREATE TABLE departments (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(80) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX ux_departments_name ON departments (lower(name));

  -- ============================================================
  -- SHIFTS, SCHEDULES, HOLIDAYS
  -- ============================================================
  CREATE TABLE shifts (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(60) NOT NULL,
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    break_minutes   INT  NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 600),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (start_time <> end_time)
  );
  CREATE UNIQUE INDEX ux_shifts_name ON shifts (lower(name));

  CREATE TABLE employees (
    id                 SERIAL PRIMARY KEY,
    employee_code      VARCHAR(30) NOT NULL,
    full_name          VARCHAR(120) NOT NULL,
    department_id      INT REFERENCES departments(id) ON DELETE SET NULL,
    designation        VARCHAR(120),
    employment_status  VARCHAR(20) NOT NULL DEFAULT 'Active'
                       CHECK (employment_status IN ('Active','Inactive','Terminated')),
    joining_date       DATE NOT NULL,
    leaving_date       DATE,
    base_salary        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
    shift_id           INT REFERENCES shifts(id) ON DELETE SET NULL,
    is_demo            BOOLEAN NOT NULL DEFAULT FALSE,
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (leaving_date IS NULL OR leaving_date >= joining_date)
  );
  CREATE UNIQUE INDEX ux_employees_code ON employees (upper(employee_code));
  CREATE INDEX ix_employees_status ON employees (employment_status);
  CREATE INDEX ix_employees_name ON employees (lower(full_name));

  -- Login accounts. A user may be linked to at most one employee (and vice versa).
  CREATE TABLE users (
    id                    SERIAL PRIMARY KEY,
    username              VARCHAR(60)  NOT NULL,
    password_hash         TEXT,
    full_name             VARCHAR(120) NOT NULL DEFAULT '',
    email                 VARCHAR(160) NOT NULL DEFAULT '',
    attendance_role       VARCHAR(60)  NOT NULL DEFAULT 'Staff',  -- legacy Flutter role (Owner, Receptionist, Staff…)
    team                  VARCHAR(80)  NOT NULL DEFAULT '',
    allow_mobile          BOOLEAN NOT NULL DEFAULT TRUE,
    allow_web             BOOLEAN NOT NULL DEFAULT TRUE,
    has_cctv_access       BOOLEAN NOT NULL DEFAULT FALSE,
    biometric_device_id   TEXT,
    biometric_token_hash  TEXT,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    is_protected          BOOLEAN NOT NULL DEFAULT FALSE,          -- super-admin cannot be deleted
    must_change_password  BOOLEAN NOT NULL DEFAULT FALSE,
    employee_id           INT UNIQUE REFERENCES employees(id) ON DELETE SET NULL,
    legacy_source         VARCHAR(20),                             -- sqlite | d1 | localstorage
    legacy_id             TEXT,
    failed_logins         INT NOT NULL DEFAULT 0,
    locked_until          TIMESTAMPTZ,
    last_login_at         TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX ux_users_username ON users (lower(username));

  CREATE TABLE user_roles (
    user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id   INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    granted_by INT REFERENCES users(id) ON DELETE SET NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
  );

  -- Opaque session tokens (only the SHA-256 of the token is stored).
  CREATE TABLE auth_sessions (
    id           BIGSERIAL PRIMARY KEY,
    token_hash   CHAR(64) NOT NULL UNIQUE,
    user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         VARCHAR(20) NOT NULL CHECK (kind IN ('web','mobile','admin')),
    ip           TEXT,
    user_agent   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ
  );
  CREATE INDEX ix_auth_sessions_user ON auth_sessions (user_id);

  -- Employee weekly schedule. employee_id NULL = company default.
  CREATE TABLE work_schedules (
    id              SERIAL PRIMARY KEY,
    employee_id     INT REFERENCES employees(id) ON DELETE CASCADE,
    weekday         SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Sunday
    is_working_day  BOOLEAN NOT NULL,
    shift_id        INT REFERENCES shifts(id) ON DELETE SET NULL,
    effective_from  DATE NOT NULL DEFAULT DATE '2000-01-01',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX ux_work_schedules
    ON work_schedules (COALESCE(employee_id, 0), weekday, effective_from);

  CREATE TABLE holidays (
    id           SERIAL PRIMARY KEY,
    holiday_date DATE NOT NULL UNIQUE,
    name         VARCHAR(120) NOT NULL,
    is_paid      BOOLEAN NOT NULL DEFAULT TRUE,
    created_by   INT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- ============================================================
  -- POLICIES (versioned)
  -- ============================================================
  CREATE TABLE attendance_policies (
    id                               SERIAL PRIMARY KEY,
    effective_from                   DATE NOT NULL,
    timezone                         VARCHAR(60) NOT NULL DEFAULT 'Asia/Karachi',
    working_days_basis               VARCHAR(20) NOT NULL DEFAULT 'schedule'
                                     CHECK (working_days_basis IN ('schedule','fixed','calendar')),
    fixed_working_days               INT CHECK (fixed_working_days BETWEEN 1 AND 31),
    grace_minutes                    INT NOT NULL DEFAULT 10 CHECK (grace_minutes BETWEEN 0 AND 240),
    late_deduction_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
    late_rule_type                   VARCHAR(20) NOT NULL DEFAULT 'per_hour'
                                     CHECK (late_rule_type IN ('per_hour','tiered')),
    late_rate_percent                NUMERIC(7,3) NOT NULL DEFAULT 5 CHECK (late_rate_percent BETWEEN 0 AND 100),
    late_basis                       VARCHAR(10) NOT NULL DEFAULT 'daily' CHECK (late_basis IN ('daily','monthly')),
    late_rounding                    VARCHAR(20) NOT NULL DEFAULT 'started_hour'
                                     CHECK (late_rounding IN ('started_hour','exact')),
    late_tiers                       JSONB NOT NULL DEFAULT '[]'::jsonb,
    late_cap_percent                 NUMERIC(7,3) NOT NULL DEFAULT 10 CHECK (late_cap_percent BETWEEN 0 AND 100),
    severe_late_minutes              INT NOT NULL DEFAULT 60 CHECK (severe_late_minutes BETWEEN 1 AND 1440),
    severe_late_requires_review      BOOLEAN NOT NULL DEFAULT TRUE,
    early_departure_deduction_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    early_grace_minutes              INT NOT NULL DEFAULT 10 CHECK (early_grace_minutes BETWEEN 0 AND 240),
    early_rate_percent               NUMERIC(7,3) NOT NULL DEFAULT 5 CHECK (early_rate_percent BETWEEN 0 AND 100),
    absence_deduction_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
    paid_leave_days_per_month        NUMERIC(5,2) NOT NULL DEFAULT 2 CHECK (paid_leave_days_per_month BETWEEN 0 AND 31),
    block_approval_until_period_end  BOOLEAN NOT NULL DEFAULT FALSE,
    revenue_require_second_verifier  BOOLEAN NOT NULL DEFAULT FALSE,
    payroll_cutoff_day               INT CHECK (payroll_cutoff_day BETWEEN 1 AND 28),  -- NULL = calendar month
    max_manual_commission_percent    NUMERIC(7,3) NOT NULL DEFAULT 50 CHECK (max_manual_commission_percent BETWEEN 0 AND 100),
    reason                           TEXT NOT NULL,
    created_by                       INT REFERENCES users(id) ON DELETE SET NULL,
    created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (working_days_basis <> 'fixed' OR fixed_working_days IS NOT NULL)
  );
  CREATE INDEX ix_policies_effective ON attendance_policies (effective_from DESC, id DESC);

  -- ============================================================
  -- ATTENDANCE (raw sessions -> official daily records)
  -- ============================================================
  CREATE TABLE attendance_sessions (
    id              BIGSERIAL PRIMARY KEY,
    session_id      UUID NOT NULL UNIQUE,                -- the sessionId the Flutter app holds
    user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    employee_id     INT REFERENCES employees(id) ON DELETE SET NULL,
    business_date   DATE NOT NULL,                       -- shift date in business timezone
    check_in_at     TIMESTAMPTZ NOT NULL,
    check_out_at    TIMESTAMPTZ,
    check_in_ip     TEXT,
    check_out_ip    TEXT,
    device_id       TEXT,
    report          TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    closed_reason   VARCHAR(40),                         -- checkout | superseded_missing_checkout | admin_correction
    source          VARCHAR(30) NOT NULL DEFAULT 'mobile'
                    CHECK (source IN ('mobile','web','admin','import_sqlite','import_d1','demo_seed','test')),
    legacy_id       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (check_out_at IS NULL OR check_out_at >= check_in_at),
    CHECK (NOT is_active OR check_out_at IS NULL)
  );
  -- Never two open sessions for one user -> no duplicate paid days from double check-in.
  CREATE UNIQUE INDEX ux_sessions_one_active ON attendance_sessions (user_id) WHERE is_active;
  CREATE INDEX ix_sessions_employee_date ON attendance_sessions (employee_id, business_date);
  CREATE INDEX ix_sessions_user_date ON attendance_sessions (user_id, business_date);

  CREATE TABLE network_disconnect_logs (
    id               BIGSERIAL PRIMARY KEY,
    session_id       UUID NOT NULL REFERENCES attendance_sessions(session_id) ON DELETE CASCADE,
    user_id          INT REFERENCES users(id) ON DELETE SET NULL,
    disconnected_at  TIMESTAMPTZ NOT NULL,
    reconnected_at   TIMESTAMPTZ,
    duration_seconds INT NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
    device_id        TEXT,
    last_known_ip    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (reconnected_at IS NULL OR reconnected_at >= disconnected_at)
  );
  CREATE INDEX ix_disconnect_session ON network_disconnect_logs (session_id);

  CREATE TABLE leave_requests (
    id                    SERIAL PRIMARY KEY,
    employee_id           INT REFERENCES employees(id) ON DELETE CASCADE,
    user_id               INT REFERENCES users(id) ON DELETE SET NULL,
    username              VARCHAR(60),
    leave_type            VARCHAR(60) NOT NULL DEFAULT 'Leave',
    start_date            DATE NOT NULL,
    end_date              DATE NOT NULL,
    day_fraction          NUMERIC(3,2) NOT NULL DEFAULT 1 CHECK (day_fraction IN (0.5, 1)),
    reason                TEXT NOT NULL DEFAULT '',
    department            VARCHAR(80),
    status                VARCHAR(20) NOT NULL DEFAULT 'Pending'
                          CHECK (status IN ('Pending','Approved','Rejected','Cancelled')),
    pay_type              VARCHAR(10) CHECK (pay_type IN ('Paid','Unpaid')),
    employee_signature    TEXT,
    supervisor_signature  TEXT,
    decision_note         TEXT,
    decided_by            INT REFERENCES users(id) ON DELETE SET NULL,
    decided_at            TIMESTAMPTZ,
    source                VARCHAR(30) NOT NULL DEFAULT 'web',
    legacy_id             TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date),
    CHECK (status <> 'Approved' OR pay_type IS NOT NULL),
    CHECK (day_fraction = 1 OR start_date = end_date)
  );
  CREATE INDEX ix_leaves_employee_dates ON leave_requests (employee_id, start_date, end_date);
  CREATE INDEX ix_leaves_status ON leave_requests (status);

  -- One official row per employee per day (prevents duplicate paid days).
  CREATE TABLE attendance_records (
    id                       BIGSERIAL PRIMARY KEY,
    employee_id              INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    attendance_date          DATE NOT NULL,
    shift_id                 INT REFERENCES shifts(id) ON DELETE SET NULL,
    scheduled_start          TIMESTAMPTZ,
    scheduled_end            TIMESTAMPTZ,
    actual_check_in          TIMESTAMPTZ,
    actual_check_out         TIMESTAMPTZ,
    worked_seconds           INT NOT NULL DEFAULT 0 CHECK (worked_seconds >= 0),
    away_seconds             INT NOT NULL DEFAULT 0 CHECK (away_seconds >= 0),
    late_minutes             INT NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
    early_departure_minutes  INT NOT NULL DEFAULT 0 CHECK (early_departure_minutes >= 0),
    status                   VARCHAR(20) NOT NULL CHECK (status IN (
                               'Present','Late','Absent','PaidLeave','UnpaidLeave','PendingLeave',
                               'MissingCheckIn','MissingCheckOut','Holiday','WeeklyOff','NotEmployed','Upcoming')),
    leave_request_id         INT REFERENCES leave_requests(id) ON DELETE SET NULL,
    leave_fraction           NUMERIC(3,2) NOT NULL DEFAULT 0,
    is_overridden            BOOLEAN NOT NULL DEFAULT FALSE,
    correction_id            INT,
    correction_reason        TEXT,
    source                   VARCHAR(30) NOT NULL DEFAULT 'system',  -- system | admin_correction
    reviewed                 BOOLEAN NOT NULL DEFAULT FALSE,
    review_note              TEXT,
    reviewed_by              INT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at              TIMESTAMPTZ,
    computed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (employee_id, attendance_date)
  );
  CREATE INDEX ix_att_records_date ON attendance_records (attendance_date);

  CREATE TABLE attendance_corrections (
    id                   SERIAL PRIMARY KEY,
    employee_id          INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    attendance_date      DATE NOT NULL,
    requested_status     VARCHAR(20) NOT NULL CHECK (requested_status IN
                          ('Present','Absent','PaidLeave','UnpaidLeave','Holiday','WeeklyOff','Recompute')),
    requested_check_in   TIMESTAMPTZ,
    requested_check_out  TIMESTAMPTZ,
    reason               TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
    status               VARCHAR(20) NOT NULL DEFAULT 'Pending'
                         CHECK (status IN ('Pending','Approved','Rejected','Superseded')),
    requested_by         INT REFERENCES users(id) ON DELETE SET NULL,
    decided_by           INT REFERENCES users(id) ON DELETE SET NULL,
    decided_at           TIMESTAMPTZ,
    decision_note        TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (requested_check_out IS NULL OR requested_check_in IS NULL OR requested_check_out > requested_check_in)
  );
  CREATE INDEX ix_corrections_emp_date ON attendance_corrections (employee_id, attendance_date);
  -- Only one pending correction per employee-day.
  CREATE UNIQUE INDEX ux_corrections_pending ON attendance_corrections (employee_id, attendance_date) WHERE status = 'Pending';
  ALTER TABLE attendance_records
    ADD CONSTRAINT fk_att_records_correction FOREIGN KEY (correction_id) REFERENCES attendance_corrections(id) ON DELETE SET NULL;

  CREATE TABLE shift_requests (
    id              SERIAL PRIMARY KEY,
    user_id         INT REFERENCES users(id) ON DELETE SET NULL,
    employee_id     INT REFERENCES employees(id) ON DELETE CASCADE,
    username        VARCHAR(60) NOT NULL,
    shift_type      VARCHAR(60),
    custom_timing   VARCHAR(80),
    status          VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Denied')),
    final_remarks   TEXT,
    decided_by      INT REFERENCES users(id) ON DELETE SET NULL,
    decided_at      TIMESTAMPTZ,
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    legacy_id       TEXT
  );

  -- ============================================================
  -- ATTENDANCE SECURITY (preserved)
  -- ============================================================
  CREATE TABLE office_network_rules (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(80) NOT NULL,
    rule        VARCHAR(80) NOT NULL,     -- normalised CIDR e.g. 154.192.1.10/32, 2001:...:/64
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_by  INT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX ux_network_rules ON office_network_rules (lower(name), lower(rule));

  CREATE TABLE device_bindings (
    id             SERIAL PRIMARY KEY,
    user_id        INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    device_id      TEXT NOT NULL UNIQUE,
    ip_address     TEXT,
    registered_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE activity_logs (               -- replaces legacy IpLogs
    id          BIGSERIAL PRIMARY KEY,
    username    VARCHAR(60),
    user_id     INT REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(60) NOT NULL,
    allowed     BOOLEAN NOT NULL DEFAULT TRUE,
    message     TEXT,
    ip_address  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX ix_activity_logs_created ON activity_logs (created_at DESC);

  CREATE TABLE notes_notifications (
    id           SERIAL PRIMARY KEY,
    title        VARCHAR(200) NOT NULL,
    content      TEXT NOT NULL,
    author_role  VARCHAR(60),
    target_type  VARCHAR(20) NOT NULL DEFAULT 'All' CHECK (target_type IN ('All','Team','Individual')),
    target_value VARCHAR(80) NOT NULL DEFAULT 'All',
    created_by   INT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE visitor_records (
    id                  SERIAL PRIMARY KEY,
    full_name           VARCHAR(160) NOT NULL,
    contact_number      VARCHAR(60),
    phone_or_cnic       VARCHAR(60),
    email_address       VARCHAR(160),
    purpose             TEXT,
    whom_to_meet        VARCHAR(120),
    interested_country  VARCHAR(80),
    interested_program  VARCHAR(120),
    counsellor_name     VARCHAR(120),
    last_qualification  VARCHAR(120),
    cgpa_or_percentage  VARCHAR(40),
    registered_by       VARCHAR(60),
    check_in_time       TIMESTAMPTZ NOT NULL DEFAULT now(),
    check_out_time      TIMESTAMPTZ,
    status              VARCHAR(30) NOT NULL DEFAULT 'Inside',
    legacy_id           TEXT
  );

  CREATE TABLE consent_forms (
    id                        SERIAL PRIMARY KEY,
    client_full_name          VARCHAR(160) NOT NULL,
    family_name               VARCHAR(120),
    gender                    VARCHAR(20),
    domicile_city             VARCHAR(80),
    cnic_number               VARCHAR(40),
    phone_number              VARCHAR(40),
    passport_number           VARCHAR(40),
    full_address              TEXT,
    qualification_details     TEXT,
    policy_variant            VARCHAR(80),
    total_package_fee         NUMERIC(14,2),
    counselor_name            VARCHAR(120),
    representative_signature  TEXT,
    status                    VARCHAR(40) NOT NULL DEFAULT 'Issued',
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    legacy_id                 TEXT
  );

  -- ============================================================
  -- COMMISSION SETTINGS + REVENUE
  -- ============================================================
  CREATE TABLE commission_settings (
    employee_id         INT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
    fixed_rate_percent  NUMERIC(7,3) NOT NULL DEFAULT 0 CHECK (fixed_rate_percent BETWEEN 0 AND 100),
    updated_by          INT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE commission_rate_history (
    id            BIGSERIAL PRIMARY KEY,
    employee_id   INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    old_rate      NUMERIC(7,3),
    new_rate      NUMERIC(7,3) NOT NULL,
    reason        TEXT,
    changed_by    INT REFERENCES users(id) ON DELETE SET NULL,
    changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE revenue_sales (
    id                    BIGSERIAL PRIMARY KEY,
    sale_reference        VARCHAR(80) NOT NULL,
    employee_id           INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    sale_date             DATE NOT NULL,
    accounting_month      DATE NOT NULL CHECK (extract(day from accounting_month) = 1),
    sale_amount           NUMERIC(14,2) NOT NULL CHECK (sale_amount > 0),
    units                 INT CHECK (units IS NULL OR units > 0),
    commission_method     VARCHAR(20) NOT NULL CHECK (commission_method IN ('FIXED_EMPLOYEE','MANUAL_PERCENT')),
    applied_rate_percent  NUMERIC(7,3) NOT NULL CHECK (applied_rate_percent BETWEEN 0 AND 100),
    commission_amount     NUMERIC(14,2) NOT NULL CHECK (commission_amount >= 0),
    status                VARCHAR(20) NOT NULL DEFAULT 'Pending'
                          CHECK (status IN ('Pending','Verified','Rejected','Cancelled')),
    is_demo               BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at_entry     BOOLEAN NOT NULL DEFAULT FALSE,
    notes                 TEXT,
    status_reason         TEXT,
    created_by            INT REFERENCES users(id) ON DELETE SET NULL,
    verified_by           INT REFERENCES users(id) ON DELETE SET NULL,
    verified_at           TIMESTAMPTZ,
    version               INT NOT NULL DEFAULT 1,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- commission must equal amount x rate / 100 (rounded half-up to 2dp)
    CHECK (commission_amount = round(sale_amount * applied_rate_percent / 100, 2))
  );
  -- Unique sale references (case-insensitive) => the same sale can never be imported/counted twice.
  CREATE UNIQUE INDEX ux_revenue_reference ON revenue_sales (upper(sale_reference));
  CREATE INDEX ix_revenue_emp_month ON revenue_sales (employee_id, accounting_month, status);

  -- Commission ledger: exactly one entry per sale.
  CREATE TABLE commission_entries (
    id                 BIGSERIAL PRIMARY KEY,
    sale_id            BIGINT NOT NULL UNIQUE REFERENCES revenue_sales(id) ON DELETE CASCADE,
    employee_id        INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    accounting_month   DATE NOT NULL,
    sale_amount        NUMERIC(14,2) NOT NULL,
    rate_percent       NUMERIC(7,3) NOT NULL,
    amount             NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    status             VARCHAR(20) NOT NULL DEFAULT 'Earned' CHECK (status IN ('Earned','Reversed')),
    payroll_record_id  BIGINT,   -- set when locked into an approved payroll
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX ix_commission_emp_month ON commission_entries (employee_id, accounting_month, status);

  -- ============================================================
  -- PAYROLL
  -- ============================================================
  CREATE TABLE payroll_periods (
    id            SERIAL PRIMARY KEY,
    period_month  DATE NOT NULL UNIQUE CHECK (extract(day from period_month) = 1),
    start_date    DATE NOT NULL,
    end_date      DATE NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Closed')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date)
  );

  CREATE TABLE payroll_records (
    id                     BIGSERIAL PRIMARY KEY,
    period_id              INT NOT NULL REFERENCES payroll_periods(id) ON DELETE RESTRICT,
    employee_id            INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    status                 VARCHAR(20) NOT NULL DEFAULT 'Draft'
                           CHECK (status IN ('Draft','UnderReview','Approved','Rejected','Paid')),
    base_salary            NUMERIC(14,2) NOT NULL DEFAULT 0,
    scheduled_days         NUMERIC(6,2) NOT NULL DEFAULT 0,
    divisor_days           NUMERIC(6,2) NOT NULL DEFAULT 0,
    daily_rate             NUMERIC(14,4) NOT NULL DEFAULT 0,
    present_days           NUMERIC(6,2) NOT NULL DEFAULT 0,
    absent_days            NUMERIC(6,2) NOT NULL DEFAULT 0,
    paid_leave_days        NUMERIC(6,2) NOT NULL DEFAULT 0,
    unpaid_leave_days      NUMERIC(6,2) NOT NULL DEFAULT 0,
    late_minutes           INT NOT NULL DEFAULT 0,
    early_minutes          INT NOT NULL DEFAULT 0,
    revenue_total          NUMERIC(14,2) NOT NULL DEFAULT 0,
    commission_total       NUMERIC(14,2) NOT NULL DEFAULT 0,
    bonus_total            NUMERIC(14,2) NOT NULL DEFAULT 0,
    gross_earnings         NUMERIC(14,2) NOT NULL DEFAULT 0,
    attendance_deductions  NUMERIC(14,2) NOT NULL DEFAULT 0,
    unpaid_leave_deduction NUMERIC(14,2) NOT NULL DEFAULT 0,
    advance_recovery       NUMERIC(14,2) NOT NULL DEFAULT 0,
    other_deductions       NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_deductions       NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_salary             NUMERIC(14,2) NOT NULL DEFAULT 0,
    blockers               JSONB NOT NULL DEFAULT '[]'::jsonb,
    warnings               JSONB NOT NULL DEFAULT '[]'::jsonb,
    policy_id              INT REFERENCES attendance_policies(id) ON DELETE SET NULL,
    snapshot               JSONB,
    calculated_at          TIMESTAMPTZ,
    submitted_by           INT REFERENCES users(id) ON DELETE SET NULL,
    submitted_at           TIMESTAMPTZ,
    approved_by            INT REFERENCES users(id) ON DELETE SET NULL,
    approved_at            TIMESTAMPTZ,
    rejected_by            INT REFERENCES users(id) ON DELETE SET NULL,
    rejected_at            TIMESTAMPTZ,
    rejection_reason       TEXT,
    paid_at                TIMESTAMPTZ,
    version                INT NOT NULL DEFAULT 1,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (period_id, employee_id),
    CHECK (status NOT IN ('Approved','Paid') OR (snapshot IS NOT NULL AND approved_at IS NOT NULL))
  );
  CREATE INDEX ix_payroll_status ON payroll_records (status);
  ALTER TABLE commission_entries
    ADD CONSTRAINT fk_commission_payroll FOREIGN KEY (payroll_record_id) REFERENCES payroll_records(id) ON DELETE SET NULL;

  CREATE TABLE payroll_line_items (
    id                 BIGSERIAL PRIMARY KEY,
    payroll_record_id  BIGINT NOT NULL REFERENCES payroll_records(id) ON DELETE CASCADE,
    line_type          VARCHAR(12) NOT NULL CHECK (line_type IN ('EARNING','DEDUCTION','INFO')),
    code               VARCHAR(30) NOT NULL,
    description        TEXT NOT NULL,
    quantity           NUMERIC(14,4),
    rate               NUMERIC(14,4),
    amount             NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    source_table       VARCHAR(40),
    source_id          TEXT,
    sort_order         INT NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX ix_line_items_record ON payroll_line_items (payroll_record_id);

  CREATE TABLE payroll_approvals (
    id                 BIGSERIAL PRIMARY KEY,
    payroll_record_id  BIGINT NOT NULL REFERENCES payroll_records(id) ON DELETE CASCADE,
    action             VARCHAR(20) NOT NULL CHECK (action IN ('SUBMIT','APPROVE','REJECT','REOPEN','MARK_PAID')),
    from_status        VARCHAR(20),
    to_status          VARCHAR(20) NOT NULL,
    actor_id           INT REFERENCES users(id) ON DELETE SET NULL,
    note               TEXT,
    net_salary         NUMERIC(14,2),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  -- An approval can only ever be recorded once per payroll record.
  CREATE UNIQUE INDEX ux_payroll_single_approve ON payroll_approvals (payroll_record_id) WHERE action = 'APPROVE';
  CREATE UNIQUE INDEX ux_payroll_single_paid ON payroll_approvals (payroll_record_id) WHERE action = 'MARK_PAID';

  CREATE TABLE payment_records (
    id                 BIGSERIAL PRIMARY KEY,
    payroll_record_id  BIGINT NOT NULL UNIQUE REFERENCES payroll_records(id) ON DELETE RESTRICT,
    amount             NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    payment_date       DATE NOT NULL,
    payment_method     VARCHAR(30) NOT NULL CHECK (payment_method IN ('Bank Transfer','Cash','Cheque','Mobile Wallet','Other')),
    payment_reference  VARCHAR(120) NOT NULL CHECK (length(trim(payment_reference)) >= 3),
    remarks            TEXT,
    paid_by            INT REFERENCES users(id) ON DELETE SET NULL,
    idempotency_key    VARCHAR(100) UNIQUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Bonuses / other authorised deductions / corrections to approved payroll.
  CREATE TABLE payroll_adjustments (
    id                SERIAL PRIMARY KEY,
    employee_id       INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    period_month      DATE NOT NULL CHECK (extract(day from period_month) = 1),
    adjustment_type   VARCHAR(12) NOT NULL CHECK (adjustment_type IN ('EARNING','DEDUCTION')),
    category          VARCHAR(30) NOT NULL DEFAULT 'BONUS'
                      CHECK (category IN ('BONUS','OTHER_DEDUCTION','COMMISSION_REVERSAL','COMMISSION_CORRECTION','ATTENDANCE_CORRECTION','OTHER')),
    amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    reason            TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
    status            VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Cancelled')),
    source_ref        TEXT,
    created_by        INT REFERENCES users(id) ON DELETE SET NULL,
    decided_by        INT REFERENCES users(id) ON DELETE SET NULL,
    decided_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX ix_adjustments_emp_month ON payroll_adjustments (employee_id, period_month, status);
  CREATE UNIQUE INDEX ux_adjustments_source ON payroll_adjustments (source_ref) WHERE source_ref IS NOT NULL AND status <> 'Cancelled';

  -- ============================================================
  -- SALARY ADVANCES
  -- ============================================================
  CREATE TABLE salary_advances (
    id                    SERIAL PRIMARY KEY,
    employee_id           INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    amount                NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    monthly_recovery      NUMERIC(14,2) NOT NULL CHECK (monthly_recovery > 0),
    remaining_balance     NUMERIC(14,2) NOT NULL CHECK (remaining_balance >= 0),
    advance_date          DATE NOT NULL,
    recovery_start_month  DATE NOT NULL CHECK (extract(day from recovery_start_month) = 1),
    status                VARCHAR(20) NOT NULL DEFAULT 'Pending'
                          CHECK (status IN ('Pending','Active','Settled','Rejected','Cancelled')),
    reason                TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
    is_demo               BOOLEAN NOT NULL DEFAULT FALSE,
    created_by            INT REFERENCES users(id) ON DELETE SET NULL,
    approved_by           INT REFERENCES users(id) ON DELETE SET NULL,
    approved_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (monthly_recovery <= amount),
    CHECK (remaining_balance <= amount)
  );
  CREATE INDEX ix_advances_emp ON salary_advances (employee_id, status);

  CREATE TABLE advance_recoveries (
    id                 BIGSERIAL PRIMARY KEY,
    advance_id         INT NOT NULL REFERENCES salary_advances(id) ON DELETE RESTRICT,
    payroll_record_id  BIGINT NOT NULL REFERENCES payroll_records(id) ON DELETE RESTRICT,
    amount             NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    balance_after      NUMERIC(14,2) NOT NULL CHECK (balance_after >= 0),
    recovered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (advance_id, payroll_record_id)   -- recovered exactly once per payroll
  );

  -- ============================================================
  -- AUDIT + IMPORTS
  -- ============================================================
  CREATE TABLE audit_logs (
    id           BIGSERIAL PRIMARY KEY,
    actor_id     INT REFERENCES users(id) ON DELETE SET NULL,
    actor_name   VARCHAR(120),
    action       VARCHAR(80) NOT NULL,
    entity_type  VARCHAR(60),
    entity_id    TEXT,
    detail       TEXT,
    before_data  JSONB,
    after_data   JSONB,
    ip           TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX ix_audit_created ON audit_logs (created_at DESC);
  CREATE INDEX ix_audit_entity ON audit_logs (entity_type, entity_id);

  CREATE TABLE import_batches (
    id            SERIAL PRIMARY KEY,
    source        VARCHAR(30) NOT NULL,
    source_hash   CHAR(64) NOT NULL,
    summary       JSONB NOT NULL DEFAULT '{}'::jsonb,
    imported_by   INT REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, source_hash)          -- the same export file can never be imported twice
  );

  CREATE TABLE idempotency_keys (
    key          VARCHAR(100) PRIMARY KEY,
    user_id      INT REFERENCES users(id) ON DELETE CASCADE,
    route        VARCHAR(120) NOT NULL,
    response     JSONB NOT NULL,
    status_code  INT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `);

  // ------------------------------------------------------------------
  // Database-level immutability for approved payroll.
  // ------------------------------------------------------------------
  await knex.raw(`
  CREATE OR REPLACE FUNCTION trg_protect_locked_payroll() RETURNS trigger AS $$
  BEGIN
    IF OLD.status IN ('Approved','Paid') THEN
      -- Only the Approved -> Paid transition and bookkeeping columns may change.
      IF NEW.status NOT IN ('Approved','Paid')
         OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
         OR NEW.net_salary IS DISTINCT FROM OLD.net_salary
         OR NEW.gross_earnings IS DISTINCT FROM OLD.gross_earnings
         OR NEW.total_deductions IS DISTINCT FROM OLD.total_deductions
         OR NEW.commission_total IS DISTINCT FROM OLD.commission_total
         OR NEW.base_salary IS DISTINCT FROM OLD.base_salary
         OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
         OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
         OR (OLD.status = 'Paid' AND NEW.status <> 'Paid') THEN
        RAISE EXCEPTION 'Payroll record % is locked (status %). Use an authorised adjustment.', OLD.id, OLD.status
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    RETURN NEW;
  END; $$ LANGUAGE plpgsql;

  CREATE TRIGGER payroll_records_lock
    BEFORE UPDATE ON payroll_records
    FOR EACH ROW EXECUTE FUNCTION trg_protect_locked_payroll();

  CREATE OR REPLACE FUNCTION trg_protect_locked_payroll_delete() RETURNS trigger AS $$
  BEGIN
    IF OLD.status IN ('Approved','Paid') THEN
      RAISE EXCEPTION 'Payroll record % is locked and cannot be deleted.', OLD.id USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END; $$ LANGUAGE plpgsql;

  CREATE TRIGGER payroll_records_lock_delete
    BEFORE DELETE ON payroll_records
    FOR EACH ROW EXECUTE FUNCTION trg_protect_locked_payroll_delete();

  CREATE OR REPLACE FUNCTION trg_protect_locked_line_items() RETURNS trigger AS $$
  DECLARE s TEXT;
  BEGIN
    SELECT status INTO s FROM payroll_records WHERE id = COALESCE(OLD.payroll_record_id, NEW.payroll_record_id);
    IF s IN ('Approved','Paid') THEN
      RAISE EXCEPTION 'Line items of locked payroll cannot be changed.' USING ERRCODE = 'P0001';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END; $$ LANGUAGE plpgsql;

  CREATE TRIGGER payroll_line_items_lock
    BEFORE INSERT OR UPDATE OR DELETE ON payroll_line_items
    FOR EACH ROW EXECUTE FUNCTION trg_protect_locked_line_items();

  -- Commission entries already locked into approved payroll cannot change amount/status.
  CREATE OR REPLACE FUNCTION trg_protect_locked_commission() RETURNS trigger AS $$
  BEGIN
    IF OLD.payroll_record_id IS NOT NULL AND (
         NEW.amount IS DISTINCT FROM OLD.amount OR NEW.status IS DISTINCT FROM OLD.status
         OR NEW.accounting_month IS DISTINCT FROM OLD.accounting_month
         OR NEW.payroll_record_id IS DISTINCT FROM OLD.payroll_record_id) THEN
      RAISE EXCEPTION 'Commission entry % is locked into approved payroll.', OLD.id USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END; $$ LANGUAGE plpgsql;

  CREATE TRIGGER commission_entries_lock
    BEFORE UPDATE ON commission_entries
    FOR EACH ROW EXECUTE FUNCTION trg_protect_locked_commission();

  -- Audit log is append-only.
  CREATE OR REPLACE FUNCTION trg_audit_append_only() RETURNS trigger AS $$
  BEGIN
    -- The only permitted change is the FK "ON DELETE SET NULL" when a user account is removed;
    -- the actor_name column keeps who did it.
    IF TG_OP = 'UPDATE' AND NEW.actor_id IS NULL AND OLD.actor_id IS NOT NULL
       AND NEW.action = OLD.action AND NEW.detail IS NOT DISTINCT FROM OLD.detail
       AND NEW.created_at = OLD.created_at AND NEW.actor_name IS NOT DISTINCT FROM OLD.actor_name THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'P0001';
  END; $$ LANGUAGE plpgsql;

  CREATE TRIGGER audit_logs_append_only
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION trg_audit_append_only();
  `);
};

exports.down = async function down() {
  // Deliberately not automatic: dropping payroll/attendance data must be an explicit,
  // manual decision (see database/documentation/03_MIGRATION_STRATEGY.md).
  throw new Error('Refusing to roll back the initial schema automatically. Restore from a backup instead.');
};
