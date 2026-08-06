# Native command contract

所有 command payload 与 response 使用 camelCase JSON；Rust DTO 使用
`#[serde(rename_all = "camelCase")]` 并与 `src/types/domain.ts` 一致。

除本节列出的入口命令外，所有业务 command 必须在 Rust 边界检查
`AppAccessState.require_unlocked()`。进程启动默认锁定，前端隐藏页面不是权限边界。

## App access

- `app_access_status() -> AppAccessStatus`
- `initialize_app_access(password, recovery) -> AppAccessStatus`
- `unlock_app_access(password) -> AppAccessStatus`
- `lock_app_access() -> AppAccessStatus`
- `change_app_access_password(currentPassword, newPassword) -> AppAccessStatus`
- `reset_app_access_password(newPassword, confirmationText, recoveryProof) -> AppAccessStatus`
- `set_app_access_recovery(currentPassword, recovery) -> AppAccessStatus`
- `migrate_legacy_credentials(password, recovery?) -> LegacyCredentialMigrationResult`
- `get_app_appearance() -> AppearanceSettings`（无需解锁）

`AppAccessStatus` 包含 `initialized`、`unlocked`、`recoveryQuestion` 与
`legacyMigrationPendingCount`。初始化、解锁、修改、重置以及恢复答案的 Argon2id 工作都在阻塞任务执行。
`AppAccessRecoverySetup` 为 `{ question, answer }`；`AppAccessRecoveryProof` 为
`{ kind: "answer", answer }` 或一次性旧用户兼容用的 `{ kind: "legacyEnrollment", recovery }`。
修改密码要求当前进程已解锁并再次验证当前密码；新密码至少 4 个 Unicode 字符，界面建议 8 位
以上。恢复问题长度为 2–100 个 Unicode 字符；答案先去首尾空白、合并连续空白并 Unicode 小写，
规范化后限制为 2–100 个字符。重置要求 `confirmationText === "重置"`，前端还必须要求两次新
密码一致；已有恢复问题时必须答对，旧用户无问题时只接受一次 `legacyEnrollment`。入口密码和
恢复记录在同一事务中写入，不触碰业务表或凭据表。

`migrate_legacy_credentials` 以只读方式验证旧 Stronghold。尚无入口 verifier 时，必须同时提供
恢复设置，成功使用的旧密码才会初始化为入口密码并在同一事务写入恢复记录；已有入口密码时，
必须先解锁进程。结果包含 `migratedCount`、
`missingCount`、`pendingCount`。缺失 key 保留队列，已有新凭据不覆盖并清除对应旧队列项。

## Appointments

- `list_appointments(filters) -> Appointment[]`
- `list_appointment_page(filters, page?, pageSize?) -> AppointmentPage`
- `create_appointment_selection(filters) -> AppointmentSelectionSnapshot`
- `get_appointment(id) -> Appointment`
- `create_appointment(input) -> AppointmentMutationResult`
- `update_appointment(id, input) -> AppointmentMutationResult`
- `duplicate_appointment(id, serviceDate?) -> AppointmentMutationResult`
- `delete_appointment(id) -> void`
- `delete_appointments(selection) -> AppointmentDeleteResult`
- `list_contact_presets(query?, limit=10) -> ContactPreset[]`
- `copy_appointment_account_name(id) -> void`
- `copy_appointment_voice_channel(id) -> void`
- `copy_appointment_account_password(id) -> void`
- `sync_appointment_service_statuses() -> number`
- `set_appointment_service_status(id, status) -> Appointment`
- `settle_appointment(id, amountMinor, paymentMethod?) -> Appointment`

`list_appointments` 是范围读取接口：`filters.from` 与 `filters.to` 必须同时提供，供今日工作台和
日历可见区间使用。`list_appointment_page` 用于历史记录，页码从 1 开始，默认每页 100、最大 200；
返回 `items`、`totalCount`、`page`、`pageSize`、`totalPages`。计数与页面行在同一只读事务取得，
排序固定为 `serviceDate DESC, startsAt DESC, createdAt DESC, id DESC`。

`create_appointment_selection` 返回准确 ID 快照的 `token`、`totalCount`、`expiresAt`，有效 10 分钟。
`delete_appointments.selection` 是以下 tagged union：

