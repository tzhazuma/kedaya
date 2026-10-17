# 项目开发约定

当前交付范围为微信小程序、Web 和 NestJS API。保留工作区中已有修改，不回退其他人的工作。

微信小程序的 UI 固定使用 **Taroify** 与可达鸭黄色设计体系；修改该端前必须阅读
`apps/miniapp/AGENTS.md` 和 `docs/miniapp-ui.md`。后续新增页面与控件沿用该规范。
Web 与小程序是独立客户端，避免为单端视觉调整改变另一个端的主题。

账号体系已在小程序端与后端实现，共三条并列的登录入口：**校园 CAS**（后端已接线，
当前为开发用 Mock 适配器，真实对接点见 `mock-campus-auth.provider.ts` 顶部注释）、
**邮箱 + 密码**（注册/登录/改密/找回）、**微信小程序快捷登录**（首次自动建号，可后补邮箱密码）；
账号自助包括改昵称/头像、绑定/解绑微信（至少保留一种登录方式）。
六个业务模块（跳蚤、宿舍矛盾、跑腿、找搭子、失物招领、论坛）小程序端与后端已实现；
Web 门户目前只交付拼单垂直切片与管理后台占位。
Web 的模块交付状态以 `apps/web/src/domain/models/delivery.ts` 为**唯一真相**
（宫格角标与模块说明页都由它驱动，别在组件里另写一份判断）。本地启动、数据库与真实联调方式见 `docs/local-development.md`。

提交前请确保以下命令全绿：

```bash
npm run typecheck -w @kedaya/api && npm run test -w @kedaya/api && npm run lint -w @kedaya/api
npm run typecheck -w @kedaya/miniapp && npm run test -w @kedaya/miniapp && npm run lint -w @kedaya/miniapp
npm run build:weapp
npm run typecheck -w @kedaya/web && npm run test -w @kedaya/web && npm run lint -w @kedaya/web
```
