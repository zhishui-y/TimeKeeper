# TimeKeeper architecture

## Domain boundary

The first release has exactly two domain models: `Appointment` and
`AccountProfile`. Billing remains embedded in appointments. Settings, import
previews, vault state, and backup manifests are infrastructure DTOs rather than
new domain models.

## Vue component map

| Surface            | Container responsibility                                    | Child contracts                                                                   |
| ------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| App shell          | Navigation, lock state, global appointment drawer           | Emits navigation and quick-create actions                                         |
| Today workspace    | Loads today's appointments and dashboard summary            | Passes appointments to timeline/list; receives edit/status actions                |
| Calendar board     | Maps appointments to FullCalendar events                    | Emits edit and reschedule requests; never mutates input props                     |
| Appointment drawer | Owns form draft and validation                              | Accepts optional appointment/account choices; emits save/cancel                   |
| Appointment table  | Filters and presents historical records                     | Emits edit/duplicate/cancel/delete actions                                        |
| Account table      | Presents account metadata without secrets                   | Emits edit/copy/role-refresh/weekly-usage/delete/reorder and column-width actions |
| Revenue dashboard  | Loads range summary and chart series                        | Receives range/granularity; emits filter changes                                  |
| Settings workspace | Coordinates import, role server, notifications, and backups | Emits commands through typed API only                                             |

Route views stay thin composition surfaces. Stateful database access lives in
feature composables; pure formatting and date calculations live in utilities.

## Native boundary

The frontend invokes typed Tauri commands only. SQL, Excel parsing, Stronghold,
backup file access, and secret clipboard handling remain in Rust.
Once initialized, a locked vault blocks secret operations without blocking
non-secret workspaces or SQLite metadata editing.

Account table column widths belong to `AppSettings` and are persisted through a dedicated settings
command after a pointer drag or keyboard adjustment completes. The account workspace owns both that
side effect and weekly-usage synchronization; the table and resize handle only emit typed UI events.
Weekly usage continues to use `AccountProfile.usageInfo` and SQLite `usage_info`. It is non-secret and
is cleared atomically at a China-local Monday boundary without accessing Stronghold.

Role-data refresh state and side effects live in `useAccountRoleDataRefresh`; the account table only
emits typed targets and the feedback component only renders the returned result. Real HTTP requests
remain in Rust. Rust percent-encodes server and character path segments, limits each response to
64 KiB, uses at most three concurrent requests, and commits all successful updates in one SQLite
transaction after networking finishes. The operation never opens Stronghold and never rewrites
appointment account snapshots. Browser mode uses deterministic in-memory results.

`AppSettings.accountRoleDataServerUrl` is non-secret infrastructure configuration. It is stored in
`settings.json`, included by the existing full-backup settings snapshot, and must be an absolute
HTTP(S) base URL with a host and without credentials, query parameters, or fragments.
