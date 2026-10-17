/**
 * 校园域名白名单的**只读视图**端口（裁决 §11.18-B 第 2 条）
 *
 * 白名单的**内容与校验**属于 `webview-session/`（I3 的唯一出口所在目录）；
 * 但"它是不是占位内容"这个事实必须**机器可见**地出现在能力清单响应里
 * （§11.18-B：与 `CAMPUS_ORIGIN`、`CAMPUS_LOCATIONS` 同一处理）。
 *
 * 于是这里放一个**只读视图**端口：能力清单（service 层）只依赖这个接口，
 * 不 import `data/`（契约 §7 依赖方向）。
 */

export interface WebviewAllowlistPort {
  /** 白名单内容是否为占位（当前恒为 `true`，U11 未关闭） */
  readonly allowlistPlaceholder: boolean;
  /** 给用户看的诚实说明 */
  readonly allowlistNote: string;
  /** 白名单条目数（便于客户端与运维快速发现"名单换了"） */
  readonly allowlistSize: number;
}

export const WEBVIEW_ALLOWLIST_PORT = Symbol('KEDAYA_WEBVIEW_ALLOWLIST_PORT');