- `{ kind: "explicit", ids }`
- `{ kind: "token", token, excludedIds }`

删除返回 `matchedCount` 与 `deletedCount`。显式 ID 去空、去重；token 过期、未知或成功使用后均不可
再次使用。后端在同一事务中以每批 500 个 ID 删除，凭据外键级联；成功提交后通知状态一次加锁
批量取消。取消预约仍调用进度命令，不等同于永久删除。

`Appointment.account` 为 `null` 或内嵌 `source: "profile" | "embedded"`、只读历史快照
`characterName`、`specialization`、`gearScore`、`server`、`accountName`、
`password: string | null`。`AppointmentInput.account` 为：

- `null`：不保存账号。
- `{ kind: "profile", profileId }`：在 Rust 事务中复制当前档案元数据、角色名与密码，并保存
  `source = "profile"`，不保存档案 ID。
- `{ kind: "embedded", details, credential }`：保存一次性账号；`credential` 为 `keep`、
  `replace { password }` 或 `copyFromAppointment { sourceAppointmentId }`。
- `{ kind: "snapshot", source, characterName, details, credential }`：编辑、日历改期、联系人预设或
  待保存复制时保留现有来源和角色名；`credential` 还可使用 `{ kind: "none" }` 明确保留无密码。

已有预约的 `keep` 保留当前凭据；明确替换、复制或移除与预约元数据同事务提交。新增手工一次性
账号要求非空账号名和替换密码。Excel 导入保存为 `embedded` 且角色名为空。迁移后的 `profile`
角色名仍是历史快照，不关联或跟随档案。`voicePlatform` 接受 `yy`、`qq` 或 `null`；只有 YY 可
保存纯数字 `voiceChannel`。

`duplicate_appointment` 保留兼容并会立即创建记录；当前界面不调用它。预约记录表格和编辑抽屉先在
前端生成北京时间今天的待保存草稿，业务状态重置为 `scheduled + unsettled`，娱乐状态重置为
`scheduled + not_applicable`，再次点击保存后才调用 `create_appointment`。

冲突检查排除取消预约与正在编辑的自身，只比较开始和结束都存在的记录；冲突只警告不阻止保存。
跨天结束时间在规范化后进入次日。`sync_appointment_service_statuses` 使用北京时间且幂等；预约到达
开始时间进入 `in_progress`，到达结束时间后，业务预约进入“服务完成 + 未结算”（统一投影为
`pending_settlement`），娱乐预约进入 `completed + not_applicable`。无结束时间的预约可自动开始但不
自动完成。桌面进程在入口解锁后每 30 秒执行同一同步逻辑，前端也保留即时与周期同步用于刷新页面；
结算命令原子写入服务完成与已结算状态。

联系人预设只取每个联系人最新的非取消预约，最多 10 条；可返回账号密码本身以便显示/复用，
也保留 `sourceAppointmentId` 供 `copyFromAppointment` 协议使用。三种复制 command 都从 SQLite
重读当前值；只有密码复制使用 30 秒内容匹配清理。

## Accounts

- `list_account_profiles(query?, needsReview?) -> AccountProfile[]`
- `get_account_profile(id) -> AccountProfile`
- `create_account_profile(input) -> AccountProfile`
- `update_account_profile(id, input) -> AccountProfile`
- `delete_account_profile(id) -> void`
- `delete_account_profiles(ids) -> number`
- `reorder_account_profiles(ids) -> void`
- `copy_account_name(id) -> void`
- `copy_account_character_name(id) -> void`
- `copy_account_password(id) -> void`
- `refresh_account_profile_role_data(ids) -> AccountRoleDataRefreshResult`

`AccountProfile.password` 是 `string | null`，列表与详情均返回。创建、修改、明确移除和删除时，
档案元数据与凭据同一个 SQLite 事务提交；凭据通过外键级联删除。复制密码在 Rust 重读并执行
30 秒剪贴板清理。

