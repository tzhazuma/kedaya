/**
 * `techpie`（TechPie 整合 / 校园能力）用例层出口。
 *
 * 四个用例覆盖 Phase 0 的全部客户端能力：
 *
 * | 用例 | 端点 | 说明 |
 * | --- | --- | --- |
 * | `listBindings` | `GET /techpie/links` | 绑定管理（**不含凭证**） |
 * | `capabilities` | `GET /techpie/capabilities` | 能力清单 + `CAMPUS_BINDING_REQUIRED` **引导** |
 * | `bindCampus` | `POST/DELETE /techpie/links[/:id]`、`POST .../renew` | 绑定动作（日志脱敏的第一现场） |
 * | `campusCard` | `GET /campus-card/items`、`POST /campus-card/payment-code` | 校园卡（独立 OPENID 通道） |
 *
 * ⚠️ 这里**没有** webview-session 用例：契约 §11.10-F 已裁决
 * 小程序 `web-view` 无法注入 cookie，**I3 在本端没有出口**。
 * 校园系统走 W4（用户在校园系统页面自己登录）。
 */
export * from './bindCampus'
export * from './campusCard'
export * from './capabilities'
export * from './listBindings'
