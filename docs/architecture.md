# TimeKeeper architecture

## Domain boundary

The first release has exactly two domain models: `Appointment` and
`AccountProfile`. Billing remains embedded in appointments. Settings, import
previews, vault state, and backup manifests are infrastructure DTOs rather than
new domain models.

An appointment may contain an `AppointmentAccount` value object with only
specialization, gear score, server, account name, and a non-secret password
availability flag. It has no persistent foreign key to `AccountProfile`.
Choosing a profile copies its current metadata and password at save time;
subsequent profile edits never mutate historical appointments. The password
itself remains outside both domain DTOs and SQLite.

## Vue component map

| Surface                    | Container responsibility                                     | Child contracts                                                                   |
| -------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| App shell                  | Navigation, lock state, global appointment drawer            | Emits navigation and quick-create actions                                         |
| Today workspace            | Loads today's appointments and dashboard summary             | Passes appointments to timeline/list; receives edit/status/copy actions           |
| Calendar board             | Maps appointments to FullCalendar events                     | Emits edit and reschedule requests; never mutates input props                     |
| Appointment drawer         | Composes the drawer shell and form sections                  | Delegates draft, validation, template restore, and serialization to a composable  |
| Contact fields             | Presents recent/searchable contacts                          | Emits explicit preset selection; typing alone never restores a template           |
| Appointment account fields | Presents no-account/profile/embedded modes                   | Emits typed account drafts and never reveals an existing password                 |
| Appointment table          | Filters and presents historical records                      | Emits edit/duplicate/copy/delete and column-width actions                         |
| Account toolbar            | Presents compact search, filters, bulk actions, and vault UI | Uses typed models/events; owns only the unlock-dialog draft                       |
| Account table              | Presents account metadata without secrets                    | Emits edit/copy/role-refresh/weekly-usage/delete/reorder and column-width actions |
| Revenue dashboard          | Loads range summary and chart series                         | Receives range/granularity; emits filter changes                                  |
| Settings workspace         | Coordinates import, role server, notifications, and backups  | Emits commands through typed API only                                             |

Route views stay thin composition surfaces. Stateful database access lives in
feature composables; pure formatting and date calculations live in utilities.

## Native boundary

The frontend invokes typed Tauri commands only. SQL, Excel parsing, Stronghold,
backup file access, and secret clipboard handling remain in Rust.
Once initialized, a locked vault blocks secret operations without blocking
non-secret workspaces or SQLite metadata editing.

Account-profile secrets and appointment secrets use separate Stronghold keys.
Creating from a profile, duplicating an appointment, importing a workbook row,
or restoring a contact preset copies the secret inside Rust without returning it
to the frontend. SQLite mutations and Stronghold mutations use compensating
rollback; operations that need a secret fail while the vault is locked. Password
copying is the only appointment-secret output and goes directly to the clipboard,
which is cleared after the configured 30-second safety window.

Migration `0004` removes the appointment/profile foreign key, expands the four
embedded account columns plus password availability and voice fields, and keeps a
temporary `appointment_password_backfill` queue. The first successful vault
unlock copies each available legacy profile password into an appointment-specific
entry. Missing sources remain non-secret appointments with
`passwordAvailable=false`; transient failures remain queued for idempotent retry.

Account table column widths belong to `AppSettings` and are persisted through a dedicated settings
command after a pointer drag or keyboard adjustment completes. The account workspace owns both that
side effect and weekly-usage synchronization; the table and resize handle only emit typed UI events.
Weekly usage continues to use `AccountProfile.usageInfo` and SQLite `usage_info`. It is non-secret and
is cleared atomically at a China-local Monday boundary without accessing Stronghold.

Appointment table column widths follow the same settings-owned interaction model through a separate
dedicated command, so resizing one table cannot overwrite the other table's preferences. The
appointment workspace owns persistence rollback and row actions. The table presents appointment
content, account metadata, voice, progress, amount, and notes as separate columns. Settlement is not
shown as a second column. Account metadata uses two lines and
emits account/password copy requests. The voice column emits a channel-copy request only for a valid
YY channel number. Rust reloads non-secret account names and YY channels from SQLite before copying
them without opening Stronghold or scheduling clipboard cleanup, while password copy retains the
normal unlock and 30-second clipboard-clearing boundary. Row deletion first opens a focused choice
dialog so cancelling an appointment remains distinct from permanently deleting its record and
appointment secret.

Appointment progress is a UI projection over the two persisted fields rather than a third domain
model. Entertainment uses the four service states. Business maps completed plus unsettled to
`pending_settlement`, and any non-cancelled settled record to `completed`; cancellation takes
precedence without erasing billing history. The shared projection utility is used by the drawer,
record table, filters, today workspace, week schedule, calendar, and revenue detail. Writes continue
to send the existing service and settlement fields so reports, imports, backups, and the SQLite
schema remain compatible.

The account toolbar remains a single presentation row: `AccountsWorkspace` owns search, filtering,
vault operations, and API side effects, while `AccountToolbar` owns only the transient unlock-dialog
visibility and password draft. The dialog uses the shared modal focus behavior and clears its draft
after success or cancellation. An unlocked vault locks immediately from the same toolbar control;
an initialized locked vault prompts for the master password without exposing it to account DTOs.

Role-data refresh state, side effects, and feedback-dismissal timers live in
`useAccountRoleDataRefresh`; the account table only emits typed targets and the result dialog renders
the returned summary in a blocking, centered overlay without changing the table layout. Results
without failed items close after five seconds; failed results and command-level errors remain until
manually closed. Role refresh does not duplicate this feedback through the global toast. Real HTTP
requests remain in Rust. Rust percent-encodes server
and character path segments, limits each response to 64 KiB, uses at most three concurrent requests,
and commits all successful updates in one SQLite transaction after networking finishes. The
operation never opens Stronghold and never rewrites appointment-embedded account data. Browser mode
uses deterministic in-memory results.

`AppSettings.accountRoleDataServerUrl` is non-secret infrastructure configuration. It is stored in
`settings.json`, included by the existing full-backup settings snapshot, and must be an absolute
HTTP(S) base URL with a host and without credentials, query parameters, or fragments.

Contact presets are projections of the newest non-cancelled appointment per
contact, not a third domain model. Empty queries return the ten most recent
contacts; non-empty queries perform a bounded fuzzy lookup. Restoring a preset
preserves the new appointment date and returns only safe account metadata plus a
source appointment ID that Rust can use for an in-vault password copy.

Excel preview keeps parsed secrets only in Rust memory. Committing appointment
rows writes their four account fields directly to the appointment and stores each
row password under that appointment's Stronghold key; it never resolves an
account-profile relationship. Missing row passwords are accepted with a warning.
Database writes and all created secrets participate in the same compensation
ledger.

Full-backup restore validates the exact current migration history, table set,
columns, indexes, constraints, row values, settings, and Stronghold pair before
staging. Backups older than migration `0004` are deliberately rejected rather
than being upgraded during restore.
