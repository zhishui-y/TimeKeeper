# TimeKeeper architecture

## Domain boundary

第一版只有两个领域模型：`Appointment` 与 `AccountProfile`。账单仍内嵌在预约中；
入口状态、设置、导入预览、选择快照和备份清单都是基础设施 DTO，不新增领域模型。

预约可保存 `AppointmentAccount` 快照，包括心法、装分、服务器、账号名和独立密码。
选择账号档案时，Rust 在保存事务中复制当时的元数据与密码，不持久化档案外键；之后修改档案
不会改写历史预约。业务预约的服务进度与结算状态相互独立，只有已结算金额计入已结收益。

## Process access gate and credentials

`AppAccessState` 是进程内状态，启动默认锁定。`App.vue` 并行加载入口状态和非敏感外观设置，
在首屏挂载前应用字体与字号，再在 `AppAccessGate` 与 `AuthenticatedAppShell` 之间二选一挂载。
托盘隐藏或恢复不会锁定；
手动锁定与真正退出后重启会重新要求入口密码。所有业务 Tauri command 都在 Rust 边界调用
`require_unlocked()`，不能只依赖前端路由保护。

`app_access` 单例表只保存 Argon2id PHC verifier。Migration `0007` 新增
`app_access_recovery` 单例表：问题明文保存用于展示，答案只保存独立随机盐的 Argon2id PHC
verifier。首次设置入口密码必须同时写入恢复记录；已有问题的重置必须答对，旧用户无问题时只
允许一次 `legacyEnrollment` 并在同一事务中补设。答案规范化为去首尾空白、合并连续空白和
Unicode 小写。账号档案和预约密码分别明文存入
`account_profile_credentials` 与 `appointment_credentials`，通过外键级联删除。入口密码只防止
他人随手打开应用，不加密 SQLite 或备份，也不抵御拥有本机文件读取权限的攻击者。无损重置只
替换 verifier 并立即解锁，不删除任何业务或凭据记录。

密码随 `AccountProfile.password`、`AppointmentAccount.password` 返回前端，类型都是
`string | null`。共享掩码组件默认显示固定 `••••••`，只允许逐行临时显示；切页、筛选、导航和
锁定会卸载或重置显示状态。密码不得进入日志、错误、Excel 预览、备份清单或测试快照；复制命令
在 Rust 从 SQLite 重读密码，并在 30 秒后仅当剪贴板内容仍匹配时清空。

预约账号是独立历史快照。Migration `0006` 新增 `account_source` 与
`account_character_name`：旧记录只有在规范化账号名唯一匹配一个档案时才标记为 `profile` 并
复制当时角色名；无匹配或多重匹配均标记为 `embedded`。不保存档案外键，后续档案修改或删除不会
改写预约。Excel 导入始终创建 `embedded` 快照。

## Upgrade from legacy Stronghold

Migration `0005` 在删除 v4 密码可用标记和旧回填表前，把每个目标的准确 Stronghold 来源记录到
`legacy_credential_migration`。旧文件只由兼容读取器打开，不进入日常业务路径。

首次升级流程为：

1. 使用旧主密码只读验证临时 Stronghold。
2. 一次性读取迁移队列的账号、预约独立密码和 v4 档案回填来源。
3. 在一个 SQLite 事务内写入全部可用凭据、删除已完成队列项，并在尚无入口 verifier 时把旧密码
   的 Argon2id verifier 写为入口密码。
4. 事务成功后才解锁；任一数据库错误整体回滚，旧 `vault.hold` / `vault.salt` 从不保存或删除。

缺失 key 保留在队列中，可稍后重试。用户也可跳过迁移，先初始化新入口密码；业务数据继续可用，
未迁移密码为 `null`。新建、替换或明确删除密码时会在同一事务移除对应队列项，后续旧迁移不得
覆盖新值。

## Vue composition

Vue 采用 Composition API、`<script setup lang="ts">`、Pinia 与 Vue Router。路由页只组合；
加载、分页、选择、写入副作用与反馈计时由对应 composable/store 管理；纯日期、格式化和统一进度
投影留在 utility。组件通过 typed props/emits 通信，不直接执行 SQL 或访问正式数据目录。

预约状态由 Rust 以北京时间落库推进：应用解锁后后台任务周期同步，前端 composable 监听变更事件
并保留 command 轮询兜底。业务预约结束后保持未结算并投影为待结算，娱乐预约结束后直接完成。

| Surface                 | Responsibility                                                              |
| ----------------------- | --------------------------------------------------------------------------- |
| `App.vue`               | 并行启动入口状态与外观设置，首屏前应用外观并选择入口页/已认证壳层           |
| `AuthenticatedAppShell` | 只组合导航、稳定页头、路由和全局浮层                                        |
| Today / Calendar        | 只加载所需日期范围；Calendar 按 `datesSet` 可见区间加载并转换 exclusive end |
| Appointments workspace  | 服务端分页、筛选、跨页选择 token、批量删除与末页回退                        |
| Accounts workspace      | 账号筛选、角色数据刷新、只读本周胜场、批量操作与密码掩码                    |
| Settings workspace      | 分类设置导航、外观预览、Excel 预览提交、通知、角色服务器、API 密钥与备份    |

