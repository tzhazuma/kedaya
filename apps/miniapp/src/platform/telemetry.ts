import Taro from '@tarojs/taro'

import type {
  ClientEventDraft,
  ClientEventPayload,
  TelemetryRepository,
} from '../domain/ports/telemetryRepository'
import type { TelemetryPort } from '../domain/ports/telemetryPort'
import { currentPlatform } from './env'

/**
 * 客户端遥测上报器（平台层：唯一接触 Taro 的地方）。
 *
 * ## 为什么需要它而不是直接裸调接口
 *
 * 因为"上报"这件事有四件必须做的事，任何一件漏掉都会让这套机制**看起来在工作、
 * 实际上帮倒忙**：
 *
 * | 必须做的事 | 漏掉的后果 |
 * |---|---|
 * | 客户端先截断超长文本 | 一条带 200KB 栈的崩溃在弱网上要传十几秒，白烧用户流量 |
 * | 同一条崩溃去重 | 一个每次渲染都抛错的组件会瞬间刷出几千条相同记录 |
 * | 会话总量上限 | 错误处理本身出错 → 又产生一条错误 → 自激振荡 |
 * | 上报绝不影响主流程 | 用户看到崩溃提示之后又卡住 15 秒（等上报超时） |
 *
 * ## 为什么 `report` 是同步的 `void`
 *
 * 见 `domain/ports/telemetryPort.ts` 的注释：调用点应当能"顺手报一条"而不改变
 * 控制流（不用 await、不用 catch）。
 */

/** 单次会话的上报总量上限（防止错误处理自激振荡） */
export const TELEMETRY_MAX_PER_SESSION = 40
/** 同一条（kind + message）最多上报几次 */
export const TELEMETRY_MAX_DUPLICATES = 3
/** 客户端侧的长度上限（比服务端更严：省流量；服务端仍有自己的上限兜底） */
export const TELEMETRY_LIMITS = { message: 400, stack: 3000, route: 160 } as const

export interface TelemetryReporterOptions {
  repository: TelemetryRepository
  /** 会话总量上限（测试可调小） */
  maxPerSession?: number
  maxDuplicates?: number
  /** 注入取当前页面路径的能力（默认读 Taro.getCurrentPages）—— 便于单测 */
  currentRoute?: () => string
  /** 注入平台/版本（默认从 Taro 读）—— 便于单测 */
  describeRuntime?: () => { platform: string; appVersion: string }
}

export interface TelemetryReporter extends TelemetryPort {
  /**
   * 挂上 `Taro.onError` / `onUnhandledRejection` / `onPageNotFound`。
   *
   * 幂等：重复调用只会挂一次（避免 `useLaunch` 因热重载被跑两次后**每条错误报两遍**）。
   */
  installGlobalHandlers(): void
  /** 仅测试用：清空去重与计数 */
  reset(): void
}

function clip(text: string, max: number): string {
  const points = [...text]
  return points.length <= max ? text : `${points.slice(0, max).join('')}…`
}

/** 栈最多留前若干行：真正常用的是最上面几帧，后面的都是框架噪声 */
function clipStack(stack: string): string {
  return clip(stack.split('\n').slice(0, 20).join('\n'), TELEMETRY_LIMITS.stack)
}

function defaultRoute(): string {
  try {
    const pages = Taro.getCurrentPages()
    const current = pages[pages.length - 1]
    const route = (current as { route?: unknown } | undefined)?.route
    return typeof route === 'string' && route.length > 0 ? route : 'unknown'
  } catch {
    return 'unknown'
  }
}

function defaultRuntime(): { platform: string; appVersion: string } {
  let appVersion = 'unknown'
  try {
    // 开发者工具里 version 通常是空串；真机遮罩预览才是真实版本号
    const info = Taro.getAccountInfoSync()
    const version = info?.miniProgram?.version
    if (typeof version === 'string' && version.length > 0) appVersion = version
  } catch {
    /* H5 / 非微信环境没有这个能力，保持 unknown */
  }
  return { platform: currentPlatform(), appVersion }
}

export function createTelemetryReporter(options: TelemetryReporterOptions): TelemetryReporter {
  const { repository } = options
  const maxPerSession = options.maxPerSession ?? TELEMETRY_MAX_PER_SESSION
  const maxDuplicates = options.maxDuplicates ?? TELEMETRY_MAX_DUPLICATES
  const currentRoute = options.currentRoute ?? defaultRoute
  const describeRuntime = options.describeRuntime ?? defaultRuntime

  let reported = 0
  const seen = new Map<string, number>()
  let installed = false

  function report(draft: ClientEventDraft): void {
    try {
      if (reported >= maxPerSession) return

      const message = clip(draft.message, TELEMETRY_LIMITS.message)
      const fingerprint = `${draft.kind}::${message}`
      const count = seen.get(fingerprint) ?? 0
      if (count >= maxDuplicates) return

      seen.set(fingerprint, count + 1)
      reported += 1

      const runtime = describeRuntime()
      const payload: ClientEventPayload = {
        kind: draft.kind,
        message,
        platform: runtime.platform,
        appVersion: runtime.appVersion,
        route: clip(draft.route ?? currentRoute(), TELEMETRY_LIMITS.route),
        ...(draft.stack === undefined ? {} : { stack: clipStack(draft.stack) }),
        ...(draft.traceId === undefined ? {} : { traceId: draft.traceId }),
        ...(draft.context === undefined ? {} : { context: draft.context }),
      }

      /**
       * 这里**不 await**，也**不把 Promise 返回给调用方**：
       * 上报的延迟与失败都不该进入用户路径。`void` + `catch` 是唯一正确的写法
       * （repository 已承诺不抛错，catch 是最后一道保险）。
       */
      void repository.send(payload).catch(() => {
        /* 遥测失败必须静默 */
      })
    } catch {
      // 连组装载荷都出错（例如奇怪的宿主环境）就放弃：上报永远不能成为新的故障源
    }
  }

  function installGlobalHandlers(): void {
    if (installed) return
    installed = true

    // 三个钩子在 H5 / 低版本基础库里可能不存在，逐个 try —— 缺一个不影响其它两个
    try {
      Taro.onError((error: unknown) => {
        const raw = typeof error === 'string' ? error : String(error)
        const [firstLine, ...rest] = raw.split('\n')
        report({
          kind: 'error',
          message: firstLine ?? 'unknown error',
          stack: rest.join('\n'),
        })
      })
    } catch {
      /* 该环境不支持 */
    }

    try {
      Taro.onUnhandledRejection((res: { reason?: unknown }) => {
        const reason = res?.reason
        report({
          kind: 'unhandled-rejection',
          message:
            reason instanceof Error
              ? reason.message
              : typeof reason === 'string'
                ? reason
                : '未处理的 Promise 拒绝',
          ...(reason instanceof Error && typeof reason.stack === 'string'
            ? { stack: reason.stack }
            : {}),
        })
      })
    } catch {
      /* 该环境不支持 */
    }

    try {
      Taro.onPageNotFound((res: { path?: unknown }) => {
        const path = typeof res?.path === 'string' ? res.path : 'unknown'
        report({
          kind: 'page-not-found',
          message: `页面不存在：${path}`,
          route: path,
        })
      })
    } catch {
      /* 该环境不支持 */
    }
  }

  return {
    report,
    installGlobalHandlers,
    reset(): void {
      reported = 0
      seen.clear()
    },
  }
}
