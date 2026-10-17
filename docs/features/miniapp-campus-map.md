# 小程序校园地图 · 真实校园底图（`KdyCampusMap`）

> 状态：**已落地（小程序端，离线底图）** · 最后核实：2026-10-18
> 产出物：`packages/contracts/src/campus-map{,.ts}` · 底图 `apps/miniapp/src/presentation/pages/wildlife/assets/campus.jpg`
> 应用代码：`apps/miniapp/src/presentation/components/KdyCampusMap/` · 快照脚本 `scripts/sync-campus-map.mjs`
> 相关：`docs/features/campus-map-data.md`（Web 端的 OSM 矢量底图）、`docs/features/wildlife-map.md` §1/§3

本文档回答四件事：**底图从哪来、许可与署名、坐标是怎么对上的、哪些是推测的**。
小程序动物地图（`/wildlife/map`、`/wildlife/report`、`/wildlife/tracks`）上的每一个位置
都应能在本文或 `campus-map-data.json` 里找到依据。

---

## 0. 结论速览

| 项 | 值 |
| --- | --- |
| 底图来源 | 上海科技大学校园 GIS：`https://map.shanghaitech.edu.cn`（瓦片 `/tiles/19/tile{x}_{y}.png`） |
| 快照日期 | `2026-10-17`（见 `campus-map-data.json.updatedAt`） |
| 底图文件 | `apps/miniapp/src/presentation/pages/wildlife/assets/campus.jpg`，**976,542 B**，**2816 × 2048 px** |
| 1 像素 | **0.5 m**（`CAMPUS_MAP.unit`） |
| 底图覆盖 | 校园外接矩形，**校园边界以外用多边形遮罩掉了**（不会把周边城市画进来） |
| 投影 | `BD09-Mercator`（百度系），底图左上角 `west 13536000` / `north 3634688` |
| 对外坐标系 | **GCJ-02**（与微信 `wx.openLocation`、原 `<map>` 同一口径） |
| 地标 | **65 项官方建筑** + 「物质塔」+ 3 座桥（共 69，见 §4） |
| 许可 | 校方 GIS **授权口径未确认**（§6）；「物质塔」为 OSM（ODbL 1.0） |
| 必须署名 | `CAMPUS_ATTRIBUTION` = 「底图与建筑：上海科技大学校园 GIS · 物质塔：OpenStreetMap」 |
| 包体位置 | **wildlife 分包**（主包 1.43 MiB / wildlife 分包 0.98 MiB，上限均 2 MiB） |
| 真机实测 | **未做**（本机无微信开发者工具 CLI，需人工导入 `apps/miniapp/dist` 复核，§7.3） |

---

## 1. 为什么换掉原生 `<map>`

原生 `<map>` 渲染的是腾讯 / 高德的**城市街道图**：图上的校园小路、桥、楼名都是
为城市导航准备的数据，在校园尺度上**基本是错的**——你要找「黑天鹅在哪片水面旁」，
它给不了答案。

改用的方案（也是 `docs/features/wildlife-map.md` §1.2 推荐的方案 B）：

```
校方校园 GIS 栅格底图（本分包内，离线）
  + 应用自己画的叠加层（区域圈 / 观测点 / 聚合热点 / 推断轨迹）
```

**功能没有删减**，对照表：

| 原生 `<map>` | `KdyCampusMap` |
| --- | --- |
| `markers` + `callout` | marker 图标 + 点中后气泡 |
| `circles` | 区域圈（半径按米 × `pxPerMeter` 换算像素） |
| `polyline` + `dottedLine` | 虚线折线 + 终点箭头 |
| `showLocation` | `position` 蓝点（页面取一次定位，失败静默不显示） |
| 手势缩放 + 拖动 | 拖动（`ScrollView`）+ 放大 / 缩小 / 全景按钮 |
| `bindtap` 点选 | `onPick`（**校园外点选会被拦截**并提示） |
| （无） | 建筑 / 地标名称、按名称搜索定位、「全部建筑」开关 |
| 「在腾讯地图中打开」导航出口 | **保留**（要的是手机地图的路网，不是底图） |

---

## 2. 坐标是怎么对上的（本模块最容易出错的地方）

### 2.1 一条链路，两个转换点

```
存储 / API：WGS84
   │  toMapPoint()（domain/models/wildlife.ts，唯一入口）
   ▼
叠加层与点选：GCJ-02  ◀── KdyCampusMap 的入参与 onPick 回调口径
   │  campusPixel()（@kedaya/contracts）
   ▼
底图像素：BD-09 → BD09-Mercator → 像素（x 右 / y 下）
```

