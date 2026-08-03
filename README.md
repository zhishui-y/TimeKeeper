# 时约管家 TimeKeeper

面向陪玩排班、账号档案和收益回顾的 Windows 本地桌面应用。

## 功能

- 今日工作台与日/周/月排班日历
- 业务、娱乐两种预约模式、时间冲突提示和预约进度自动流转
- 最近联系人模板，以及 YY / QQ 语音和 YY 频道记录
- 预约可不填账号、从账号档案快捷带入，或保存仅供该预约使用的一次性账号
- 服务进度与结算状态独立管理
- 日、周、月收益与待结金额统计
- Stronghold 加密账号密码库，支持关闭空闲自动锁定和安全修改主密码
- 账号表格支持持久化自定义列宽，并按北京时间每周清理“本周”安排
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

SQLite 仅由 Rust 数据层访问。账号档案密码和预约内账号密码都不进入 SQLite、前端 DTO、
日志或错误信息，而是分别存入 Stronghold。账号档案只在新建预约时作为资料和密码来源；
保存后的预约拥有独立副本，之后修改档案不会改写历史预约。密码库锁定后仍可使用非敏感功能，
复制密码及新增、修改或删除秘密前需使用主密码解锁；忘记主密码无法恢复。
主密码最低允许4个字符，但为降低本地保险库文件被复制后遭穷举的风险，建议使用8位以上。
修改主密码会重新加密当前密码库，但此前导出的完整备份仍需使用导出时的旧主密码。

开发浏览器模式使用内存演示数据，不会读写正式数据库或密码库。正式数据保存在 Tauri
应用本地数据目录中，自动备份默认保留最近30份。角色数据服务器基础 URL 是非秘密设置，
保存在 `settings.json` 并随完整备份导出；浏览器演示模式只返回确定性模拟结果，不发起网络请求。

### 从旧版本升级

预约内嵌账号使用数据库 migration `0004`。升级前请先在旧安装版中创建一份完整备份，并保留
旧安装包；不要只复制正在使用的 SQLite 文件。安装新版本后先解锁一次密码库，让应用把旧预约
关联的档案密码复制为预约独立密码，并核对界面报告的迁移成功、缺失和待重试数量。确认无误后，
再创建一份新版本完整备份。

新版本恢复功能只接受包含 `0004` 当前结构的备份。旧备份不会在恢复过程中自动迁移；需要恢复
旧备份时，应使用保留的旧安装版恢复并完成升级，再由新版本创建备份。任何恢复操作都会先校验
清单、数据库、设置和 Stronghold 文件，并保存当前版本，失败时不会覆盖现有数据。
