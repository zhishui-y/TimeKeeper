# TimeKeeper architecture

## Domain boundary

The first release has exactly two domain models: `Appointment` and
`AccountProfile`. Billing remains embedded in appointments. Settings, import
previews, vault state, and backup manifests are infrastructure DTOs rather than
new domain models.

## Vue component map

| Surface            | Container responsibility                          | Child contracts                                                    |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------ |
| App shell          | Navigation, lock state, global appointment drawer | Emits navigation and quick-create actions                          |
| Today workspace    | Loads today's appointments and dashboard summary  | Passes appointments to timeline/list; receives edit/status actions |
| Calendar board     | Maps appointments to FullCalendar events          | Emits edit and reschedule requests; never mutates input props      |
| Appointment drawer | Owns form draft and validation                    | Accepts optional appointment/account choices; emits save/cancel    |
| Appointment table  | Filters and presents historical records           | Emits edit/duplicate/cancel/delete actions                         |
| Account table      | Presents account metadata without secrets         | Emits edit/reveal/copy actions                                     |
| Revenue dashboard  | Loads range summary and chart series              | Receives range/granularity; emits filter changes                   |
| Settings workspace | Coordinates import, notifications, and backups    | Emits commands through typed API only                              |

Route views stay thin composition surfaces. Stateful database access lives in
feature composables; pure formatting and date calculations live in utilities.

## Native boundary

The frontend invokes typed Tauri commands only. SQL, Excel parsing, Stronghold,
backup file access, and secret clipboard handling remain in Rust.
