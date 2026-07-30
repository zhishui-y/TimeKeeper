# TimeKeeper repository guidance

## Communication

- 默认使用简体中文回答，代码标识符和必要的技术术语保持原文。
- 保持独立判断。发现需求冲突、安全风险或不合理实现时直接指出，并给出可执行的替代方案。
- 先说明已确认的事实，再说明推断；不要把未验证的判断写成结论。

## Product boundary

- 产品名称为“时约管家”，项目名为 `TimeKeeper`，定位是 Windows 本地单机桌面应用。
- 第一版解决预约排班、账号档案、密码保护、收益回顾、Excel 迁移、提醒和备份。
- 第一版只有两个领域模型：`Appointment` 和 `AccountProfile`。设置、导入预览、保险库状态和备份清单属于基础设施 DTO，不要提前拆成新的领域模型。
- 第一版不做云同步、移动端、多用户、周期预约、部分结算、退款账本和独立客户模型。

开始修改前先阅读：

- `README.md`
- `docs/architecture.md`
- `docs/command-contract.md`

## Architecture rules

- 技术栈固定为 Tauri 2、Vue 3、TypeScript、Vite、SQLite 和 Rust。
- Vue 使用 Composition API、`<script setup lang="ts">`、Pinia 和 Vue Router。
- 路由页面只负责组合；业务状态、数据加载和副作用放在对应 composable；纯日期和格式化逻辑放在 utility。
- 前端只能通过有类型的 Tauri command 或浏览器演示客户端访问数据，不得直接执行 SQL、读取 Stronghold 或操作正式应用数据目录。
- SQLite、Excel 解析、Stronghold、备份文件和敏感剪贴板操作必须留在 Rust 端。
- Rust DTO 使用 camelCase JSON，并与 `src/types/domain.ts` 保持一致。
- 扩展既有命令分组和模块，不要绕过 `appointments`、`accounts`、`reports`、`vault`、`excelImport`、`backup`、`settings` 的边界。

## Domain invariants

- `Appointment.mode` 只能是 `entertainment` 或 `business`。
- 娱乐预约不保存账单，结算状态固定为 `not_applicable`，不计入收益。
- 业务预约的服务进度与结算状态相互独立；只有 `settled` 金额计入已结收益，待结金额单独统计。
- 金额以人民币分整数存储，禁止使用浮点数持久化金额。
- 日期必填；结束时间不能脱离开始时间存在；结束时间早于开始时间时按跨天处理。
- 只有日期的预约进入待定时段；取消预约不参与冲突检查；时间冲突只警告，不阻止保存。
- 预约可以保留账号的非敏感快照，但不得复制密码；历史快照不随账号档案更新。
- `AccountProfile` 的密码是核心数据，但不得出现在账号列表、详情 DTO、日志、错误信息、备份清单或 Excel 预览响应中。
- 旧 Excel 数据字段不完整时允许导入并标记待完善，不能为满足强类型而静默丢弃记录。

## Security and user data

- 密码只存入 Stronghold，账号元数据存入 SQLite。不要把真实密码写入源码、测试快照、日志或提交记录。
- 不得降低 Argon2、scrypt 或 Stronghold 的安全参数来换取速度。开发模式的依赖级优化只能改变编译优化级别，不能改变算法、工作因子或保险库格式。
- 主密码派生和 Stronghold 读写属于阻塞计算，必须在后台阻塞任务中执行，不能占用 Tauri UI 线程。
- 未经用户明确要求，绝不删除、移动、重建或覆盖正式应用数据目录中的数据库、`vault.hold`、`vault.salt` 或备份。
- 保险库、备份和恢复测试必须使用独立临时目录；测试结束后只能清理本次测试创建的路径。
- 恢复备份前必须先校验清单并保存当前版本；失败时不得覆盖现有数据。
- 查看密码只允许短时显示；复制密码后按既定时限清理剪贴板。

## Implementation practice

