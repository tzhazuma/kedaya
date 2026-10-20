/**
 * 校园地点 · 从「上科大一图通」授权的 POI（28 个）
 *
 * ## 授权
 *
 * 项目负责人唐志昊已获得对方参赛组同学**口头**同意，允许合并其食堂菜单与
 * 地下车库内容。照片见 `campusPoiPhotos.ts`（54 张，远程 URL，不打包）。
 *
 * ⚠️ **没有书面文件**。配套撤回手段：
 *   `node tools/import-niyiwei-photos.mjs --revoke`
 * 撤回后照片归零，本文件的 POI **仍然保留** —— 它们只是地点名称与坐标，
 * 不含照片；地点本身是公开信息，照片才是对方的知识产权。
 *
 * ## ⚠️ 坐标必须转换：一图通用的是 **BD-09**，我们用 WGS84
 *
 * 2026-10-20 实测：把一图通原始坐标直接当 WGS84 用，每个食堂会落在校园外
 * 约 **1.4 km**，而那个位置在 OpenStreetMap 里**一个带标签元素都没有**。
 *
 * 证据链：转换后四个食堂全部落进 `CAMPUS_POI_BOUNDS`，且紧邻 OSM 记录的
 * 图书馆（`121.592341, 31.177398`）与全家便利店（`121.592916, 31.179580`）
 * —— 食堂本来就该在那儿。转换实现见 `packages/shared/src/geo/bd09.ts`。
 *
 * 本文件里的 `lat`/`lng` **已经是 WGS84**，直接用，不要再转一次。
 *
 * ## 照片关联
 *
 * `photoUrls` 留空、`photoCredit` 为 `null` —— 照片**不在这里**，
 * 而在 `campusPoiPhotos.ts` 里按 `poiId` 关联。这样撤回照片时不用动本文件。
 * 页面渲染时用 `niyiweiPhotosForPoi(poi.id)` 取照片。
 *
 * ## `source` 为什么是 `community`
 *
 * 契约只有 `osm / official / community / unknown` 四档。一图通是**另一个学生
 * 参赛组**的数据 —— 不是 OSM，也不是校方官方。标 `official` 会是谎
 * （校方没有为这些数据背书）；标 `unknown` 又丢掉了"来源已知"这个事实。
 */

import type { CampusPoiSupplement } from '@kedaya/contracts'

/** 一图通 POI 的署名（渲染照片时必须显示） */
export const NIYIWEI_POI_CREDIT =
  '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权'

