CREATE TABLE appointment_password_backfill (
    appointment_id TEXT PRIMARY KEY NOT NULL,
    source_profile_id TEXT NOT NULL,
    CHECK (length(trim(appointment_id)) > 0),
    CHECK (length(trim(source_profile_id)) > 0)
);

INSERT INTO appointment_password_backfill (appointment_id, source_profile_id)
SELECT id, account_profile_id
FROM appointments
WHERE account_profile_id IS NOT NULL
  AND length(trim(account_profile_id)) > 0;

CREATE TABLE appointments_v4 (
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
    account_password_available INTEGER NOT NULL DEFAULT 0
        CHECK (account_password_available IN (0, 1)),
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
            AND account_server IS NULL
            AND account_password_available = 0)
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

INSERT INTO appointments_v4 (
    id, service_date, starts_at, ends_at, contact_name, content, mode,
    service_status, settlement_status,
    account_specialization, account_gear_score, account_server, account_name,
    account_password_available, voice_platform, voice_channel,
    rate_note, payment_method, amount_minor, reminder_minutes, notes,
    import_fingerprint, created_at, updated_at
)
SELECT
    appointment.id,
    appointment.service_date,
    appointment.starts_at,
    appointment.ends_at,
    appointment.contact_name,
    appointment.content,
    appointment.mode,
    appointment.service_status,
    appointment.settlement_status,
    CASE
        WHEN appointment.account_snapshot_json IS NOT NULL
             AND json_valid(appointment.account_snapshot_json)
        THEN NULLIF(trim(json_extract(appointment.account_snapshot_json, '$.specialization')), '')
        WHEN appointment.account_profile_id IS NOT NULL
        THEN NULLIF(trim(profile.specialization), '')
        ELSE NULL
    END,
    CASE
        WHEN appointment.account_snapshot_json IS NOT NULL
             AND json_valid(appointment.account_snapshot_json)
        THEN NULLIF(trim(json_extract(appointment.account_snapshot_json, '$.gearScore')), '')
        WHEN appointment.account_profile_id IS NOT NULL
        THEN NULLIF(trim(profile.gear_score), '')
        ELSE NULL
    END,
    CASE
        WHEN appointment.account_snapshot_json IS NOT NULL
             AND json_valid(appointment.account_snapshot_json)
        THEN NULLIF(trim(json_extract(appointment.account_snapshot_json, '$.server')), '')
        WHEN appointment.account_profile_id IS NOT NULL
        THEN NULLIF(trim(profile.server), '')
        ELSE NULL
    END,
    CASE
        WHEN appointment.account_snapshot_json IS NOT NULL
             AND json_valid(appointment.account_snapshot_json)
        THEN NULLIF(trim(json_extract(appointment.account_snapshot_json, '$.accountName')), '')
        WHEN appointment.account_profile_id IS NOT NULL
        THEN NULLIF(trim(profile.account_name), '')
        ELSE NULL
    END,
    0,
    NULL,
    NULL,
    appointment.rate_note,
    appointment.payment_method,
    appointment.amount_minor,
    appointment.reminder_minutes,
    appointment.notes,
    appointment.import_fingerprint,
    appointment.created_at,
    appointment.updated_at
FROM appointments AS appointment
LEFT JOIN account_profiles AS profile
    ON profile.id = appointment.account_profile_id;

DROP TABLE appointments;
ALTER TABLE appointments_v4 RENAME TO appointments;

CREATE INDEX idx_appointments_service_date
    ON appointments(service_date);
CREATE INDEX idx_appointments_time_range
    ON appointments(starts_at, ends_at)
    WHERE starts_at IS NOT NULL AND ends_at IS NOT NULL;
CREATE INDEX idx_appointments_status
    ON appointments(service_status, settlement_status);
CREATE INDEX idx_appointments_contact_recent
    ON appointments(contact_name COLLATE NOCASE, service_date DESC, starts_at DESC, created_at DESC)
    WHERE service_status != 'cancelled';
