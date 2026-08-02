# Native command contract

All command payloads and responses use camelCase JSON. Rust DTOs use
`#[serde(rename_all = "camelCase")]` and match `src/types/domain.ts`.

## Appointments

- `list_appointments(filters) -> Appointment[]`
- `get_appointment(id) -> Appointment`
- `create_appointment(input) -> AppointmentMutationResult`
- `update_appointment(id, input) -> AppointmentMutationResult`
- `duplicate_appointment(id, serviceDate?) -> AppointmentMutationResult`
- `delete_appointment(id) -> void`
- `delete_appointments(ids) -> number`
- `sync_appointment_service_statuses() -> number`
- `set_appointment_service_status(id, status) -> Appointment`
- `settle_appointment(id, amountMinor, paymentMethod?) -> Appointment`

Conflict detection excludes cancelled appointments and the record being edited.
It only compares records with both a start and end timestamp. Conflicts warn but
do not block writes.

`sync_appointment_service_statuses` uses the current China-local time and is idempotent. Scheduled
appointments become in progress when their start time is reached. Scheduled or in-progress
appointments become completed when their end time is reached. Appointments without an end time
can start automatically but are never completed automatically.

## Accounts and vault

- `list_account_profiles(query?, needsReview?) -> AccountProfile[]`
- `get_account_profile(id) -> AccountProfile`
- `create_account_profile(input) -> AccountProfile`
- `update_account_profile(id, input) -> AccountProfile`
- `update_account_profile_usage(id, usageInfo?) -> AccountProfile`
- `clear_account_profile_usage() -> number`
- `sync_account_profile_usage_week() -> AccountUsageWeekSyncResult`
- `delete_account_profile(id) -> void`
- `delete_account_profiles(ids) -> number`
- `reorder_account_profiles(ids) -> void`
- `copy_account_name(id) -> void`
- `vault_status() -> VaultStatus`
- `initialize_vault(password) -> VaultStatus`
- `unlock_vault(password) -> VaultStatus`
- `change_vault_password(currentPassword, newPassword) -> VaultStatus`
- `lock_vault() -> VaultStatus`
- `reveal_account_password(id) -> string`
- `copy_account_password(id) -> void`

Passwords never appear in account list/detail responses. Password writes and
SQLite profile writes use compensating rollback so a failed operation cannot
leave a visible profile without its secret.

`update_account_profile_usage` first synchronizes the current China-local week, then trims free text,
stores blank content as `null`, and updates only the non-secret usage field and profile timestamp.
`sync_account_profile_usage_week` records the current week without clearing on first use; later China
Monday boundaries clear all non-null usage values atomically and advance the stored week marker.
`clear_account_profile_usage` performs the same all-account SQL update on demand. These operations
remain available while the vault is locked and never access Stronghold.

Changing the master password requires an unlocked vault and the current
password. Rust re-encrypts and verifies the complete Stronghold snapshot before
replacing the in-memory session. Existing backup files retain the master
password that was active when each backup was created. New master passwords
must contain at least 4 Unicode characters; 8 or more are recommended.

## Reports, import, backup, and settings

- `get_dashboard_summary(date) -> DashboardSummary`
- `get_revenue_summary(from, to, granularity) -> RevenueSummary`
- `preview_excel_import(path, baseYear) -> ExcelImportPreview`
- `commit_excel_import(previewToken, selection) -> ExcelImportResult`
- `create_backup(destination?) -> BackupResult`
- `restore_backup(path) -> void` (successful restore requests app restart)
- `get_settings() -> AppSettings`
- `update_settings(settings) -> AppSettings`
- `update_account_table_column_widths(widths) -> AccountTableColumnWidths`

`AppSettings.accountTableColumnWidths` stores the ten resizable account metadata widths. The dedicated
update command validates each value against its column minimum and the 480px maximum. Rust owns
`lastAccountUsageWeekStart`; generic settings updates cannot overwrite this weekly cleanup marker.
Older settings files that omit either field load default widths and a missing week marker, preserving
existing weekly content until the first later week transition.

Backup restore requires the current account-profile schema, including the
`usage_info` column. Backups created before migration `0003` are rejected by
schema validation rather than being upgraded during restore.

`DashboardSummary.pendingCount` counts business appointments whose service is completed but whose
settlement status is still unsettled. Scheduled, in-progress, cancelled, entertainment, and settled
appointments are excluded.

`AppSettings.autoLockMinutes` accepts `0` to disable idle auto-lock, or a value
from `1` through `1440` minutes. Manual lock and locking caused by closing the
application remain available when idle auto-lock is disabled.

Excel preview tokens are in-memory, expire after 30 minutes, and contain parsed
secret values only on the Rust side. `selection.appointments` and `selection.accounts`
independently control which data is committed, and at least one must be selected.
Appointments and account profiles use separate stable row fingerprints; repeated rows
are skipped independently and reported by data type.

`get_revenue_summary` requires both dates for a bounded report. Passing both `from` and `to` as
empty strings resolves the range from the earliest non-cancelled, positively settled business
appointment through the current China-local date. If no income exists, both dates resolve to today.
Passing only one empty date is invalid.
