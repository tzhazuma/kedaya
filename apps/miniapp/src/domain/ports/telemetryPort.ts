import type { ClientEventDraft } from './telemetryRepository'

/**
 * 遥测端口 —— 全应用**唯一**上报客户端事件的入口。
 *
 * 为什么签名是 `void` 而不是 `Promise`：类型本身就是纪律。
 * 上报是旁路，返回值没有任何调用方需要（服务端只回 `accepted`），
 * 而 `await` 它会让"出错路径"变成"多等一次网络失败的时间" ——
 * 用户看到的是崩溃之后又卡了 15 秒。
 */
export interface TelemetryPort {
  report(event: ClientEventDraft): void
}

/** 什么都不做的实现（测试与"明确关闭上报"的场景） */
export function createNoopTelemetry(): TelemetryPort {
  return {
    report: () => {
      /* 刻意什么都不做 */
    },
  }
}
