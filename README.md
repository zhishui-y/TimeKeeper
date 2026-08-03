# 时约管家 TimeKeeper

面向陪玩排班、账号档案和收益回顾的 Windows 本地桌面应用。

## 功能

- 今日工作台与日/周/月排班日历
- 业务、娱乐两种预约模式、时间冲突提示和预约进度自动流转
- 最近联系人模板，以及 YY / QQ 语音、YY 频道记录与频道号快捷复制
- 预约可不填账号、从账号档案快捷带入，或保存仅供该预约使用的一次性账号
- 预约进度统一展示；业务预约在服务完成后进入待结算，结算后显示已完成
- 日、周、月已结收益与待结算场次统计
- 进程级入口密码；账号与预约独立密码随业务数据统一管理
- 预约历史分页、跨页全选与批量永久删除，面向 10,000 条记录优化
- 预约记录与账号表格支持持久化自定义列宽，账号按北京时间每周清理“本周”安排
- 账号档案可按当前列表、选中账号或单行从可配置服务器更新角色装分与分数
- `account.xlsm` 预览式导入、重复数据防护
- 系统预约提醒以及自动、手动备份

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

需要验收真实 Tauri 命令但不能触碰正式数据时，可为 debug 构建指定独立的绝对目录：

```powershell
$env:TIMEKEEPER_DATA_DIR = Join-Path $env:TEMP "timekeeper-acceptance-$([guid]::NewGuid())"
pnpm tauri dev
```

`TIMEKEEPER_DATA_DIR` 只在 debug 构建中生效；release/安装版始终使用系统应用数据目录。

## 质量检查

```powershell
pnpm typecheck
pnpm test
pnpm lint
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
pnpm tauri build
```

## 数据与安全

SQLite 仅由 Rust 数据层访问。账号档案密码和预约内账号密码以明文保存在 SQLite 的独立基础设施
表中；入口密码只在 `app_access` 中保存 Argon2id verifier。入口页用于防止他人随手打开应用，
**不会加密 SQLite、备份或其中的业务密码，也不能抵御拥有本机文件读取权限的攻击者**。
忘记入口密码时可无损重置 verifier，不会删除业务数据或凭据。入口密码最低允许 4 个字符，
界面建议使用 8 位以上。

账号档案只在新建预约时作为资料和密码来源；保存后的预约拥有独立密码副本，之后修改档案不会
改写历史预约。密码会随有类型的业务 DTO 返回前端，但默认统一显示为固定掩码，逐行临时显示；
切页、筛选、导航或锁定后恢复掩码。密码不得进入日志、错误信息、Excel 预览、备份清单或测试快照，
复制到剪贴板后仍会在 30 秒后按内容匹配清理。

进程启动时默认锁定；托盘隐藏和恢复不改变当前解锁状态，手动锁定或真正退出并重启后需要再次验证。
开发浏览器模式使用内存演示数据，不会读写正式数据库。正式数据保存在 Tauri 应用本地数据目录中，
自动备份默认保留最近 30 份。角色数据服务器基础 URL 是非秘密设置，保存在 `settings.json` 并随
完整备份导出；浏览器演示模式只返回确定性模拟结果，不发起网络请求。

### 从旧版本升级

数据库 migration `0005` 新增入口 verifier、SQLite 凭据表和精确的旧凭据迁移队列。首次升级可用
旧主密码只读打开一次 Stronghold：所有可用密码在一个 SQLite 事务中迁移，成功后该密码同时成为
入口密码。错误密码或写入失败会整体回滚，旧 `vault.hold` / `vault.salt` 不会被改写或自动删除。

若忘记旧主密码，可先设置新入口密码并继续使用业务数据；未迁移密码显示为空，迁移队列与旧文件
保留，日后仍可重试。之后新建、修改或明确删除的密码优先，旧迁移不会覆盖。

备份格式 v2 必须包含数据库与设置；仅当旧凭据迁移队列未清空时，额外包含成对的旧 Stronghold
快照和盐文件。恢复仍兼容 v1，并在覆盖前校验清单、保存当前版本，失败时回滚。恢复 v2 会连同
数据库恢复当时的入口密码 verifier；若忘记该密码，仍可无损重置。
