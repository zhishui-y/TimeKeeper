# 时约管家 TimeKeeper

面向陪玩排班、账号档案和收益回顾的 Windows 本地桌面应用。

## 功能

- 今日工作台与日/周/月排班日历
- 业务、娱乐两种预约模式和时间冲突提示
- 服务进度与结算状态独立管理
- 日、周、月收益与待结金额统计
- Stronghold 加密账号密码库
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
而是按账号档案 ID 存入 Stronghold。应用启动后需使用主密码解锁；忘记主密码无法恢复。

开发浏览器模式使用内存演示数据，不会读写正式数据库或密码库。正式数据保存在 Tauri
应用本地数据目录中，自动备份默认保留最近30份。
