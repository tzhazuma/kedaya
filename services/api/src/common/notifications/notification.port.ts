/**
 * 站内信端口 —— 跨模块通用的「给某人写一条通知」能力。
 *
 * 为什么放在 `common/` 而不是 notifications 模块里：
 *   拼单 / 跑腿 / 跳蚤 / 论坛都会在自己的领域动作发生时给相关人写通知。
 *   如果它们直接 import 通知模块的 Service，模块之间就彼此知道了实现细节
 *   （例如"通知表长什么样""要不要发订阅消息"）。
 *   这里只暴露一个**端口**（接口 + 注入 token），实现由 `NotificationModule` 提供，
 *   业务模块只依赖这个端口 —— 与 `CAMPUS_DATA_PORT` 是同一套依赖倒置思路。
 *
 * 两条硬规则（实现方必须遵守，见 `NotificationService.notify`）：
 *   1. **通知永远不能让主流程失败**：写通知是 best-effort。
 *      用户参团已经成功了，不该因为"通知写失败"就返回 500 ——
 *      那会让用户重试，反而产生重复参团。实现方必须吞掉异常并记日志。
 *   2. **通知正文不得承载敏感数据**：列表页会明文展示 title/body，
 *      因此实名、余额明细、宿舍矛盾内容、心理预约诉求一律不得写入。
 *      只写"发生了什么 + 去哪看"，细节留在原模块里按权限取。
 */

export interface NotifyInput {
  /** 收件人（KedaYa 用户 id）。必填，为空时实现方直接忽略。 */
  userId: string;
  title: string;
  body: string;
  /**
   * 业务来源，前端据此选图标与分组。
   * 取值见 `NOTIFICATION_SOURCES`，不要"解析标题猜来源"。
   */
  source: string;
  /**
   * 点击后跳转的小程序页面路径（可带查询串），取自 `@kedaya/contracts` 的
   * `MINIAPP_PAGES`。省略表示这条通知只是"告知"，没有可跳转的目标 ——
   * 前端**必须**能处理这种情况（不可点时不要假装可点）。
   */
  link?: string;
}

export interface NotificationPort {
  /** 写一条或多条通知。best-effort：失败只记日志，不抛给调用方。 */
  notify(input: NotifyInput | readonly NotifyInput[]): Promise<void>;
}

export const NOTIFICATION_PORT = Symbol('KEDAYA_NOTIFICATION_PORT');

/**
 * 由「静态页面路径 + 资源 id」拼出详情页深链。
 *
 * 为什么在服务端拼：通知是**落库**的，链接一旦写错就永远不会报错，
 * 用户点进去只会静默无反应。集中在这里拼，配合 `@kedaya/contracts` 的
 * `MINIAPP_PAGES` 与小程序的 `routes.test.ts` 闸门，路径才不会漂移。
 */
export function miniappDetailLink(pagePath: string, id: string): string {
  return `${pagePath}?id=${encodeURIComponent(id)}`;
}
