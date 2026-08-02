# 时约管家 TimeKeeper

面向陪玩排班、账号档案和收益回顾的 Windows 本地桌面应用。

## 功能

- 今日工作台与日/周/月排班日历
- 业务、娱乐两种预约模式、时间冲突提示和预约进度自动流转
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

SQLite 仅由 Rust 数据层访问。账号密码不进入 SQLite，也不会出现在账号列表响应中，
而是按账号档案 ID 存入 Stronghold。密码库锁定后仍可使用非敏感功能，复制密码及修改秘密前需使用主密码解锁；忘记主密码无法恢复。
主密码最低允许4个字符，但为降低本地保险库文件被复制后遭穷举的风险，建议使用8位以上。
修改主密码会重新加密当前密码库，但此前导出的完整备份仍需使用导出时的旧主密码。

开发浏览器模式使用内存演示数据，不会读写正式数据库或密码库。正式数据保存在 Tauri
应用本地数据目录中，自动备份默认保留最近30份。角色数据服务器基础 URL 是非秘密设置，
保存在 `settings.json` 并随完整备份导出；浏览器演示模式只返回确定性模拟结果，不发起网络请求。
