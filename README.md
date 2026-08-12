# 时约管家 TimeKeeper

面向陪玩排班、账号档案和收益回顾的 Windows 本地桌面应用。

## 功能

- 今日工作台与日/周/月排班日历
- 业务、娱乐两种预约模式、时间冲突提示和预约进度自动流转
- 最近联系人模板，以及 YY / QQ 语音、YY 频道记录与频道号快捷复制
- 预约可不填账号、从账号档案快捷带入，或保存仅供该预约使用的一次性账号
- 服务进度与结算状态在底层独立保存，界面统一显示“已预约、进行中、待结算、完成、已取消”
- 排班日历提供会话级隐私开关，隐藏时只显示日期、时间或“待定”，离开页面后自动恢复
- 日、周、月已结收益与待结算场次统计，支持按收款渠道或联系人查看柱状图、饼图
- 进程级入口密码；账号与预约独立密码随业务数据统一管理
- 预约历史分页、跨页全选与批量永久删除，面向 10,000 条记录优化
- 预约记录与账号表格支持持久化自定义列宽，账号表格只读展示服务端返回的本周胜场
- 账号档案可按当前列表、选中账号或单行从可配置服务器逐项更新角色装分、分数与本周胜场
- `account.xlsm` 预览式导入、重复数据防护
- 系统预约提醒以及自动、手动备份
- Excel、备份恢复和角色刷新由应用级长任务协调器管理，切换页面后仍可查看进度

业务日期和预约时间统一采用北京时间民用时间：`serviceDate` 为 `YYYY-MM-DD`，`startsAt` / `endsAt`
为不带时区偏移的 `YYYY-MM-DDTHH:mm:ss`；`createdAt` / `updatedAt` 等审计字段仍是 RFC3339 instant。

## 开发环境

- Node.js 24+
- pnpm 11+
- Rust stable
- Visual Studio 2022 Build Tools，包含 Desktop development with C++
- Microsoft Edge WebView2 Runtime

```powershell
pnpm install
pnpm dev
pnpm tauri dev
```

需要验收真实 Tauri 命令但不能触碰正式数据时，可为进程显式指定独立的绝对目录：

```powershell
$env:TIMEKEEPER_DATA_DIR = Join-Path $env:TEMP "timekeeper-acceptance-$([guid]::NewGuid())"
pnpm tauri dev
```

`TIMEKEEPER_DATA_DIR` 在 debug 与 release 构建中都生效，且拒绝相对路径；未设置时仍使用系统应用数据目录。该变量只用于开发、验收与故障隔离，不写入应用设置。

