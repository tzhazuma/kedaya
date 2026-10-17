import data from './campus-map-data.json'

export type CampusPoint = { latitude: number; longitude: number }
export const CAMPUS_MAP = data
const coefficients = [.00220636496208,111320.7020209128,51751.86112841131,3796837.749470245,992013.7397791013,-1221952.21711287,1340652.697009075,-620943.6990984312,144416.9293806241,37.5]
function mercatorY(latitude: number) {
  const t = latitude / coefficients[9]!
  return coefficients.slice(2, 9).reduce((sum, c, i) => sum + c * t ** i, 0)
}
function gcjToBd(p: CampusPoint) {
  const z = Math.hypot(p.longitude, p.latitude) + .00002 * Math.sin(p.latitude * Math.PI * 3000 / 180)
  const theta = Math.atan2(p.latitude, p.longitude) + .000003 * Math.cos(p.longitude * Math.PI * 3000 / 180)
  return { lng: z * Math.cos(theta) + .0065, lat: z * Math.sin(theta) + .006 }
}
function bdToGcj(lng: number, lat: number): CampusPoint {
  const x = lng - .0065, y = lat - .006
  const z = Math.hypot(x, y) - .00002 * Math.sin(y * Math.PI * 3000 / 180)
  const theta = Math.atan2(y, x) - .000003 * Math.cos(x * Math.PI * 3000 / 180)
  return { longitude: z * Math.cos(theta), latitude: z * Math.sin(theta) }
}
/** Local campus projection, not a projection for locations elsewhere in the world. */
export function campusPixel(point: CampusPoint) {
  const p = gcjToBd(point)
  return { x: (coefficients[0]! + coefficients[1]! * p.lng - data.west) / data.unit,
    y: (data.north - mercatorY(p.lat)) / data.unit }
}
export function campusCoordinate(x: number, y: number): CampusPoint {
  const lng = (data.west + x * data.unit - coefficients[0]!) / coefficients[1]!
  const target = data.north - y * data.unit
  let south = 30, north = 32
  for (let i = 0; i < 40; i++) { const middle = (south + north) / 2; if (mercatorY(middle) < target) south = middle; else north = middle }
  return bdToGcj(lng, (south + north) / 2)
}
export const CAMPUS_BOUNDARY = data.boundary.map(p => bdToGcj(p.lng, p.lat))
export const CAMPUS_BOUNDS = {
  south: Math.min(...CAMPUS_BOUNDARY.map(p => p.latitude)), north: Math.max(...CAMPUS_BOUNDARY.map(p => p.latitude)),
  west: Math.min(...CAMPUS_BOUNDARY.map(p => p.longitude)), east: Math.max(...CAMPUS_BOUNDARY.map(p => p.longitude)),
}
export function isOnCampus(point: CampusPoint) {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return false
  const p = campusPixel(point), vertices = data.boundary.map(v => campusPixel(bdToGcj(v.lng, v.lat)))
  let inside = false
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i]!, b = vertices[j]!
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
/** Choose a coarse grid point inside the actual boundary, never an exact edge coordinate. */
export function blurredCampusPoint(point: CampusPoint): CampusPoint {
  let closest: CampusPoint | undefined, distance = Infinity
  for (let lat = Math.ceil(CAMPUS_BOUNDS.south * 1000); lat <= Math.floor(CAMPUS_BOUNDS.north * 1000); lat++) {
    for (let lng = Math.ceil(CAMPUS_BOUNDS.west * 1000); lng <= Math.floor(CAMPUS_BOUNDS.east * 1000); lng++) {
      const candidate = { latitude: lat / 1000, longitude: lng / 1000 }
      if (!isOnCampus(candidate)) continue
      const d = (candidate.latitude - point.latitude) ** 2 + ((candidate.longitude - point.longitude) * .856) ** 2
      if (d < distance) { distance = d; closest = candidate }
    }
  }
  if (!closest) throw new Error('校园范围内没有可用的模糊位置')
  return closest
}
export const CAMPUS_PLACES = [
  ...data.buildings.map(b => ({ id: b.id, name: b.name, x: b.x, y: b.y, ...bdToGcj(b.lng, b.lat), kind: 'building' })),
  // OpenStreetMap way 833243658; source coordinates are WGS84, converted to GCJ02.
  { id: 'matter-tower', name: '物质塔', x: 0, y: 0, latitude: 31.17427198, longitude: 121.59620889, kind: 'landmark' },
  // Descriptive locations read from the official campus raster, not formal bridge names.
  ...[{ id: 'bridge-north', name: '生活区北侧步行桥', x: 2030, y: 504 },
    { id: 'bridge-west', name: '物质学院西侧桥', x: 654, y: 1012 },
    { id: 'bridge-south', name: '行政中心西侧桥', x: 1057, y: 1646 }]
    .map(p => ({ ...p, ...campusCoordinate(p.x, p.y), kind: 'bridge' })),
].map(p => ({ ...p, ...campusPixel(p) }))
export const CAMPUS_FEATURED = CAMPUS_PLACES.filter(p => p.kind !== 'building' || /^(图书馆|体育馆|体育场|教学中心|行政中心|人字楼|生命学院|创业与管理学院|创意与艺术学院|白玉兰餐厅|物质学院1号楼|信息学院1号楼)$/.test(p.name))
