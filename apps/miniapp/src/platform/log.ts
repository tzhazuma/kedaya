import { sanitizeForLog } from '../domain/models/credentials'
import { allowedFieldsFor, type LogLevel, type LogPort, type LogRecord, type LogSink } from '../domain/ports/logPort'

/**
 * 日志适配器 —— 规格 §10.3 的**执行侧**。
 *
 * 三层防护，缺一不可：
 *
 * | # | 手段 | 挡住什么 |
 * | --- | --- | --- |
 * | 1 | **事件白名单**：未登记的事件整条丢弃 | 「顺手打了个没人审过的日志」 |
 * | 2 | **字段白名单**：未登记的字段整条丢弃 | 把 `credential` / `summary` 整个对象塞进去 |
 * | 3 | **值清洗**：`sanitizeForLog` 深扫 + 内联凭证正则 | 白名单字段里混进了 `CASTGC=...` |
 *
 * 为什么是白名单：黑名单只能挡住**想得到的**名字，一个 `x_castgc_v2` 就绕过去了。
 * 白名单下「没想到的字段」默认不进日志 —— 这正是规格 §10.3 要的方向。
 *
 * ⚠️ 本文件**不得**引入任何 cookie / token 的读取能力：
 * 它是「写日志」的出口，不是「读凭证」的入口。
 * 静态扫描测试（`src/__tests__/techpie-no-cookie-injection.test.ts`）会检查这一点。
 */

export interface LogPortOptions {
  sink?: LogSink
  /** 低于该级别的事件直接丢弃（默认 `debug`，即全收） */
  minLevel?: LogLevel
  /** 注入时钟，便于测试断言 `at` */
  now?: () => Date
  /** 未登记事件 / 字段被丢弃时的回调（测试用来证明「确实丢了」） */
  onDropped?: (info: { event: string; reason: 'UNKNOWN_EVENT' | 'NO_FIELDS'; dropped: number }) => void
}

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

/** 默认落点：`console`。小程序里 `console` 由宿主提供，H5 里是浏览器 console */
export function createConsoleSink(): LogSink {
  return {
    write(record: LogRecord): void {
      // ⚠️ 这里序列化的 `record.fields` 已经过白名单 + 清洗，绝不是原始入参
      const line = `[${record.level}] ${record.event}`
      if (record.level === 'error') {
        console.error(line, record.fields)
      } else if (record.level === 'warn') {
        console.warn(line, record.fields)
      } else {
        console.log(line, record.fields)
      }
    },
  }
}

/** 内存落点（测试用：把日志收进数组，然后做正则扫描） */
export function createMemorySink(): LogSink & { records: LogRecord[] } {
  const records: LogRecord[] = []
  return {
    records,
    write(record: LogRecord): void {
      records.push(record)
    },
  }
}

/**
 * 生成一个日志端口。
 *
 * 关键不变式：**到达 sink 的 `fields` 一定不含凭证** ——
 * 即使调用方把整个绑定请求体（含 `password` / `wechatLoginCode`）传进来。
 */
export function createLogPort(options: LogPortOptions = {}): LogPort {
  const sink = options.sink ?? createConsoleSink()
  const minLevel = options.minLevel ?? 'debug'
  const now = options.now ?? (() => new Date())

  function emit(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return

    const allowed = allowedFieldsFor(event)
    if (allowed === null) {
      // 未登记事件：整条丢弃。**不**降级成「只打事件名」——
      // 那会让未登记事件仍然产生可观测副作用，白名单就白设了。
      options.onDropped?.({ event, reason: 'UNKNOWN_EVENT', dropped: 0 })
      return
    }

    const rawFields = fields ?? {}

    const { value, droppedKeys } = sanitizeForLog(rawFields, { allowedKeys: allowed })
    const sanitized =
      typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

    if (droppedKeys.length > 0) {
      options.onDropped?.({ event, reason: 'NO_FIELDS', dropped: droppedKeys.length })
    }

    sink.write({
      level,
      event,
      fields: Object.freeze(sanitized),
      at: now().toISOString(),
    })
  }

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  }
}
