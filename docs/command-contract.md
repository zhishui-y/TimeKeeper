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
- `set_appointment_service_status(id, status) -> Appointment`
- `settle_appointment(id, amountMinor, paymentMethod?) -> Appointment`

Conflict detection excludes cancelled appointments and the record being edited.
It only compares records with both a start and end timestamp. Conflicts warn but
do not block writes.

## Accounts and vault

- `list_account_profiles(query?, needsReview?) -> AccountProfile[]`
- `get_account_profile(id) -> AccountProfile`
- `create_account_profile(input) -> AccountProfile`
- `update_account_profile(id, input) -> AccountProfile`
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

Changing the master password requires an unlocked vault and the current
password. Rust re-encrypts and verifies the complete Stronghold snapshot before
replacing the in-memory session. Existing backup files retain the master
password that was active when each backup was created. New master passwords
must contain at least 4 Unicode characters; 8 or more are recommended.

## Reports, import, backup, and settings

- `get_dashboard_summary(date) -> DashboardSummary`
- `get_revenue_summary(from, to, granularity) -> RevenueSummary`
- `preview_excel_import(path, baseYear) -> ExcelImportPreview`
- `commit_excel_import(previewToken) -> ExcelImportResult`
- `create_backup(destination?) -> BackupResult`
- `restore_backup(path) -> void` (successful restore requests app restart)
- `get_settings() -> AppSettings`
- `update_settings(settings) -> AppSettings`

`AppSettings.autoLockMinutes` accepts `0` to disable idle auto-lock, or a value
from `1` through `1440` minutes. Manual lock and locking caused by closing the
application remain available when idle auto-lock is disabled.

Excel preview tokens are in-memory, expire after 30 minutes, and contain parsed
secret values only on the Rust side. A repeated import is skipped using stable
row fingerprints.
