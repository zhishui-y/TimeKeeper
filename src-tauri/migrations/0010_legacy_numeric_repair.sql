CREATE TABLE legacy_numeric_repair_issues (
    id TEXT PRIMARY KEY,
    entity_kind TEXT NOT NULL CHECK (entity_kind IN ('account_profile', 'appointment')),
    entity_id TEXT NOT NULL,
    field_name TEXT NOT NULL CHECK (
        field_name IN ('current_score', 'highest_score', 'weekly_wins', 'amount_minor')
    ),
    original_value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    UNIQUE (entity_kind, entity_id, field_name)
);

INSERT INTO legacy_numeric_repair_issues (
    id, entity_kind, entity_id, field_name, original_value, created_at
)
SELECT 'account_profile:' || id || ':current_score', 'account_profile', id,
       'current_score', CAST(current_score AS TEXT), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM account_profiles
WHERE current_score > 9007199254740991;

INSERT INTO legacy_numeric_repair_issues (
    id, entity_kind, entity_id, field_name, original_value, created_at
)
SELECT 'account_profile:' || id || ':highest_score', 'account_profile', id,
       'highest_score', CAST(highest_score AS TEXT), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM account_profiles
WHERE highest_score > 9007199254740991;

INSERT INTO legacy_numeric_repair_issues (
    id, entity_kind, entity_id, field_name, original_value, created_at
)
SELECT 'account_profile:' || id || ':weekly_wins', 'account_profile', id,
       'weekly_wins', CAST(weekly_wins AS TEXT), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM account_profiles
WHERE weekly_wins > 9007199254740991;

INSERT INTO legacy_numeric_repair_issues (
    id, entity_kind, entity_id, field_name, original_value, created_at
)
SELECT 'appointment:' || id || ':amount_minor', 'appointment', id,
       'amount_minor', CAST(amount_minor AS TEXT), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM appointments
WHERE amount_minor > 9007199254740991;

UPDATE account_profiles
SET current_score = NULL
WHERE current_score > 9007199254740991;

UPDATE account_profiles
SET highest_score = NULL
WHERE highest_score > 9007199254740991;

UPDATE account_profiles
SET weekly_wins = NULL
WHERE weekly_wins > 9007199254740991;

UPDATE appointments
SET amount_minor = NULL,
    settlement_status = CASE
        WHEN mode = 'business' THEN 'unsettled'
        ELSE settlement_status
    END
WHERE amount_minor > 9007199254740991;

CREATE TRIGGER account_profiles_safe_integers_insert
BEFORE INSERT ON account_profiles
WHEN NEW.current_score > 9007199254740991
  OR NEW.highest_score > 9007199254740991
  OR NEW.weekly_wins > 9007199254740991
BEGIN
    SELECT RAISE(ABORT, 'account score exceeds JavaScript safe integer range');
END;

CREATE TRIGGER account_profiles_safe_integers_update
BEFORE UPDATE OF current_score, highest_score, weekly_wins ON account_profiles
WHEN NEW.current_score > 9007199254740991
  OR NEW.highest_score > 9007199254740991
  OR NEW.weekly_wins > 9007199254740991
BEGIN
    SELECT RAISE(ABORT, 'account score exceeds JavaScript safe integer range');
END;

CREATE TRIGGER appointments_safe_amount_insert
BEFORE INSERT ON appointments
WHEN NEW.amount_minor > 9007199254740991
BEGIN
    SELECT RAISE(ABORT, 'amount_minor exceeds JavaScript safe integer range');
END;

CREATE TRIGGER appointments_safe_amount_update
BEFORE UPDATE OF amount_minor ON appointments
WHEN NEW.amount_minor > 9007199254740991
BEGIN
    SELECT RAISE(ABORT, 'amount_minor exceeds JavaScript safe integer range');
END;