- **页面依旧走 `buildMapOverlays()`** 输出 GCJ-02 叠加层 —— 与 `<map>` 时代一行没改；
- 组件**只做像素投影**，不做 WGS84 转换；
- 点选回调是 GCJ-02，页面声明来源（`setPoint(point, 'gcj02')`）后由用例转回 WGS84。

WGS84 与 GCJ-02 在校园一带相差**约 470 m**（`Δlat −248 m / Δlng +400 m`，见
`campus-map-data.md` §1.1）。少转一次不会报错，只会让所有点整体偏一栋楼。

### 2.2 半径必须按米换算，不能用经纬度近似

```
scale      = 渲染宽度 / 2816
pxPerMeter = scale / CAMPUS_MAP.unit(= 0.5)
圆像素直径 = 半径(米) × pxPerMeter × 2
```

`pxPerMeter` 由 `geometry.ts` 的 `layoutFor()` 统一给出，页面不自己算
（`__tests__/geometry.test.ts` 里有真实口径断言：`577.5 / 2816 / 0.5 ≈ 0.41016`）。

### 2.3 视口宽度是**实测**的，不是猜的

页面没有「窗口宽度 − 常数」这种猜测：组件用
`Taro.createSelectorQuery().select('#…').boundingClientRect` 实测容器宽度，
拿不到时退回按 375 设计稿扣掉页面内边距的兜底值。实测值到达后会**保持相对缩放**
重新铺满（旋转屏幕 / 首帧测量都不会把底图甩到角落）。

---

## 3. 数据文件与快照脚本

| 文件 | 内容 |
| --- | --- |
| `packages/contracts/src/campus-map-data.json` | 快照：尺寸 / 投影常数 / 校园边界（11 点）/ 65 项官方建筑（图纸像素 + BD-09 经纬度） |
| `packages/contracts/src/campus-map.ts` | 三端共享的投影与地标：`campusPixel` / `campusCoordinate` / `isOnCampus` / `blurredCampusPoint` / `CAMPUS_PLACES` / `CAMPUS_FEATURED` / `CAMPUS_ATTRIBUTION` |
| `scripts/sync-campus-map.mjs` | 重新快照校方 GIS（瓦片拼图 + 遮罩 + 生成 JSON），`npm run sync:campus-map` |

> ⚠️ 重新快照需要 `sharp`（原生二进制依赖，仓库**默认不装**）与校方 GIS 的网络可达性：
> `npm i -D sharp && npm run sync:campus-map`。
> **不要手改 JSON 里的投影常数**：像素坐标与常数必须由同一次快照推出，改一个数字会让所有点整体偏移。
> 脚本只写小程序这一份底图 —— Web 端用的是自己的矢量底图（`apps/web/public/map/*`），
> 多写一份就是一张没人引用的 1 MB 图片。

---

## 4. 哪些是官方数据、哪些是推测

| 来源 | 数量 | 可信度 |
| --- | --- | --- |
| 校方 GIS `archite_entity` 的建筑名与轮廓 | 65 | **官方数据**，但**未与后勤逐项核对**（同名楼、别名可能存在） |
| 「物质塔」 | 1 | OpenStreetMap `way 833243658`（ODbL），非校方数据 |
| 3 座桥（`生活区北侧步行桥` / `物质学院西侧桥` / `行政中心西侧桥`） | 3 | **看底图写的描述性名称**，**不是官方桥名**（代码注释已标注） |

`CAMPUS_FEATURED` 是从 65 项里按名称白名单挑出的重点地标（食堂、图书馆、学院楼、
宿舍、校门等）。**没有找到就返回空**，不会用近似名兜底 —— 地点标注宁可少，不要错。

---

## 5. 组件与页面怎么接

组件：`apps/miniapp/src/presentation/components/KdyCampusMap/`

| 文件 | 作用 |
| --- | --- |
| `index.tsx` | 组件本体（拖动 / 缩放 / 全景 / 搜索 / 叠加层渲染 / 校园外拦截） |
| `geometry.ts` | 纯函数几何（`fitWidth` / `layoutFor` / `clampOffset` / `circleRect` / `segmentRect` …），**不依赖 Taro**，可单测 |
| `index.scss` | 样式（色值全部来自设计令牌，坐标尺寸由 JS 内联给出） |
| `__tests__/geometry.test.ts` | 几何单测（视口铺满、缩放边界、像素→渲染、半径换算、线段旋转） |