## 质量检查

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --release --manifest-path src-tauri/Cargo.toml
cargo audit --file src-tauri/Cargo.lock
pnpm audit --prod --audit-level moderate
pnpm tauri build
```

`pnpm typecheck` 同时检查 Vue 应用和 Vite、Vitest、Playwright、E2E 等 Node 侧配置。覆盖率门槛固定为
Statements 75%、Branches 73%、Functions 72%、Lines 78%，ESLint 不允许 warning。Windows CI
执行上述格式、lint、双类型检查、覆盖率、构建、Rust 检查/release 测试以及两侧依赖审计。
`pnpm build` 还会校验 bundle 预算：初始 JavaScript 不超过 70 KiB gzip，收益图表 chunk 不超过
205 KiB gzip；Windows CI 使用同一门槛。

RustSec 仅对 `RUSTSEC-2023-0071` 设有受监控例外：`rsa` 只是 SQLx MySQL 的可选锁文件条目，
TimeKeeper 只启用 SQLite，Windows 生产依赖树不包含 `rsa`。CI 会在审计前验证该不可达约束；
一旦 `rsa` 进入生产依赖树，质量门将立即失败。

## 数据与安全

SQLite 仅由 Rust 数据层访问。账号档案密码和预约内账号密码以明文保存在 SQLite 的独立基础设施
表中；入口密码只在 `app_access` 中保存 Argon2id verifier。入口页用于防止他人随手打开应用，
**不会加密 SQLite、备份或其中的业务密码，也不能抵御拥有本机文件读取权限的攻击者**。
忘记入口密码时可通过恢复问题无损重置 verifier，不会删除业务数据或凭据。首次设置入口密码时
必须同时设置恢复问题和答案；旧版本没有恢复问题的用户保留一次旧式确认兼容，成功后必须补设。
入口密码最低允许 4 个字符，界面建议使用 8 位以上。恢复问题明文用于展示，答案只保存独立盐的
Argon2id verifier；恢复问题不是数据加密。

账号档案只在新建预约时作为资料和密码来源；保存后的预约拥有独立密码副本，之后修改档案不会
改写历史预约。密码会随有类型的业务 DTO 返回前端，但默认统一显示为固定掩码，逐行临时显示；
切页、筛选、导航或锁定后恢复掩码。密码不得进入日志、错误信息、Excel 预览、备份清单或测试快照，
复制到剪贴板后仍会在 30 秒后按内容匹配清理。

编辑账号档案时，凭据操作是明确的 `keep | replace | remove` 三态：空密码输入表示保留旧密码，
删除必须显式确认；新建档案只接受非空的 `replace`。删除凭据会在同一事务中清除凭据及对应旧迁移
队列，避免旧 Stronghold 密码在之后重新覆盖。

进程启动时默认锁定；托盘隐藏和恢复不改变当前解锁状态，手动锁定或真正退出并重启后需要再次验证。
开发浏览器模式使用内存演示数据，不会读写正式数据库。正式数据保存在 Tauri 应用本地数据目录中，
自动备份默认保留最近 30 份。角色数据服务器基础 URL 和 API 密钥都保存在 `settings.json` 并随
完整备份导出；API 密钥仅在界面中掩码显示，未经过加密。浏览器演示模式只返回确定性模拟结果，
不发起网络请求。

### 从旧版本升级

数据库 migration `0005` 新增入口 verifier、SQLite 凭据表和精确的旧凭据迁移队列。首次升级可用
旧主密码只读打开一次 Stronghold：所有可用密码在一个 SQLite 事务中迁移，成功后该密码同时成为
入口密码。错误密码或写入失败会整体回滚，旧 `vault.hold` / `vault.salt` 不会被改写或自动删除。

若忘记旧主密码，可先设置新入口密码并继续使用业务数据；未迁移密码显示为空，迁移队列与旧文件
保留，日后仍可重试。之后新建、修改或明确删除的密码优先，旧迁移不会覆盖。

Migration `0006` 为预约账号补充来源与角色名历史快照。旧记录仅在账号名唯一匹配档案时标记为
档案来源；无匹配或重复匹配均按一次性账号处理，不建立档案外键。

Migration `0007` 新增单例恢复记录。恢复答案按去首尾空白、合并连续空白并 Unicode 小写化后
校验和派生；修改恢复问题必须再次验证当前入口密码。外观设置（系统字体预设或已安装字体名、
14–18px 基准字号）与完整备份一起保存，启动时先应用再显示首屏。

Migration `0008` 永久删除账号档案原有的人工“本周”文本及相关编辑、清空和客户端周切换功能，
改为可空、非负整数 `weekly_wins`。升级或恢复旧备份前应先创建完整备份；恢复旧备份到新版本时，
其中的旧“本周”文本也会在升级 migration 中删除，无法由新版本恢复。

Migration `0009` 把预约提醒分钟数统一限制为 `0..=1440`；升级时历史越界值会转为关闭提醒，并由
数据库 trigger 拒绝之后的非法写入。启动恢复通知遇到单条异常记录时只跳过该记录并报告，不会
导致应用 panic。

Migration `0010` 将历史超出 JavaScript 安全整数范围的分数和金额原始十进制文本写入修复记录；
活动分数转为空，异常金额转为空并改为待结算。解锁后会显示可定位的待修复项，修正实体后原记录
保留并标记为已解决。应用还会在数据目录持有进程级独占锁，同一目录不能被两个实例同时写入。

备份格式 v2 必须包含数据库与设置；仅当旧凭据迁移队列未清空时，额外包含成对的旧 Stronghold
快照和盐文件。恢复仍兼容 v1，并在覆盖前校验清单、保存当前版本，失败时回滚。恢复 v2 会连同
数据库恢复当时的入口密码 verifier、恢复问题和答案 verifier；若忘记该密码，仍按恢复流程重置。
恢复 v2 备份时，旧版本从 `0001` 开始、校验和匹配且至少到 `0005` 的可信 migration 前缀会在
独立暂存副本中补跑缺失 migration，再按当前 schema 和行约束验收；备份原件和正式数据库不会被
修改。

生产 WebView 使用固定 CSP：脚本、默认资源仅允许 `'self'`，样式额外允许 `'unsafe-inline'`，图片和
字体额外允许 `data:`，网络只允许 Tauri IPC；object、base、form、frame、worker 均禁止。开发模式
仅额外允许本地开发连接与 `ws:`，Vite 同步发送相同开发响应头。
