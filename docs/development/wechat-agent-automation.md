# 微信小程序 Agent 自动化开发

## 本机与项目

- 小程序源码：`apps/miniapp/src/`；Taro 4.3、React 18、TypeScript；npm workspace 名称 `@kedaya/miniapp`。
- Taro 构建结果：`apps/miniapp/dist/`。项目根是 `apps/miniapp/`，`project.config.json` 已指向 `dist/`。
- Windows 开发者工具 CLI：本机检测到 `D:\Software\WeixinDevTools\cli.bat`。程序文件版本为 `2.02.0`；该版本的实际 CLI 选项以 `cli.bat <命令> --help` 为准。
- 本机命令行已检测到 VS Code `1.134.0`、Codex CLI `0.162.1`、Node.js `24.15.0`。
- `miniprogram-automator@0.13.0` 固定为项目开发依赖，用于 WebSocket 自动化。测试只在本机执行。

2026-10-17 的真实检查结果：`9420` 没有监听；`smoke:weapp` 调用 CLI 后返回 `IDE service port disabled`，因此尚未连接模拟器，也没有生成首页截图。曾通过命令行向 CLI 输入 `y`，设置仍未改变。下面的安全设置步骤需要手动完成。

## 日常命令

在 VS Code 中打开仓库根目录，使用 PowerShell 终端：

```powershell
npm install
$env:WECHAT_DEVTOOLS_CLI = 'D:\Software\WeixinDevTools\cli.bat'
npm run typecheck -w @kedaya/miniapp
npm run build:weapp -w @kedaya/miniapp
npm run smoke:weapp -w @kedaya/miniapp
```

也可以通过 VS Code 的“终端 → 运行任务”选择“小程序：类型检查 / 构建 / 真实模拟器冒烟”。

构建先完成 `.weapp-stage/`，验证整包后才更新 `dist/`。冒烟脚本通过 CLI `auto` 启动自动化，用官方 SDK 打开 `presentation/pages/home/index`，读取“可达鸭”文字，并将真实截图写入 `apps/miniapp/artifacts/home.png`。该目录不会提交。只有路径、文字和截图三个检查全部通过才会输出 `PASS`。

## CLI 能力与限制

本机 `cli.bat --help` 及各子命令 `--help` 显示：

| 能力 | 本机命令 | 用途 |
| --- | --- | --- |
| 打开工程 | `open --project <apps/miniapp>` | 在 IDE 打开工程并由 IDE 编译；当前 CLI 无独立 `compile` 子命令 |
| 自动化 | `auto --project <apps/miniapp> --auto-port 9420` | 开启 WebSocket 自动化，再由 `miniprogram-automator` 连接 |
| 预览 | `preview --project <apps/miniapp> --qr-format image --qr-output <path>` | 生成本地预览二维码；需要登录及有效 AppID |
| 自动预览 | `auto-preview --project <apps/miniapp>` | 自动预览；需要同样的服务端口与账号条件 |
| 上传 | `upload --project <apps/miniapp>` | 上传版本；开发代理未经用户明确要求不得执行 |

`--port` 是 IDE HTTP 服务端口，`--auto-port` 是自动化 WebSocket 端口，两者不同。默认测试使用 `9420`，可用 `$env:WECHAT_AUTOMATION_PORT = '9421'` 更改。若已有自动化实例，可明确设置 `$env:WECHAT_AUTOMATION_WS = 'ws://127.0.0.1:9420'` 直接连接；连接前须确认它运行的是本工程。

## 用户需要手动完成的步骤

1. 在微信开发者工具中登录开发账号并导入 `apps/miniapp`。确认该账号有对应小程序的开发权限；不要把真实 AppID 或 token 提交到 Git。
2. 在开发者工具的“设置 → 安全设置”中将**服务端口**设为“开启”（CLI 错误明确要求这一项），并允许自动化连接。不同工具版本的文字可能略有差异。若设置了访问 token，在终端设置 `WECHAT_DEVTOOLS_CLI_TOKEN` 环境变量。
3. 如果工具已在关闭服务端口的状态下启动，手动退出并重新打开工具，再运行上面的构建和冒烟命令。若出现项目信任提示，确认本工程。
4. 在终端检查结果。`PASS` 和非空 `artifacts/home.png` 表示真实模拟器冒烟通过；`FAIL` 时阅读 CLI 输出。构建通过只说明产物完整，不代表模拟器已通过。

本流程不修改生产环境配置，也不运行 `upload`。预览二维码只应在需要真机预览、且已确认项目和账号后单独生成。