/** 从一图通数据生成；坐标已 BD-09 → WGS84 */
export const NIYIWEI_CAMPUS_POIS: readonly CampusPoiSupplement[] = [
  {
    id: 'niyiwei-stall-c1-1f-beefnoodle',
    category: 'canteen-menu',
    name: '丝路食堂 · 1 楼 · 手工牛肉面',
    lat: 31.176898,
    lng: 121.593088,
    floor: 1,
    description: '拉面大份 450g / 小份 300g；单加牛肉 25g 4 元、50g 8 元。拌面、炒面等每天换（10/12–10/18 菜单）',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c1-1f-youpo',
    category: 'canteen-menu',
    name: '丝路食堂 · 1 楼 · 陕西油泼面',
    lat: 31.176898,
    lng: 121.593088,
    floor: 1,
    description: '小份面 160g / 大份面 250g',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c1-1f-ziyuan',
    category: 'canteen-menu',
    name: '丝路食堂 · 1 楼 · 自选美食',
    lat: 31.176898,
    lng: 121.593088,
    floor: 1,
    description: '按 10/12–10/18 一周菜单，每天午餐、晚餐不同；所有菜都可以点半份（半价）。会因采购微调，以现场为准',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c1-1f-breakfast',
    category: 'canteen-menu',
    name: '丝路食堂 · 1 楼 · 早餐',
    lat: 31.176898,
    lng: 121.593088,
    floor: 1,
    description: '早餐单价表（10/12 起），会因采购微调，以现场为准',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c1-2f-hulatang',
    category: 'canteen-menu',
    name: '丝路食堂 · 2 楼 · 非遗膳点（胡辣汤）',
    lat: 31.176898,
    lng: 121.593088,
    floor: 2,
    description: 'Heritage Snacks & Hu La Tang',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c1-2f-claypot',
    category: 'canteen-menu',
    name: '丝路食堂 · 2 楼 · 砂锅（煲仔饭）',
    lat: 31.176898,
    lng: 121.593088,
    floor: 2,
    description: 'Clay-pot Rice',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c1-2f-chicken',
    category: 'canteen-menu',
    name: '丝路食堂 · 2 楼 · 牛奶炸鸡',
    lat: 31.176898,
    lng: 121.593088,
    floor: 2,
    description: 'Milk Fried Chicken',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c1-2f-mifen',
    category: 'canteen-menu',
    name: '丝路食堂 · 2 楼 · 米粉',
    lat: 31.176898,
    lng: 121.593088,
    floor: 2,
    description: '米粉 300 克 / 份；牛肉杂酱、红烧牛腩只在周一到周五供应',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c2-1f-ziyuan',
    category: 'canteen-menu',
    name: '尚科食堂 · 1 楼 · 自选快餐',
    lat: 31.176084,
    lng: 121.592772,
    floor: 1,
    description: '按价位分档，每天换（10/12–10/18 一周菜单）；会因采购微调，以当天公示为准',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c2-1f-breakfast',
    category: 'canteen-menu',
    name: '尚科食堂 · 1 楼 · 早餐',
    lat: 31.176084,
    lng: 121.592772,
    floor: 1,
    description: '一楼早餐（10/12–10/18），标的是每份的份量',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c2-1f-light',
    category: 'canteen-menu',
    name: '尚科食堂 · 1 楼 · 轻食',
    lat: 31.176084,
    lng: 121.592772,
    floor: 1,
    description: '按份量计价（10/8–10/10 菜单）',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c2-1f-jianbing',
    category: 'canteen-menu',
    name: '尚科食堂 · 1 楼 · 杂粮煎饼',
    lat: 31.176084,
    lng: 121.592772,
    floor: 1,
    description: '加料：土豆丝 / 豆皮丝 1，小面筋 1.5，培根 / 肉松 / 青椒鸡蛋 2，里脊肉 / 炸鸡柳 / 王中王 / 鸡肉肠 2.5，脆骨肠 / 火山石烤肠 4，黑椒鸡扒 6',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c2-2f-dumpling',
    category: 'canteen-menu',
    name: '尚科食堂 · 2 楼 · 水饺',
    lat: 31.176084,
    lng: 121.592772,
    floor: 2,
    description: 'Dumplings & Wontons',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c2-2f-mofan',
    category: 'canteen-menu',
    name: '尚科食堂 · 2 楼 · 魔饭青年',
    lat: 31.176084,
    lng: 121.592772,
    floor: 2,
    description: '米饭不限量；每晚 7 点以后部分菜品打折：10 元一份，双拼 12 元一份',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c2-2f-teppan',
    category: 'canteen-menu',
    name: '尚科食堂 · 2 楼 · 铁板烧',
    lat: 31.176084,
    lng: 121.592772,
    floor: 2,
    description: '炒饭都可以换成炒河粉 / 饼丝 / 泡面 / 乌冬面。单加：荷包蛋 / 老干妈 2，菠萝 2–3，鸡肉 / 香肠 / 培根 / 年糕 3，肉丝 / 五花肉 / 鱿鱼 / 里脊肉…',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c2-2f-huadan',
    category: 'canteen-menu',
    name: '尚科食堂 · 2 楼 · 滑蛋饭',
    lat: 31.176084,
    lng: 121.592772,
    floor: 2,
    description: '柜台上还有一张小价目卡（含其他饭类），照片太糊没录入',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c2-2f-xiaomian',
    category: 'canteen-menu',
    name: '尚科食堂 · 2 楼 · 重庆小面',
    lat: 31.176084,
    lng: 121.592772,
    floor: 2,
    description: '汤面 / 拌面同价，标「粉」的可换米粉；可免费加面，不吃辣请提前告知。加菜：煎蛋 / 卤蛋 / 青菜 2，番茄鸡蛋 4，豌杂肉酱 / 雪菜肉丝 / 麻辣鸡丝 / 鸡腿 6，小酥…',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c2-2f-daoxiao',
    category: 'canteen-menu',
    name: '尚科食堂 · 2 楼 · 刀削面',
    lat: 31.176084,
    lng: 121.592772,
    floor: 2,
    description: '需要加面请提前告知（免费）。单加：青菜 / 鸡蛋 / 香干 2，肉丝 / 原味鸡丝 6，鸡丁 / 肉夹馍 8，牛肉 / 羊肉 10',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c2-2f-mala',
    category: 'canteen-menu',
    name: '尚科食堂 · 2 楼 · 麻辣烫 · 麻辣香锅',
    lat: 31.176084,
    lng: 121.592772,
    floor: 2,
    description: '自选食材称重，荤素同价；米饭自加',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c3-1f-ziyuan',
    category: 'canteen-menu',
    name: '白玉兰食堂 · 1 楼 · 自选',
    lat: 31.17501,
    lng: 121.592334,
    floor: 1,
    description: '按 10/12–10/18 一周菜单，午餐、晚餐不同；例汤免费。会因采购微调，以实际出餐为准',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c3-1f-noodle',
    category: 'canteen-menu',
    name: '白玉兰食堂 · 1 楼 · 特色面档',
    lat: 31.17501,
    lng: 121.592334,
    floor: 1,
    description: '汤面 5 元 / 葱油拌面 6 元，浇头另加；也有早点和馄饨',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c3-1f-steak',
    category: 'canteen-menu',
    name: '白玉兰食堂 · 1 楼 · 上品牛排',
    lat: 31.17501,
    lng: 121.592334,
    floor: 1,
    description: '套餐都含意大利面 + 荷包蛋 + 西蓝花 + 番茄。加料：荷包蛋 2 元 / 个，炸薯条 2 元 / 份，烤肉肠 3 元 / 根，烤口蘑 3 元 / 2 个',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c3-1f-teppan',
    category: 'canteen-menu',
    name: '白玉兰食堂 · 1 楼 · 铁板烧',
    lat: 31.17501,
    lng: 121.592334,
    floor: 1,
    description: '炒饭可选饭 / 面 / 河粉 / 饼丝。单点：肉柳 10、鱼排 9、五花肉 9、鸡排 8、鸡柳 8、鸡蛋 2、泡菜 2',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c3-1f-mala',
    category: 'canteen-menu',
    name: '白玉兰食堂 · 1 楼 · 香锅冒菜',
    lat: 31.17501,
    lng: 121.592334,
    floor: 1,
    description: '自选食材（81 种）称重，荤素搭配 2.28 元 / 50g',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c3-1f-roast',
    category: 'canteen-menu',
    name: '白玉兰食堂 · 1 楼 · 港式烧腊',
    lat: 31.17501,
    lng: 121.592334,
    floor: 1,
    description: 'Cantonese Roast Meats',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-c3-1f-mixian',
    category: 'canteen-menu',
    name: '白玉兰食堂 · 1 楼 · 鲜烫米线',
    lat: 31.17501,
    lng: 121.592334,
    floor: 1,
    description: '汤 / 干拌两种做法。另加：煎蛋 2，火山肉肠 / 炸蛋 4，杂酱 4.5，笋尖 5，潮汕肉卷 5.5，黄喉 6.5，毛肚 7.5，鲜切嫩牛 8',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-stall-nestart-coffee',
    category: 'canteen-menu',
    name: '耐思咖啡 / 烘焙 · 耐思咖啡 · 咖啡饮品',
    lat: 31.177482,
    lng: 121.59325,
    floor: null,
    description: 'illy 咖啡豆（中度烘焙）。菜单显示原价，持校园卡享 7 折；燕麦奶 +6 元，另加浓缩 +10 元。',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
  {
    id: 'niyiwei-parking-garage-b1',
    category: 'parking-garage',
    name: '地下车库 B1',
    lat: 31.176666,
    lng: 121.59019,
    floor: -1,
    description: '一图通授权提供的地下车库行车路线导向图（6 张）。原坐标为 BD-09，已转换为 WGS84。',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: '2026-10-20T00:00:00.000Z',
    // ⚠️ 契约的 `source` 只有 osm / official / community / unknown 四档。
    // 一图通是**另一个学生参赛组**的数据，不是 OSM、也不是校方官方 ——
    // 如实归到 `community`。用 `official` 会是谎（校方没有背书）。
    source: 'community',
  },
]
