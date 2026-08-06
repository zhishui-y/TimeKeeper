ALTER TABLE account_profiles
DROP COLUMN usage_info;

ALTER TABLE account_profiles
ADD COLUMN weekly_wins INTEGER
CHECK (weekly_wins IS NULL OR weekly_wins >= 0);
