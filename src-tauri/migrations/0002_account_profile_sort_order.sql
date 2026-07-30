ALTER TABLE account_profiles
ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0);

WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            ORDER BY needs_review DESC, updated_at DESC, account_name COLLATE NOCASE
        ) - 1 AS position
    FROM account_profiles
)
UPDATE account_profiles
SET sort_order = (
    SELECT position
    FROM ranked
    WHERE ranked.id = account_profiles.id
);
