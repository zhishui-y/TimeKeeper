PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS account_profiles (
    id TEXT PRIMARY KEY NOT NULL,
    contact_name TEXT,
    server TEXT,
    character_name TEXT,
    specialization TEXT,
    gear_score TEXT,
    account_name TEXT NOT NULL,
    current_score INTEGER,
    highest_score INTEGER,
    score_updated_at TEXT,
    notes TEXT,
    needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
    import_fingerprint TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (length(trim(account_name)) > 0),
    CHECK (current_score IS NULL OR current_score >= 0),
    CHECK (highest_score IS NULL OR highest_score >= 0)
);

CREATE TABLE IF NOT EXISTS appointments (
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
    account_profile_id TEXT REFERENCES account_profiles(id) ON DELETE SET NULL,
    account_snapshot_json TEXT,
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

CREATE INDEX IF NOT EXISTS idx_appointments_service_date
    ON appointments(service_date);
CREATE INDEX IF NOT EXISTS idx_appointments_time_range
    ON appointments(starts_at, ends_at)
    WHERE starts_at IS NOT NULL AND ends_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_status
    ON appointments(service_status, settlement_status);
CREATE INDEX IF NOT EXISTS idx_appointments_account_profile
    ON appointments(account_profile_id);
CREATE INDEX IF NOT EXISTS idx_account_profiles_account_name
    ON account_profiles(account_name COLLATE NOCASE);
