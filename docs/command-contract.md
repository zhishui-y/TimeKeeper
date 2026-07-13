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
- `vault_status() -> VaultStatus`
- `initialize_vault(password) -> VaultStatus`
- `unlock_vault(password) -> VaultStatus`
- `lock_vault() -> VaultStatus`
- `reveal_account_password(id) -> string`
- `copy_account_password(id) -> void`

Passwords never appear in account list/detail responses. Password writes and
SQLite profile writes use compensating rollback so a failed operation cannot
leave a visible profile without its secret.

## Reports, import, backup, and settings

- `get_dashboard_summary(date) -> DashboardSummary`
- `get_revenue_summary(from, to, granularity) -> RevenueSummary`
- `preview_excel_import(path, baseYear) -> ExcelImportPreview`
- `commit_excel_import(previewToken) -> ExcelImportResult`
- `create_backup(destination?) -> BackupResult`
- `restore_backup(path) -> void` (successful restore requests app restart)
- `get_settings() -> AppSettings`
- `update_settings(settings) -> AppSettings`

Excel preview tokens are in-memory, expire after 30 minutes, and contain parsed
secret values only on the Rust side. A repeated import is skipped using stable
row fingerprints.
