CREATE TABLE account_profile_credentials (
    profile_id TEXT PRIMARY KEY NOT NULL
        REFERENCES account_profiles(id) ON DELETE CASCADE,
    password TEXT NOT NULL CHECK (length(password) > 0)
);

CREATE TABLE app_access (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    password_verifier TEXT NOT NULL CHECK (length(password_verifier) > 0),
    updated_at TEXT NOT NULL
);

CREATE TABLE legacy_credential_migration (
    target_kind TEXT NOT NULL CHECK (target_kind IN ('account_profile', 'appointment')),
    target_id TEXT NOT NULL CHECK (length(trim(target_id)) > 0),
    source_kind TEXT NOT NULL CHECK (source_kind IN ('account_profile', 'appointment')),
    source_id TEXT NOT NULL CHECK (length(trim(source_id)) > 0),
    PRIMARY KEY (target_kind, target_id)
);

-- Every legacy profile may have a Stronghold entry under its own profile ID.
INSERT INTO legacy_credential_migration (
    target_kind, target_id, source_kind, source_id
)
SELECT 'account_profile', id, 'account_profile', id
FROM account_profiles;

-- Entries that still await the v4 profile-to-appointment backfill must retain
-- the original profile key as their exact source.
INSERT INTO legacy_credential_migration (
    target_kind, target_id, source_kind, source_id
)
SELECT 'appointment', appointment_id, 'account_profile', source_profile_id
FROM appointment_password_backfill;

-- A positive v4 availability flag means the password already lives in the
-- appointment namespace. This source takes precedence over a stale queue row.
INSERT INTO legacy_credential_migration (
    target_kind, target_id, source_kind, source_id
)
SELECT 'appointment', id, 'appointment', id
FROM appointments
WHERE account_password_available = 1
ON CONFLICT (target_kind, target_id) DO UPDATE SET
    source_kind = excluded.source_kind,
    source_id = excluded.source_id;

CREATE TABLE appointments_v5 (
    id TEXT PRIMARY KEY NOT NULL,
    service_date TEXT NOT NULL,
    starts_at TEXT,
    ends_at TEXT,
    contact_name TEXT NOT NULL,
    content TEXT,
    mode TEXT NOT NULL CHECK (mode IN ('entertainment', 'business')),
    service_status TEXT NOT NULL CHECK (
        service_status IN ('scheduled', 'in_progress', 'completed', 'cancelled')
    ),
    settlement_status TEXT NOT NULL CHECK (
        settlement_status IN ('not_applicable', 'unsettled', 'settled')
    ),
    account_specialization TEXT,
    account_gear_score TEXT,
    account_server TEXT,
    account_name TEXT,
    voice_platform TEXT CHECK (voice_platform IN ('yy', 'qq')),
    voice_channel TEXT,
    rate_note TEXT,
    payment_method TEXT,
    amount_minor INTEGER,
    reminder_minutes INTEGER,
    notes TEXT,
    import_fingerprint TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (length(trim(contact_name)) > 0),
    CHECK (ends_at IS NULL OR starts_at IS NOT NULL),
    CHECK (ends_at IS NULL OR ends_at > starts_at),
    CHECK (amount_minor IS NULL OR amount_minor >= 0),
    CHECK (reminder_minutes IS NULL OR reminder_minutes >= 0),
    CHECK (
        (account_name IS NULL
            AND account_specialization IS NULL
            AND account_gear_score IS NULL
            AND account_server IS NULL)
        OR
        (account_name IS NOT NULL AND length(trim(account_name)) > 0)
    ),
    CHECK (
        voice_channel IS NULL
        OR (
            voice_platform = 'yy'
            AND length(voice_channel) > 0
            AND voice_channel NOT GLOB '*[^0-9]*'
        )
    ),
    CHECK (
        (mode = 'entertainment'
            AND settlement_status = 'not_applicable'
            AND rate_note IS NULL
            AND payment_method IS NULL
            AND amount_minor IS NULL)
        OR
        (mode = 'business' AND settlement_status IN ('unsettled', 'settled'))
    ),
    CHECK (settlement_status != 'settled' OR amount_minor IS NOT NULL)
);

INSERT INTO appointments_v5 (
    id, service_date, starts_at, ends_at, contact_name, content, mode,
    service_status, settlement_status,
    account_specialization, account_gear_score, account_server, account_name,
    voice_platform, voice_channel,
    rate_note, payment_method, amount_minor, reminder_minutes, notes,
    import_fingerprint, created_at, updated_at
)
SELECT
    id, service_date, starts_at, ends_at, contact_name, content, mode,
    service_status, settlement_status,
    account_specialization, account_gear_score, account_server, account_name,
    voice_platform, voice_channel,
    rate_note, payment_method, amount_minor, reminder_minutes, notes,
    import_fingerprint, created_at, updated_at
FROM appointments;

DROP TABLE appointments;
ALTER TABLE appointments_v5 RENAME TO appointments;
DROP TABLE appointment_password_backfill;

CREATE TABLE appointment_credentials (
    appointment_id TEXT PRIMARY KEY NOT NULL
        REFERENCES appointments(id) ON DELETE CASCADE,
    password TEXT NOT NULL CHECK (length(password) > 0)
);

CREATE INDEX idx_appointments_service_date
    ON appointments(service_date);
CREATE INDEX idx_appointments_history_sort
    ON appointments(service_date DESC, starts_at DESC, created_at DESC, id DESC);
CREATE INDEX idx_appointments_time_range
    ON appointments(starts_at, ends_at)
    WHERE starts_at IS NOT NULL AND ends_at IS NOT NULL;
CREATE INDEX idx_appointments_status
    ON appointments(service_status, settlement_status);
CREATE INDEX idx_appointments_contact_recent
    ON appointments(contact_name COLLATE NOCASE, service_date DESC, starts_at DESC, created_at DESC)
    WHERE service_status != 'cancelled';
CREATE INDEX idx_appointments_pending_notifications
    ON appointments(service_date, starts_at, id)
    WHERE reminder_minutes IS NOT NULL AND service_status != 'cancelled';