三个页面（都在 wildlife 分包，底图也在分包内）：

| 页面 | 用法 |
| --- | --- |
| `wildlife/map` | `markers` + `circles` + `polyline`；点区域卡 / 点标记时 `focus` 居中；`position` 蓝点 |
| `wildlife/report` | `picked` 选点 + `onPick` → `setPoint(p, 'gcj02')` |
| `wildlife/tracks` | `polyline`（`dotted`）+ 起点标记 |

**分包约束**：底图 1 MB 级资源放在 `apps/miniapp/src/presentation/pages/wildlife/assets/`
（不放 `src/assets/` —— 那会把主包顶穿 2 MiB）。`apps/miniapp/config/index.ts` 的 copy 规则
把它拷到 `dist/presentation/pages/wildlife/assets/`；`scripts/verify-weapp-build.cjs` 会断言
「底图存在」且「wildlife 分包 ≤ 2 MiB」，避免哪天规则被改错后底图静默 404（用户看到一片空白地图）。

---

## 6. 许可与署名（必须遵守）

- 底图与 65 项建筑轮廓来自**校方公开的校园 GIS 服务**（`map.shanghaitech.edu.cn`）。
  它对外公开可访问，但**我们没有拿到书面授权**，授权口径**未确认** ——
  与 `campus-map-data.md` §7.2 对「学校官方平面图」的记录是同一类问题，只是这次
  **确实使用了**（因此必须署名，并且上线前需要校方确认，§8）。
- 「物质塔」是唯一一项 OSM 数据，**ODbL 1.0**，署名已与校方署名合并进
  `CAMPUS_ATTRIBUTION`，渲染在底图下方的说明行（`CampusMap` 的 `__caption`）。
- **不得**声称「已获校方授权 / 已与官方图核对」—— 页面与文档都不这么写。

---

## 7. 验证记录（真实输出，2026-10-18）

```bash
npm run typecheck -w @kedaya/contracts   # → exit 0
npx vitest run packages/contracts/src/campus-map.test.ts
# → Test Files 1 passed · Tests 6 passed（投影往返、边界判定、模糊化）

npm run typecheck -w @kedaya/miniapp     # → exit 0
npm run test -w @kedaya/miniapp
# → Test Files 79 passed · Tests 1260 passed
#   （含 KdyCampusMap/__tests__/geometry.test.ts 与 mock 仓储/用例新增测试）

npm run build:weapp                      # → exit 0（Compiled successfully）
npm run verify:weapp -w @kedaya/miniapp
# → WeChat build verified: 502 module factories, 3062 JSX imports, coherent chunks,
#   no temporary diagnostics, main package 1.43 MiB (excludes 15 subpackages),
#   wildlife subpackage 0.98 MiB.
```

### 7.3 没做的事（如实标注）

- **真机 / 微信开发者工具视觉复核未做**：本机没有微信开发者工具的 CLI，
  浏览器截图也不能替代真机。请把 `apps/miniapp/dist` 导入微信开发者工具，
  重点看：底图是否铺满、建筑名是否压住 marker、放大后栅格是否可接受、
  点选在校园边缘的拦截是否合理。
- 底图是**栅格**：放大到 2 倍以上会看到像素化（Web 端的 OSM 矢量底图没有这个问题，
  但小程序端不能用 SVG 内联到 WXSS，换矢量需要另做 canvas 渲染）。
- 未做底图与真实路网的对照：校园外的导航仍走「在腾讯地图中打开」（`openWildlifePointInMap`）。

---

## 8. 未决问题

| # | 问题 | 需要谁 |
| --- | --- | --- |
| C1 | 校方校园 GIS 的**使用授权**（公开可访问 ≠ 允许用于第三方产品） | 校方 + 法务 |
| C2 | 65 项建筑名与后勤口径逐项核对（同名 / 别名 / 未开放楼栋） | 后勤 |
| C3 | 3 座桥的正式名称（当前是描述性名称） | 基建 |
| C4 | 底图刷新节奏（校方 GIS 改版后需要重跑快照；目前只有手工 `npm run sync:campus-map`） | 数据维护 |
| C5 | 放大后的栅格清晰度是否可接受，是否需要换成 vector/canvas 渲染 | 产品 |
