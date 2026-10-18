/**
 * 重新快照「真实校园底图 + 地标坐标」。
 *
 * 产物（两个文件必须一起提交，它们是配套的）：
 *   1. `apps/miniapp/src/presentation/pages/wildlife/assets/campus.jpg`
 *      —— 校方校园 GIS 的瓦片拼图，校园外区域已用边界多边形遮罩成背景色；
 *   2. `packages/contracts/src/campus-map-data.json`
 *      —— 底图尺寸 / 投影常数 / 校园边界 / 官方建筑地标（图纸坐标系与经纬度各一份）。
 *
 * 为什么底图放在**页面目录**而不是 `src/assets/`：微信主包上限 2 MiB，
 * 一份 1 MB 的底图会把主包顶穿；放进 wildlife 分包目录后由分包体积承担
 * （`apps/miniapp/config/index.ts` 的 copy 规则把它们拷到 `dist/presentation/pages/wildlife/assets/`）。
 *
 * ⚠️ 需要 `sharp`（原生二进制依赖，仓库默认不装 —— 只为这一个脚本装 30 MB 的
 * 依赖不划算）。跑之前先：
 *
 *   npm i -D sharp && node scripts/sync-campus-map.mjs
 *
 * ⚠️ 需要能访问 `https://map.shanghaitech.edu.cn`（校方公开的校园 GIS）。
 * 拿不到网络 / 校方改版时**不要**手改 JSON —— 投影常数与像素坐标必须由本脚本
 * 从同一份瓦片推导，手工改一个数字就会让所有点位整体偏移。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const ORIGIN = 'https://map.shanghaitech.edu.cn'

/** BD-09 → 米制平面（与 `packages/contracts/src/campus-map.ts` 同一套公式） */
const COEFFICIENTS = [
  0.00220636496208, 111320.7020209128, 51751.86112841131, 3796837.749470245,
  992013.7397791013, -1221952.21711287, 1340652.697009075, -620943.6990984312,
  144416.9293806241, 37.5,
]

function project({ lng, lat }) {
  const t = lat / COEFFICIENTS[9]
  return {
    x: COEFFICIENTS[0] + COEFFICIENTS[1] * lng,
    y: COEFFICIENTS.slice(2, 9).reduce((sum, coefficient, index) => sum + coefficient * t ** index, 0),
  }
}

async function query(entity, params = {}) {
  const response = await fetch(`${ORIGIN}/gis-service/sys/${entity}/queryListByWhere`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ pageSize: '500', ...params }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`校园 GIS ${entity}: HTTP ${response.status}`)
  const payload = await response.json()
  return payload.value[0].list
}

async function loadSharp() {
  try {
    return (await import('sharp')).default
  } catch {
    console.error('缺少 sharp。请先安装：npm i -D sharp')
    process.exit(1)
  }
}

async function main() {
  const sharp = await loadSharp()

  const [campus] = await query('campus')
  if (campus === undefined) throw new Error('校园 GIS 没有返回 campus 记录')
  const boundary = JSON.parse(campus.position)
  const buildings = await query('archite_entity', { cid: campus.id })

  // 底图 = 覆盖校园外接矩形的瓦片拼图：瓦片边长 256 像素，1 像素 = 0.5 米。
  const unit = 0.5
  const size = 256
  const span = size * unit
  const points = boundary.map(project)
  const left = Math.floor(Math.min(...points.map((p) => p.x)) / span)
  const right = Math.floor(Math.max(...points.map((p) => p.x)) / span)
  const bottom = Math.floor(Math.min(...points.map((p) => p.y)) / span)
  const top = Math.floor(Math.max(...points.map((p) => p.y)) / span)
  const width = (right - left + 1) * size
  const height = (top - bottom + 1) * size

  const jobs = []
  for (let x = left; x <= right; x += 1) {
    for (let y = bottom; y <= top; y += 1) jobs.push({ x, y })
  }

  const tiles = []
  let cursor = 0
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < jobs.length) {
        const { x, y } = jobs[cursor]
        cursor += 1
        const response = await fetch(`${ORIGIN}/tiles/19/tile${x}_${y}.png`, {
          signal: AbortSignal.timeout(30_000),
        })
        if (!response.ok) throw new Error(`校园瓦片 ${x},${y}: HTTP ${response.status}`)
        tiles.push({
          input: Buffer.from(await response.arrayBuffer()),
          left: (x - left) * size,
          top: (top - y) * size,
        })
      }
    }),
  )

  /** 经纬度（BD-09）→ 底图像素 */
  const pixel = (point) => {
    const projected = project(point)
    return {
      x: (projected.x - left * span) / unit,
      y: ((top + 1) * span - projected.y) / unit,
    }
  }

  const polygon = boundary
    .map((point) => {
      const spot = pixel(point)
      return `${spot.x},${spot.y}`
    })
    .join(' ')
  const mask = Buffer.from(`<svg width="${width}" height="${height}"><polygon fill="white" points="${polygon}"/></svg>`)

  const raster = await sharp({
    create: { width, height, channels: 4, background: '#edf2e6' },
  })
    .composite(tiles)
    .png()
    .toBuffer()
  const masked = await sharp(raster).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
  const image = await sharp(masked)
    .flatten({ background: '#edf2e6' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()

  // ⚠️ 只写小程序这一份：Web 端用的是自己的矢量底图（`apps/web/public/map/*`），
  // 不消费这张栅格。多写一份就是一份没人引用的 1 MB 图片（AGENTS 明确禁止）。
  const imagePath = 'apps/miniapp/src/presentation/pages/wildlife/assets/campus.jpg'
  await mkdir(dirname(join(ROOT, imagePath)), { recursive: true })
  await writeFile(join(ROOT, imagePath), image)

  const data = {
    source: ORIGIN,
    updatedAt: new Date().toISOString().slice(0, 10),
    projection: 'BD09-Mercator',
    width,
    height,
    unit,
    west: left * span,
    north: (top + 1) * span,
    boundary,
    buildings: buildings.map((building) => {
      const outline = JSON.parse(building.position)
      const lng = (Math.min(...outline.map((p) => p.lng)) + Math.max(...outline.map((p) => p.lng))) / 2
      const lat = (Math.min(...outline.map((p) => p.lat)) + Math.max(...outline.map((p) => p.lat))) / 2
      return { id: building.id, name: building.name, ...pixel({ lng, lat }), lng, lat }
    }),
  }
  await writeFile(
    join(ROOT, 'packages/contracts/src/campus-map-data.json'),
    `${JSON.stringify(data, null, 2)}\n`,
  )

  console.log(
    `校园底图已更新：${tiles.length} 块瓦片，${width}×${height}，${buildings.length} 个官方地标，校园外已遮罩。`,
  )
  console.log('⚠️ 请接着跑：npm run test -w @kedaya/contracts（投影往返 + 边界判定必须有测试守住）')
}

await main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