`AccountProfile.weeklyWins` 是可空非负整数，只能由角色刷新成功响应中的有效 `week_win` 更新；前端
只读展示，周边界完全由服务端负责。原 `usageInfo`、编辑/清空 command 和客户端周切换已删除。
角色刷新对 ID 去空、去重并保留首次顺序；缺服务器或角色名为 `skipped`，服务端无记录为
`noRecord`，网络/解析/大小/日期错误为 `failed`。请求路径保留服务器和角色名百分号编码，并追加
`api_key` query 参数；空密钥不发请求，401 报密钥无效，503 报服务不可用或服务端未配置密钥。
最多 3 个并发，成功项在全部请求结束后一次事务写入；缺失或无效 `week_win` 保留旧胜场但更新其他
有效字段，请求失败或 `ok: false` 保留全部旧值，最高分只增不降，不改写预约快照或密码。

## Reports

- `get_dashboard_summary(date) -> DashboardSummary`
- `get_revenue_summary(from, to, granularity) -> RevenueSummary`

Dashboard 只统计非取消业务预约的已结金额，待结数量只包含服务已完成但未结算的业务预约。
收益查询要求 `from`/`to` 同时填写或同时为空；同时为空时从最早的非取消、正数、已结业务收入
推导到北京时间今天，无收入时两端都为今天。`RevenueSummary.pendingCount` 及各
`RevenuePoint.pendingCount` 只统计对应范围内服务已完成但未结算的业务预约。金额始终使用
人民币分整数，收益页面不展示待结金额。

## Excel import

- `preview_excel_import(path, baseYear) -> ExcelImportPreview`
- `commit_excel_import(previewToken, selection) -> ExcelImportResult`

预览 token 仅存 Rust 内存，30 分钟过期；解析出的密码不出现在响应。`selection.appointments` 与
`selection.accounts` 独立控制提交，至少选一个。缺少 `account` sheet 时允许预约导入但拒绝仅账号
提交。账号、预约和凭据在一个 SQLite 事务提交，稳定指纹按数据类型独立跳过。提交后只调度本次
新增预约的通知。

唯一纯 ASCII 数字备注识别为 YY 频道；冲突数字备注继续作为普通备注并产生警告。负金额原值写入
备注，账单金额为空、结算状态为未结，并返回行警告。

## Backup and settings

- `create_backup(destination?) -> BackupResult`
- `restore_backup(path) -> void`（暂存成功后请求应用重启）
- `get_settings() -> AppSettings`
- `update_settings(settings) -> AppSettings`
- `update_account_table_column_widths(widths) -> AccountTableColumnWidths`
- `update_appointment_table_column_widths(widths) -> AppointmentTableColumnWidths`

新建备份写格式 v2：`database.sqlite3` 与 `settings.json` 必选；仅当旧凭据迁移队列不为空时，
`vault.hold` 与 `vault.salt` 成对必选。恢复接受 v1/v2，先校验清单、文件哈希、数据库、设置和
可选 Stronghold 对，再创建当前 v2 预恢复备份。替换在重启早期执行并保留失败回滚；v1 数据库由
正常 migration 升级。

`AppSettings` 不再包含 `autoLockMinutes`。入口锁没有空闲计时器；托盘恢复保持解锁，手动锁定和
进程重启仍生效。表格列宽命令只更新各自字段并保留其余设置；角色数据服务器 URL 必须是无凭据、
无 query、无 fragment 的绝对 HTTP(S) 基础 URL。`accountRoleDataApiKey` 保存时去除首尾空白，作为
普通设置随 `settings.json` 返回前端并进入完整备份，仅通过密码输入框掩码显示，不经过加密。账号
表格列宽包含 `accountName`、`password` 与 `weeklyWins`；读取旧设置时原 `weekly` 宽度迁移到
`weeklyWins`。
账号和预约表格的所有可调列统一允许 `48..=480` 像素，48 像素约为当前字号下两个中文字符加单元格
内边距。`AppearanceSettings` 包含 `fontFamily: string` 与 `baseFontSize: number`；普通设置写入
仍要求已解锁，只有 `get_app_appearance` 可在锁屏读取。

恢复 v2 备份时，暂存副本只接受从 `0001` 开始、校验和匹配且至少到 `0005` 的连续可信 migration
前缀，并在副本中补跑缺失 migration 后按当前 schema、外键、恢复单例、问题、Argon2 verifier
和时间戳验收。不得修改备份原件或正式数据库。