外观由 `useAppAppearance` 负责加载、预览、回退和持久化；`AppearanceSettingsPanel` 与
`TypographyPreview` 负责字体和字号，字体不可用时原子回退到默认字体并反馈原因。字体变化会通知
日历 `updateSize()` 与收益图表 `resize()`；ECharts 文本同步使用当前字体字号。外观字段写入
`settings.json`，随完整备份保存。

预约记录表格和编辑抽屉的“复制”都只生成日期为北京时间今天的新建草稿，保留当前表单内容并重置
进度；关闭草稿不写库，只有再次保存才调用 `create_appointment`。原生 `duplicate_appointment`
保留供兼容调用。

## Appointment query and selection model

普通历史页调用 `list_appointment_page`，每页默认 100、最大 200；计数与页面数据在同一只读事务
取得。稳定排序固定为：

```text
service_date DESC, starts_at DESC, created_at DESC, id DESC
```

前端全选全部筛选结果时，只保存 `create_appointment_selection` 返回的 10 分钟 ID 快照 token 与
排除 ID，不创建 10,000 个响应式 ID。筛选改变清空选择，翻页保留；成功删除后 token 失效，
重复使用或过期均拒绝。显式 ID 与 token 删除统一返回 `matchedCount` / `deletedCount`。

永久删除先解析精确 ID 集合，再在一个 SQLite 事务中按 500 个 ID 的 SQL 批次删除；预约凭据由
外键级联删除。通知状态只加锁一次并批量取消。取消预约仍是进度变更，与永久删除保持不同交互。

`list_appointments` 只接受同时存在的 `from` / `to`，用于今日周范围和日历可见范围。历史页、
范围读取、待提醒查询分别使用 migration `0005` 的复合索引。10,000 条目标下搜索仍保留
`%LIKE%` 中文子串语义，允许扫描，不引入 FTS。

## Native transaction boundaries

前端只能调用有类型的 Tauri command。SQLite、Excel 解析、旧 Stronghold、备份文件、系统通知
与敏感剪贴板都留在 Rust。新增、修改、复制密码来源、删除和 Excel 提交中的元数据与凭据必须在
单个 SQLite 事务内提交，不再使用 SQLite/Stronghold 补偿写。

Excel 仍是“预览后提交”：预览 token 和解析出的密码只存在 Rust 内存 30 分钟，响应不含密码。
提交时账号、预约及其凭据原子写入；重复指纹按数据类型独立跳过。唯一纯 ASCII 数字备注仍识别为
YY 频道，冲突备注保留并警告；负金额保留在备注、金额置空并返回警告。提交后只为本次新增预约
调度通知，不重扫全部未来记录。

启动通知恢复只查询未来、未取消且配置提醒所需的字段。自动备份有独立定时任务，不依赖入口或旧
Stronghold 解锁状态。

## Reports and account role refresh

统一进度是两个持久字段的 UI 投影：娱乐预约直接使用服务状态；业务“服务完成且未结”映射为
`pending_settlement`，任一非取消且已结记录映射为 `completed`，取消优先。收益页面只展示
非取消、业务、已结金额；待结信息按“服务已完成且未结算”的场次统计，并保持现有范围校验。

角色数据刷新仍由 Rust 执行真实 HTTP：路径段百分号编码并以 `api_key` query 参数认证，单响应最多
64 KiB，最多 3 个并发，网络结束后一次事务提交成功项。空密钥在发起网络请求前拒绝；401 表示密钥
无效，503 表示角色数据服务不可用或服务端未配置密钥。有效 `week_win` 写入只读 `weekly_wins`；
该字段缺失或无效时仍更新其他有效角色数据并保留旧胜场，请求失败或 `ok: false` 保留全部旧角色
数据。该操作不会改写预约账号快照或密码。API 密钥是普通设置，保存在 `settings.json` 并进入完整
备份，仅在界面掩码显示，不宣称经过加密。

## Backup and restore

新备份格式为 v2：数据库与 `settings.json` 必选；只有
`legacy_credential_migration` 尚有记录时，才额外要求并包含成对的旧 `vault.hold` 与
`vault.salt`。入口 verifier 位于数据库，所以恢复 v2 会恢复备份时的入口密码；忘记后仍可无损
重置。旧 Stronghold 文件默认永久保留，不自动清理。

恢复同时接受 v1 与 v2。解压前校验路径、大小、哈希和清单，暂存后校验数据库、设置以及存在时的
Stronghold 文件；应用前先创建当前版本的 v2 预恢复备份。真正替换发生在重启早期，失败使用回滚
目录恢复原文件，不覆盖可用数据。v2 旧备份会在独立暂存副本中验证从 `0001` 开始的连续、校验
和匹配且至少到 `0005` 的可信前缀，再补跑缺失 migration 到当前版本；备份原件和正式数据库不变。
v1 数据库随后由正常 migration 升级到当前 `0008`。恢复会同时恢复当时的恢复问题和答案 verifier，
但入口保护仍不是数据加密。

Migration `0008` 删除 `account_profiles.usage_info` 并新增可空、非负整数 `weekly_wins`。这是有意的
破坏性升级：旧人工“本周”文本以及编辑、清空和客户端自动周切换能力不再保留；恢复旧备份后补跑
该 migration 时也会删除这些文本，因此正式升级或恢复前必须先创建完整备份。
