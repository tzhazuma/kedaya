# 可达鸭开发代理约定

## 项目与工作目录

- 仓库是 npm workspaces：`apps/miniapp` 为 Taro 4.3 + React 18 微信小程序，`apps/web` 为 Next.js，`apps/mobile` 为 Flutter，`services/api` 为 NestJS，`packages/contracts` 为共享契约。
- 微信开发者工具应导入 `apps/miniapp`，其 `project.config.json` 的 `miniprogramRoot` 指向 `dist/`。不要把 `dist/` 当作源码修改。
- 先看 `git status`，保留其他人的未提交改动。网页目录还须遵守 `apps/web/AGENTS.md`。

## 小程序开发与验证

1. 用 `npm run typecheck -w @kedaya/miniapp` 检查类型。
2. 用 `npm run build:weapp -w @kedaya/miniapp` 编译。脚本先写入 `.weapp-stage/`，校验后发布到 `dist/`，避免开发者工具读到半成品。
3. 需要真实模拟器验证时，用 `npm run smoke:weapp -w @kedaya/miniapp`。测试应进入首页、读取渲染文字并产生截图；成功退出才可报告通过。
4. 只用命令行运行测试，不直接操控用户桌面。微信开发者工具的 CLI/HTTP 调用和自动化权限需要用户在安全设置中自行开启；若未开启，记录真实错误并给出手动步骤。
5. 测试产物放在 `apps/miniapp/artifacts/`，不要提交截图或日志。

## CLI 与边界

- Windows 上设置 `WECHAT_DEVTOOLS_CLI` 为本机 `cli.bat` 的绝对路径；本机示例为 `D:\Software\WeixinDevTools\cli.bat`。其他电脑不要依赖这个路径。
- `WECHAT_AUTOMATION_PORT` 可指定自动化端口，默认 `9420`。如安全设置配置了 CLI token，使用环境变量 `WECHAT_DEVTOOLS_CLI_TOKEN`，不要写进仓库。
- `open`/`auto` 用于本地项目；`preview` 生成预览二维码；`upload` 会上传版本。**未经用户明确要求，不运行 `upload`，不发布小程序，不更改生产环境配置。**
- 模拟器、真机与静态编译是不同验证层级。任何一步失败都如实报告，不能把构建成功说成界面测试通过。

详细配置和手动步骤见 `docs/development/wechat-agent-automation.md`。
