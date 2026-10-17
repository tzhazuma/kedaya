# 04 · 客户端架构

当前客户端为 `apps/miniapp`（Taro，主端）和 `apps/web`（Next.js，门户与管理后台）。
原生手机端已移除；旧契约与 ADR 中涉及原生端的设计作为历史参考，不代表当前交付范围。
服务端契约见 [03-api-contract.md](./03-api-contract.md)，权限与隐私见
[05-security-privacy.md](./05-security-privacy.md)。

## 1. 两端分工

| 客户端 | 技术 | 运行环境 | 主要能力 |
| --- | --- | --- | --- |
| `apps/miniapp` | Taro 4 + React | 微信开发者工具、微信客户端 | 校园服务主入口、微信登录、订阅消息、分享 |
| `apps/web` | Next.js 16 App Router | 浏览器 | Web 门户、管理后台、大屏治理与审计界面 |

两端是独立应用，共享 TypeScript 契约、设计令牌与基础工具。
小程序构建输出为 `apps/miniapp/dist/`，根目录微信项目配置指向该目录；
Web 本地开发地址为 `http://localhost:3001`。

## 2. 分层与依赖

```text
presentation → application → domain ← data
                                  ↑
                              platform
```

- `app`：启动、依赖装配、路由和 Provider。
- `presentation`：页面、组件和主题，通过用例访问数据。
- `application`：用例编排、会话和状态控制。
- `domain`：模型与 port 接口，保持零框架依赖。
- `data`：API、repository、本地存储和 Mock adapter。
- `platform`：扫码、分享、通知等平台适配。

目录位于各客户端的 `src/` 下。具体文件以仓库实现为准；规划中的能力不代表已经实现。
网络请求统一经过 `data/api`，页面不直接调用网络。

## 3. 共享包

| 包 | 职责 |
| --- | --- |
| `@kedaya/contracts` | 响应信封、错误码、模块注册表与跨端类型 |
| `@kedaya/design-tokens` | 颜色、间距、圆角与字号 |
| `@kedaya/shared` | Result、整数分金额、时间和校验工具 |

设计令牌的唯一来源是 `packages/design-tokens/tokens.json`，通过
`npm run tokens` 生成 TS、CSS、SCSS 和运行时 JS。Web 消费 CSS 变量，小程序消费 SCSS / TS。
生成产物随源码提交，避免安装后首次运行依赖额外生成步骤。

模块入口、权限与敏感模块同意规则来自共享契约。身份层与校园能力绑定层独立：
已登录但未绑定校园系统是有效状态，相关功能应返回 `CAMPUS_BINDING_REQUIRED`。

## 4. 后端与 Mock

两端目标后端为 `services/api` 中的 NestJS 服务，统一前缀 `/api/v1`，
数据库使用 Prisma + PostgreSQL，辅助服务使用 Redis。
默认演示模式使用 Mock 数据，可独立运行。

小程序在 `src/app/container.ts` 装配 HTTP 与 Mock repository。
默认 `TARO_APP_USE_MOCK` 为开启，`TARO_APP_API_BASE_URL` 为占位域名。
真实联调前设置 `TARO_APP_USE_MOCK=false` 和可访问的后端基础地址，重新编译；
API 路径自身包含 `/api/v1`，基础地址不应重复包含该前缀。
详细命令见 [本机开发与启动](../local-development.md)。

管理后台的演示页面不能视为生产鉴权实现。生产服务应独立校验管理角色，
并在服务端每次执行敏感操作时检查权限。

## 5. 平台差异

| 能力 | 微信小程序 | Web |
| --- | --- | --- |
| 登录 | 微信登录能力，由服务端换取平台身份 | 浏览器登录与重定向 |
| 通知 | 用户主动订阅后的微信订阅消息 | 站内信，可按需适配 Web Push |
| 扫码 | `wx.scanCode` / Taro 适配 | 浏览器能力检测，缺失时手动输入 |
| 分享 | 微信分享入口 | `navigator.share` 或复制链接 |
| 拨号 | `wx.makePhoneCall` | `tel:` 链接 |
| 本地存储 | 微信沙箱存储，注意容量限制 | 浏览器存储；服务端会话优先 httpOnly cookie |
| 发布 | 微信包体积、合法域名与审核要求 | Web 托管与浏览器兼容性 |

站内信是通知记录的来源，推送失败不改变业务状态。心理支持与宿舍调解等敏感通知
只显示中性文案，详情在应用内读取；心理危机资源须从首页两次点击内可达。

## 6. 启动与验证

启动先读取本地缓存并呈现首屏，再在后台刷新会话和数据；避免网络阻塞首屏。
错误码与用户文案保持跨端一致，未知枚举提供 fallback，网络失败提供可恢复状态。

```bash
nvm use
npm run build:weapp
npm run build -w @kedaya/web
```

小程序还需在微信开发者工具内检查页面、路由和平台 API；Web 检查门户与管理后台页面。
构建通过不等于真实后端联调、微信真机验证或生产权限验收已完成。