- 先检查 `git status` 和相关代码，再做最小范围修改；不得回退用户已有的无关改动。
- 优先沿用现有组件、composable、Rust module、错误类型和设计令牌，避免无必要的抽象或依赖。
- 数据迁移使用版本化 SQLite migration；已发布或已被使用的 migration 不要原地改写，应新增 migration。
- Excel 导入保持“预览后提交”的事务边界，预览 token 和解析出的秘密只存在 Rust 内存中。
- 修复缺陷时优先补充可复现该缺陷的测试；测试覆盖与修改风险相匹配。
- 注释只解释不明显的约束或原因，不重复代码表面行为。

## Verification

采用渐进式验证。验证强度由修改阶段、影响范围和风险共同决定；不要把全量命令当作每次小修改后的固定动作。

### 迭代阶段

- 每轮保持小范围修改，优先运行能覆盖当前改动的最窄检查或相关测试。
- 前端优先运行受影响组件、composable 或 utility 的相关单元测试；涉及类型或构建边界时再运行类型检查或构建。
- Rust 优先运行受影响 module 的相关测试；涉及公共 DTO、command、feature 或条件编译时再扩大到 check 或 clippy。
- 纯文档、注释、文案或不影响布局的局部样式修改，不要求运行前后端全量测试；检查 diff 和受影响页面即可。
- 某项检查已经通过，且后续修改没有影响它所覆盖的范围时，不要重复运行。
- 局部检查出现跨模块失败、无法解释的回归或影响范围扩大时，再升级验证范围。

### 交付阶段

完成一项可交付成果后，对本次受影响的技术栈统一执行一次交付检查，不要在每个小补丁后重复执行。

前端交付检查：

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
```

- 另行运行本次改动直接相关的前端单元测试；只有影响范围广、无法可靠筛选或进入全量回归阶段时才运行完整 `pnpm test`。

Rust 交付检查：

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

- 另行运行本次改动直接相关的 Rust 测试；普通局部修改不要求每次运行完整 release 测试。
- 只修改前端时不运行 Rust 检查，只修改 Rust 时不运行前端检查；跨越前后端契约时两侧都检查。

### 全量与高风险回归

- 发布前、跨模块重构、依赖或构建配置变更、SQLite migration、保险库、备份恢复、Excel 导入等高风险修改，运行相关技术栈的完整测试套件。
- 前端全量测试使用 `pnpm test`。
- Rust 全量 release 测试使用：

```powershell
cargo test --release --manifest-path src-tauri/Cargo.toml
```

- 修改保险库时必须使用临时保险库运行真实初始化、锁定和解锁回归；不要用正式保险库做测试。
- 修改用户界面或交互时，在功能稳定后使用 Playwright 检查受影响页面。涉及响应式布局、全局壳层、弹窗、抽屉或导航时检查 `1440x900`、`1280x720` 和 `1100x700`；纯文案、颜色或不影响布局的交互修改可只检查一个代表性视口。
- Windows 通知和安装行为只能在安装后的应用中作最终验收；开发模式结果不能替代安装版验收。
- 开发启动命令为 `pnpm tauri dev`。启动前先检查是否已有开发服务，避免重复占用端口或启动多个桌面进程。

## Git hygiene

- 不提交 `node_modules`、`dist`、`src-tauri/target`、`output`、测试报告、本地数据库、保险库、备份或任何真实 Excel 账本。
- 不使用 `git reset --hard`、`git checkout --` 等方式覆盖未确认的工作区修改。
- 一个提交应对应一个可说明、可验证的成果；提交信息使用简洁的祈使句或明确的基线说明。
- 除非用户明确要求，不创建提交、不改写历史、不推送远端。

## Completion criteria

- 用户要求的流程已经实现并经过相应自动测试或人工验收。
- 数据模型、安全边界和命令契约没有被意外破坏。
- 相关文档与行为一致，生成物和敏感数据未进入 Git。
- 交付说明包含改动内容、验证结果和仍需人工验收的事项。
