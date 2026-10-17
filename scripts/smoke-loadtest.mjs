#!/usr/bin/env node
/**
 * 可达鸭 API 轻量压测（零依赖，只用 Node 内置的 fetch）。
 *
 * 为什么要有它：上线前最低限度要知道「一台 1 核 2G 的云托管实例能扛多少并发」，
 * 否则「能让人真正使用」就只是口号。这个脚本只打**读接口**（匿名可调用），
 * 所以可以随时对生产（或预发）环境跑一遍，不会产生任何脏数据。
 *
 * 用法：
 *   node scripts/smoke-loadtest.mjs                          # 默认打 localhost:3999
 *   node scripts/smoke-loadtest.mjs --base https://api.example.com --concurrency 50 --duration 30
 *   node scripts/smoke-loadtest.mjs --paths /api/v1/flea-market/items
 *   node scripts/smoke-loadtest.mjs --max-error-rate 0      # 零容忍（用于发布前卡点）
 *
 * 退出码：0 = 达到阈值；1 = 错误率超标或参数有问题（可直接用在 CI / 发布脚本里）。
 *
 * 它**不是**基准测试工具：没有渐进加压、没有 P99 长尾分析、没有连接数控制。
 * 它的目标是「5 分钟内得到一个是/不是的结论」，而不是画一张好看的曲线。
 */

const DEFAULTS = {
  base: 'http://localhost:3999',
  concurrency: 20,
  duration: 10,
  timeout: 5000,
  maxErrorRate: 0.01,
}

/** 默认打的是首页/发现页会并发打到的那几个列表接口 */
const DEFAULT_PATHS = [
  '/health',
  '/api/v1/flea-market/items',
  '/api/v1/forum/posts',
  '/api/v1/lost-found/items',
  '/api/v1/errand/items',
  '/api/v1/buddy/groups',
  '/api/v1/groupbuy/items',
  '/api/v1/auth/modules',
]

function parseArgs(argv) {
  const options = { ...DEFAULTS, paths: DEFAULT_PATHS, token: '' }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    switch (flag) {
      case '--base':
        options.base = value
        i += 1
        break
      case '--concurrency':
        options.concurrency = Number(value)
        i += 1
        break
      case '--duration':
        options.duration = Number(value)
        i += 1
        break
      case '--timeout':
        options.timeout = Number(value)
        i += 1
        break
      case '--max-error-rate':
        options.maxErrorRate = Number(value)
        i += 1
        break
      case '--token':
        options.token = value
        i += 1
        break
      case '--paths':
        options.paths = value.split(',').map((item) => item.trim()).filter((item) => item !== '')
        i += 1
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        // 静默忽略未知参数会让打错参数的人以为压测跑了 —— 直接报错
        throw new Error(`未知参数：${flag}（用 --help 看用法）`)
    }
  }
  return options
}

function assertOptions(options) {
  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
    throw new Error('--concurrency 必须是 ≥ 1 的数字')
  }
  if (!Number.isFinite(options.duration) || options.duration <= 0) {
    throw new Error('--duration 必须是 > 0 的秒数')
  }
  if (!Number.isFinite(options.maxErrorRate) || options.maxErrorRate < 0) {
    throw new Error('--max-error-rate 必须是 ≥ 0 的小数（0.01 = 1%）')
  }
  if (options.paths.length === 0) {
    throw new Error('--paths 至少给一个路径')
  }
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0
  // 最近秩法：p95 表示「95% 的请求都不慢于这个值」，比插值更贴近「用户会觉得慢吗」
  const index = Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1)
  return sorted[index]
}

function formatMs(value) {
  return `${value.toFixed(value < 100 ? 1 : 0)}ms`
}

