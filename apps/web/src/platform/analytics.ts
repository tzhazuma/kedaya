/**
 * 埋点 / trace（契约 §7：platform/）。
 *
 * 隐私优先（契约 §9）：**不接任何第三方 SDK**，只做本地环形缓冲 + 开发期控制台输出。
 * 需要上报时，由接入方注入 sink（后端自己的 /api/v1/... 端点）。
 */
export interface TraceEvent {
  name: string;
  /** 与响应信封的 traceId 对齐，便于端到端排查 */
  traceId?: string;
  /** 冻结模块 key */
  moduleId?: string;
  at: string;
  data?: Readonly<Record<string, unknown>>;
}

export type TraceSink = (event: TraceEvent) => void;

export interface TraceLogger {
  track(event: Omit<TraceEvent, 'at'> & { at?: string }): TraceEvent;
  recent(): readonly TraceEvent[];
  clear(): void;
}

const MAX_BUFFER = 100;

export function createTraceLogger(sink?: TraceSink): TraceLogger {
  let buffer: TraceEvent[] = [];

  return {
    track(event): TraceEvent {
      const full: TraceEvent = { ...event, at: event.at ?? new Date().toISOString() };
      buffer = [...buffer, full].slice(-MAX_BUFFER);
      if (sink) {
        try {
          sink(full);
        } catch {
          // 埋点失败绝不能影响业务
        }
      }
      if (process.env.NODE_ENV !== 'production' && typeof console !== 'undefined') {
        console.debug('[kdy:track]', full.name, full.data ?? '');
      }
      return full;
    },
    recent: () => buffer,
    clear: () => {
      buffer = [];
    },
  };
}

/** 应用级 logger（无 sink：纯本地） */
export const traceLogger = createTraceLogger();
