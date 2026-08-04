ALTER TABLE appointments ADD COLUMN account_source TEXT
    CHECK (account_source IS NULL OR account_source IN ('profile', 'embedded'));

ALTER TABLE appointments ADD COLUMN account_character_name TEXT;

UPDATE appointments
SET
    account_source = CASE
        WHEN (
            SELECT COUNT(*)
            FROM account_profiles p
            WHERE lower(trim(p.account_name)) = lower(trim(appointments.account_name))
        ) = 1 THEN 'profile'
        ELSE 'embedded'
    END,
    account_character_name = CASE
        WHEN (
            SELECT COUNT(*)
            FROM account_profiles p
            WHERE lower(trim(p.account_name)) = lower(trim(appointments.account_name))
        ) = 1 THEN (
            SELECT p.character_name
            FROM account_profiles p
            WHERE lower(trim(p.account_name)) = lower(trim(appointments.account_name))
            LIMIT 1
        )
        ELSE NULL
    END
WHERE account_name IS NOT NULL;