async function hit(base, path, options, stats) {
  const url = `${base.replace(/\/+$/, '')}${path}`
  const startedAt = performance.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeout)
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      ...(options.token === '' ? {} : { headers: { authorization: `Bearer ${options.token}` } }),
    })
    // 必须读完 body：不读会把连接占住，测出来的是 socket 复用而不是服务端处理速度
    await response.arrayBuffer()
    const elapsed = performance.now() - startedAt
    const bucket = stats.byPath.get(path) ?? { count: 0, errors: 0, latencies: [] }
    bucket.count += 1
    bucket.latencies.push(elapsed)
    if (response.status >= 400) {
      bucket.errors += 1
      stats.errorsByStatus.set(response.status, (stats.errorsByStatus.get(response.status) ?? 0) + 1)
    }
    stats.byPath.set(path, bucket)
    return { ok: response.status < 400, status: response.status, elapsed }
  } catch (error) {
    const elapsed = performance.now() - startedAt
    const bucket = stats.byPath.get(path) ?? { count: 0, errors: 0, latencies: [] }
    bucket.count += 1
    bucket.errors += 1
    bucket.latencies.push(elapsed)
    stats.byPath.set(path, bucket)
    const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network'
    stats.errorsByStatus.set(reason, (stats.errorsByStatus.get(reason) ?? 0) + 1)
    return { ok: false, status: 0, elapsed }
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help === true) {
    process.stdout.write(
      [
        '用法: node scripts/smoke-loadtest.mjs [选项]',
        '  --base <url>              目标地址，默认 http://localhost:3999',
        `  --concurrency <n>         并发数，默认 ${DEFAULTS.concurrency}`,
        `  --duration <秒>            压测时长，默认 ${DEFAULTS.duration}`,
        `  --timeout <毫秒>           单请求超时，默认 ${DEFAULTS.timeout}`,
        `  --max-error-rate <小数>    错误率上限，默认 ${DEFAULTS.maxErrorRate}`,
        '  --token <jwt>             带上令牌（默认匿名，只打读接口）',
        '  --paths <a,b,c>           只打指定路径（逗号分隔）',
        '',
        `默认路径：${DEFAULT_PATHS.join(', ')}`,
        '',
      ].join('\n'),
    )
    return 0
  }
  assertOptions(options)

  const base = options.base.replace(/\/+$/, '')
  const stats = { byPath: new Map(), errorsByStatus: new Map() }
  const latencies = []
  const deadline = Date.now() + options.duration * 1000

  process.stdout.write(
    [
      '',
      '=== 可达鸭 API 压测 ===',
      `目标      ${base}`,
      `并发      ${options.concurrency}`,
      `时长      ${options.duration}s`,
      `路径      ${options.paths.join(' , ')}`,
      '',
    ].join('\n'),
  )

  /**
   * 预热：每个路径先各打一次，结果**不计入统计**。
   * 不预热的话，最先那几十毫秒的冷启动样本会把 p95 整个带歪 ——
   * 那是冷启动的成本，不是稳态表现，混在一起会让结论没法用。
   */
  await Promise.all(
    options.paths.map(async (path) => {
      await fetch(`${base}${path}`)
        .then((response) => response.arrayBuffer())
        .catch(() => null)
    }),
  )

  const startedAt = Date.now()
  const workers = Array.from({ length: options.concurrency }, async (_, workerIndex) => {
    let index = workerIndex
    while (Date.now() < deadline) {
      const path = options.paths[index % options.paths.length]
      index += 1
      const result = await hit(base, path, options, stats)
      latencies.push(result.elapsed)
    }
  })

  await Promise.all(workers)
  const elapsedSeconds = (Date.now() - startedAt) / 1000

  const sorted = [...latencies].sort((a, b) => a - b)
  const totalErrors = [...stats.byPath.values()].reduce((sum, bucket) => sum + bucket.errors, 0)
  const total = latencies.length
  const errorRate = total === 0 ? 1 : totalErrors / total

  process.stdout.write(
    [
      `请求总数  ${total}（错误 ${totalErrors}，错误率 ${(errorRate * 100).toFixed(2)}%）`,
      `吞吐      ${(total / elapsedSeconds).toFixed(1)} req/s`,
      `延迟      p50 ${formatMs(percentile(sorted, 0.5))} / p95 ${formatMs(
        percentile(sorted, 0.95),
      )} / p99 ${formatMs(percentile(sorted, 0.99))} / max ${formatMs(sorted.at(-1) ?? 0)}`,
      '',
      '按路径：',
      ...[...stats.byPath.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([path, bucket]) => {
          const pathSorted = [...bucket.latencies].sort((a, b) => a - b)
          return `  ${path}  n=${bucket.count} 错误=${bucket.errors} p95=${formatMs(
            percentile(pathSorted, 0.95),
          )}`
        }),
      '',
    ].join('\n'),
  )

  if (stats.errorsByStatus.size > 0) {
    process.stdout.write(
      `错误明细  ${[...stats.errorsByStatus.entries()]
        .map(([status, count]) => `${status}×${count}`)
        .join(' , ')}\n\n`,
    )
  }

  if (errorRate > options.maxErrorRate) {
    process.stdout.write(
      `❌ 错误率 ${(errorRate * 100).toFixed(2)}% 超过上限 ${(options.maxErrorRate * 100).toFixed(
        2,
      )}%（先看上面的错误明细：4xx 通常是参数/鉴权问题，5xx 与 timeout 才是要查的）\n\n`,
    )
    return 1
  }

  process.stdout.write('✅ 达到阈值。\n\n')
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    process.stderr.write(`压测没能跑起来：${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
