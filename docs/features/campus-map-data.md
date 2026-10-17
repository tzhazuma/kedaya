# 校园地图数据与底图 · `campus-map-data`

> 状态：**已落地（Phase 1，可离线）** · 最后核实：2026-10-17
> 产出物目录：`apps/web/public/map/` · 应用代码：`apps/web/src/features/map/`
> 相关规格：`docs/features/wildlife-map.md` §1（底图方案）、§3（坐标系）、§9（隐私）
> 契约：`docs/architecture/00-FROZEN-CONTRACT.md` §11.14（wildlife 隐私裁决）

本文档回答四件事：**数据从哪来、许可是什么、精度多少、哪些是推测的**。
页面上能看到的每个数字与每一句"来源"都应能在本文或数据文件里找到依据；
找不到依据的表述不允许出现在 UI 里。

---

## 0. 结论速览

| 项 | 值 |
| --- | --- |
| 数据源 | OpenStreetMap（Nominatim 查中心点 + Overpass API 取要素） |
| 许可 | **ODbL 1.0**；必须署名 `© OpenStreetMap contributors`；衍生数据库同许可 |
| 校园范围（WGS84） | 纬度 **31.175546 – 31.1830156**，经度 **121.5844916 – 121.5960882** |
| 校园多边形 | OSM `relation/5390610`，93 个顶点，面积 **609,167.4 m²**（约 60.9 公顷） |
| 尺寸 | 约 **1,104 m（东西）× 832 m（南北）** |
| OSM 快照 | `2026-10-17T11:19:01Z`（各图层 11:03:51Z–11:19:01Z） |
| 抓取时间 | 2026-10-17 19:07–19:31（+08:00） |
| POI 要素 | **186 个**（建筑 86 / 水域 14 / 康体 8 / 绿地 38 / 设施 20 / 校门 15 / 轨道 5） |
| 地点标注 | `CAMPUS_LOCATION_DEFS` 全部 **25 个**；10 已确证 / 7 推断 / 8 近似 |
| 底图 | `campus-basemap.svg`（浅色）+ `campus-basemap-dark.svg`（深色），1400×868 px |
| 投影 | WGS84 → 本地等距平面（ENU，原点 31.1795,121.591）→ 线性视口；**不经过 GCJ-02** |
| 学校官方平面图 | **未抓取、未复制、未逐点比对**（版权未确认） |

---

## 1. 坐标核实：用户给的数字与实测不一致

任务描述里给的"大致范围"是 **经度 121.590–121.605、纬度 31.183–31.192**。
用开放数据核实后，**这个范围不是上海科技大学张江校区**：

| 来源 | 纬度 | 经度 | 说明 |
| --- | --- | --- | --- |
| 任务描述（待核实） | 31.183 – 31.192 | 121.590 – 121.605 | 中心约 (31.1875, 121.5975) |
| **Nominatim** | 31.175546 – 31.1830156 | 121.5844916 – 121.5960882 | `display_name` = 上海科技大学（张江校区），`type=university` |
| **OSM relation 5390610** | 31.175546 – 31.1830156 | 121.5844916 – 121.5960882 | 与 Nominatim 完全一致 |

两者对比：任务描述的范围整体位于实测范围**东北约 1.1 km**（北 +902 m、东 +695 m），
主要覆盖的是校园北侧的中科院上海高等研究院与张江西北片区，**不包含校园主体**。
即使假设它写的是 GCJ-02（需要往西南回退约 470 m），也仍然偏北约 430 m，
因此**不能**用"坐标系写错了"来解释，只能按"近似值/记忆值"处理。

**处理方式**：以 OSM relation 的 bbox 为唯一范围；代码里写的是实测值，
并在 `campus-poi.json._meta.nominatimResult` 保留了 Nominatim 的原始返回值，
便于任何时候复核。任务描述的数字**没有**写进代码。

### 1.1 GCJ-02 偏移量级（复核仓库中的既有断言）

用 `packages/shared/src/geo/gcj02.ts` 的算法在校园中心 (31.1794305, 121.5902345) 计算：

```
WGS84 → GCJ-02:  Δlat = −247.8 m（向南），Δlng = +400.0 m（向东），合位移 471.6 m
GCJ-02 → WGS84:  迭代 3 次后往返误差 ≈ 9e-8 m
```

这与仓库既有注释"上海科技大学实测偏移：东南约 470 m，dLat −248 m / dLng +400 m"**一致**。
结论：**任何把 WGS84 当作 GCJ-02 直接画到腾讯/高德地图上的做法，都会让点整体偏移约 470 m** ——
所以本底图走"图像像素空间 + 线性投影"，完全不经过 GCJ-02。

---

## 2. 查询语句与来源

### 2.1 Nominatim（只查中心点，不下载瓦片）

```bash
curl -A 'kedaya-campus-map/0.1' \
  'https://nominatim.openstreetmap.org/search?q=%E4%B8%8A%E6%B5%B7%E7%A7%91%E6%8A%80%E5%A4%A7%E5%AD%A6&format=jsonv2&limit=5&extratags=1&addressdetails=1'
```

返回的第一条即 `上海科技大学（张江校区）`，`lat=31.1794305, lon=121.5902345`，
boundingbox 与 OSM relation 一致。原始结果已写入 `campus-poi.json._meta.nominatimResult`。

### 2.2 Overpass API（2026-10-17 实际执行的语句）

端点：`https://overpass-api.de/api/interpreter`（POST，`data=` 为下面的 QL）。
所有查询都限定在 bbox `31.1750,121.5840,31.1836,121.5966`（比校园 bbox 略大，便于包含边界上的要素）。

```overpassql
// 1) 校园多边形（relation 的 2 个 outer way，共 93 个顶点）
[out:json][timeout:90];relation(5390610);out geom;

// 2) 建筑 footprint
[out:json][timeout:150];way["building"](31.1750,121.5840,31.1836,121.5966);out tags geom;

// 3) 水域（面 + 线）
[out:json][timeout:150];
(
  way["natural"="water"](31.1750,121.5840,31.1836,121.5966);
  way["waterway"](31.1750,121.5840,31.1836,121.5966);
);
out tags geom;

// 4) 康体设施（田径场/球场/体育馆/泳池）
[out:json][timeout:150];way["leisure"](31.1750,121.5840,31.1836,121.5966);out tags geom;

// 5) 绿地/用地
[out:json][timeout:120];way["landuse"](31.1750,121.5840,31.1836,121.5966);out tags geom;

// 6) 步道/服务道/支路
[out:json][timeout:120];
way["highway"~"^(footway|service|residential|unclassified|pedestrian|cycleway|path)$"]
  (31.1750,121.5840,31.1836,121.5966);
out tags geom;

// 7) 设施 POI（食堂/咖啡/医务室/银行/停车…）
[out:json][timeout:120];nwr["amenity"](31.1750,121.5840,31.1836,121.5966);out tags center;

// 8) 设施 POI（leisure）
[out:json][timeout:120];nwr["leisure"](31.1750,121.5840,31.1836,121.5966);out tags center;

// 9) 水域（中心点，用于清单）
[out:json][timeout:120];
(
  nwr["natural"="water"](31.1750,121.5840,31.1836,121.5966);
  way["waterway"](31.1750,121.5840,31.1836,121.5966);
);
out tags center;

// 10) 校门
[out:json][timeout:120];
(
  node["barrier"~"gate|entrance"](31.1750,121.5840,31.1836,121.5966);
  node["entrance"](31.1750,121.5840,31.1836,121.5966);
  way["barrier"="gate"](31.1750,121.5840,31.1836,121.5966);
);
out tags center;

// 11) 地铁站（只用于标出最近车站，非校园要素）
[out:json][timeout:90];nwr["railway"="station"](31.16,121.56,31.22,121.63);out tags center;
```

> 复现：原始 JSON 缓存由生成器读取（默认 `/tmp/ov_*.json`，可用 `KDY_OSM_RAW` 改）。
> 生成器见 §5.3。

**数据来源 URL**

- 校园：<https://www.openstreetmap.org/relation/5390610>
- OSM 版权：<https://www.openstreetmap.org/copyright>
- ODbL 1.0：<https://opendatacommons.org/licenses/odbl/1-0/>
- Overpass API：<https://overpass-api.de/>
- Nominatim：<https://nominatim.openstreetmap.org/>

---

## 3. 查到的真实 POI（节选）

经过"落在校园多边形内"过滤后，`campus-poi.json` 有 **186 个要素**：

| 类别 | 数量 | 例子 |
| --- | --- | --- |
| 建筑 `building` | 86 | 图书馆、教学中心、行政中心、物质/信息/生命/创管学院、学生公寓 1–10、餐饮中心 #1–#3、体育馆、游泳馆、会议中心 |
| 水域 `water` | 14 | 图书馆旁无名人工湖（两个相邻面，合计 7,632 m²）、向阳河（canal）、校内溪流 |
| 康体 `leisure` | 8 | 田径跑道（东侧）、网球场、体育馆、游泳馆、操场 |
| 绿地 `landuse` | 38 | 草地、林地、recreation_ground |
| 设施 `amenity` | 20 | 科大咖啡馆、医务室、上海银行、肯德基、丝路餐厅、尚科美食广场、白玉兰餐厅、教职工食堂、正门 |
| 校门 `gate` | 15 | 正门（华夏中路）、东侧/北侧若干车行门 |
| 轨道 `transit` | 5 | 中科路站（13 号线，最近）、张江高科站、张江路站、学林路站、华夏中路站 |

几个关键实测坐标（WGS84）：

| 地物 | OSM 对象 | 坐标 |
| --- | --- | --- |
| 图书馆 | way 832289398 | 31.177398, 121.592341 |
| 教学中心 | way 542603582 | 31.177719, 121.590927 |
| 行政中心 | way 461639463 | 31.177393, 121.589121 |
| 体育馆 | way 587691936 | 31.178667, 121.593810 |
| 游泳馆 | way 832289364 | 31.182029, 121.592869 |
| 人工湖（无名） | way 832289399 + 832289412 | 31.17696, 121.59203（质心） |
| 正门 | node 4571133482 | 31.175952, 121.590476 |
| 中科路站（13 号线） | way 659461032 | 31.181028, 121.597539 |

**没有查到的东西**（必须诚实标注）：

- 羽毛球馆、健身房、篮球场、教学楼 A/B/C —— OSM **没有**独立要素；
- 人工湖**没有名称**（OSM 只有面，没有 `name` 标签）；
- 学校官方地图里的"东门/南门"命名与 OSM 的 `barrier=gate` 不是一一对应，OSM 只有「正门」有名字。

---

## 4. 25 个地点：坐标与可信度

`CAMPUS_LOCATION_DEFS` 只有 `{key, label}`，**没有坐标**。坐标由本次核实补齐，
逐项依据写在 `apps/web/src/features/map/campusLocations.ts` 与 `campus-poi.json.locations[].evidence`。

| # | key | 名称 | 纬度 | 经度 | 可信度 | 依据摘要 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | library | 图书馆 | 31.177398 | 121.592341 | 已确证 | OSM way 832289398 命名要素 |
| 2 | canteen-1 | 一食堂 | 31.180280 | 121.593059 | 推断 | OSM「餐饮中心 #1」，序号对应为推测 |
| 3 | canteen-2 | 二食堂 | 31.179473 | 121.592747 | 推断 | OSM「餐饮中心 #2」 |
| 4 | canteen-3 | 三食堂 | 31.178526 | 121.592332 | 推断 | OSM「餐饮中心 #3」 |
| 5 | gym | 体育馆 | 31.178667 | 121.593810 | 已确证 | OSM「上海科技大学体育馆」 |
| 6 | badminton-hall | 羽毛球馆 | 31.178800 | 121.594130 | 近似 | OSM 无要素；按与体育馆同址，东移 25 m |
| 7 | swimming-pool | 游泳馆 | 31.182029 | 121.592869 | 已确证 | OSM「上海科技大学游泳馆」 |
| 8 | track-field | 田径场 | 31.178490 | 121.595232 | 推断 | OSM 东侧 running 跑道（未命名） |
| 9 | basketball-court | 篮球场 | 31.178200 | 121.594600 | 近似 | OSM 无 basketball 要素 |
| 10 | tennis-court | 网球场 | 31.181699 | 121.591759 | 推断 | OSM pitch + sport=tennis（未命名） |
| 11 | fitness-room | 健身房 | 31.178650 | 121.593880 | 近似 | 按体育馆内/同址处理 |
| 12 | teaching-a | 教学楼A | 31.177736 | 121.590620 | 近似 | 教学中心长轴西段 |
| 13 | teaching-b | 教学楼B | 31.177736 | 121.590927 | 近似 | 教学中心中段 |
| 14 | teaching-c | 教学楼C | 31.177736 | 121.591235 | 近似 | 教学中心东段 |
| 15 | student-center | 学生活动中心 | 31.179787 | 121.592136 | 近似 | OSM「校园服务中心 H1」；H1/H2 二选一 |
| 16 | academic-exchange-center | 学术交流中心 | 31.182203 | 121.593374 | 推断 | OSM「会议中心」功能最接近 |
| 17 | school-entrepreneurship | 创管学院 | 31.178724 | 121.590606 | 已确证 | OSM「创业与管理学院」 |
| 18 | school-information | 信息学院 | 31.179781 | 121.590529 | 已确证 | OSM「信息科学与技术学院 #1」 |
| 19 | school-physical | 物质学院 | 31.179588 | 121.589103 | 已确证 | OSM「物质科学与技术学院」主楼 |
| 20 | school-life | 生命学院 | 31.181799 | 121.590176 | 已确证 | OSM「生命科学与技术学院」 |
| 21 | dorm-area | 宿舍区 | 31.179416 | 121.593619 | 已确证 | 10 栋学生公寓 + 博士公寓 几何中心 |
| 22 | lakeside-lawn | 湖畔草坪 | 31.176850 | 121.591100 | 推断 | 无名湖西侧 12,440 m² 草地 |
| 23 | cafe | 咖啡厅 | 31.180761 | 121.593163 | 已确证 | OSM「科大咖啡馆」 |
| 24 | campus-gate | 校门口 | 31.175952 | 121.590476 | 已确证 | OSM「正门」 |
| 25 | zhangjiang-metro | 张江地铁站 | 31.181028 | 121.597539 | 近似 | 最近站=中科路站（13 号线）；名称语义存疑 |

统计：**10 已确证 / 7 推断 / 8 近似**。这与页面上的计数完全一致，
单测 `campusAssets.test.ts` 会锁死这个分布。

### 4.1 必须知道的三个"名称歧义"

1. **一/二/三食堂**：OSM 只有「餐饮中心 #1/#2/#3」，没有中文序号的官方对应。
   本表按序号顺序映射，**这是推测**；真实对应关系需后勤确认。
2. **教学楼 A/B/C**：OSM 只有一栋 110 m 长的「教学中心」。A/B/C 是沿长轴的等距近似，
   **不是**三栋独立建筑的实测位置。
3. **张江地铁站**：白名单里的名字不等于官方站名。距校园最近的是 **中科路站（13 号线，约 0.9 km）**；
   也可能指 **张江高科站（2 号线，约 2.9 km 北）**。本表取前者，**属推测**，
   产品最终口径需产品/运营确认（建议把地点名改成「中科路地铁站」）。

---

## 5. 底图是怎么生成的

### 5.1 投影（与 `packages/shared/src/geo/local.ts` 同一套公式）

```
x = (lng − 121.591) × 111320 × cos(31.1795°)
y = (lat − 31.1795) × 111320
```

然后线性视口到像素（`affine = [a,b,c,d,e,f]`）：

```
px = 0.9410692043·x + 0·y + 625.6779147525
py = 0·x + (−0.9410692043)·y + 410.6417508174
```

- 视口：`x ∈ [−661.5, 817.9] m`，`y ∈ [−380.5, 541.0] m`（校园 bbox + 东侧 200 m 用于标地铁站）；
- 尺寸：**1400 × 868 px**，比例 **0.9410692043 px/m**（1 px ≈ 1.063 m）；
- 方向：x 向东、py 向下（屏幕坐标），**无旋转、无错切**；
- 逆变换解析求逆，`像素 → WGS84 → 像素` 往返误差 < 1e-6 px（见 `campusOverlays.test.ts`）。

**为什么不用 GCJ-02**：底图是图像像素空间，WGS84 直接线性映射，
因此整条链路没有"漏转一个点"的风险（规格 §1.2 理由 3、§3.2 第 4 条）。

### 5.2 产出文件

| 文件 | 内容 | 许可 |
| --- | --- | --- |
| `apps/web/public/map/campus-basemap.svg` | 浅色底图（校园边界、绿地、道路、水面、建筑、校门、25 个地点标签、比例尺、指北针、署名） | ODbL |
| `apps/web/public/map/campus-basemap-dark.svg` | 深色底图（同一几何，深色令牌配色） | ODbL |
| `apps/web/public/map/campus-basemap.geojson` | WGS84/CRS84 的 GeoJSON（campus / building / water / landuse / leisure / path / gate / poi / location） | ODbL |
| `apps/web/public/map/campus-poi.json` | POI 清单 + `_meta`（查询语句、时间、许可、精度、caveats）+ 25 个地点 | ODbL |
| `apps/web/public/map/campus-basemap.geometry.json` | 视口/仿射/尺寸（应用层读取的机器可读配置） | 本项目（数据派生） |

配色**逐字取自** `packages/design-tokens/dist/tokens.css`（浅色与深色令牌），
生成器会断言 SVG 里每个 hex 都能在 tokens.css 找到；单测 `campusAssets.test.ts` 再断言一次。
因此静态底图也遵守"禁止手写色值"。

### 5.3 重新生成

```bash
export PATH="/opt/homebrew/bin:$PATH"
/opt/homebrew/bin/python3 \
  apps/web/src/features/map/tools/generate-campus-basemap.py
```

脚本会：

1. 读取 `$KDY_OSM_RAW`（默认 `/tmp`）下的 `ov_*.json` 快照；缺失时用 Overpass 重新抓取（需要网络）；
2. 用**同一套 ENU 公式**投影，渲染浅色/深色 SVG；
3. 写出上表五个文件；
4. 断言配色全部来自 design-tokens。

> 生成器是**离线数据工具**，不在 `next build` 的依赖图里；删掉它不影响运行时。

---

## 6. wildlife 图层怎么画上去（遵守契约 §11.14）

页面：`/wildlife/map`（`apps/web/src/app/(portal)/wildlife/map/page.tsx`）
主体：`apps/web/src/features/map/CampusMapView.tsx`（离线底图）
外层切换：`apps/web/src/features/map/CampusBasemapToggle.tsx`

### 6.0 两种底图，**离线是默认**

| 模式 | 实现 | 是否需要网络 | 说明 |
| --- | --- | --- | --- |
| **离线底图（默认）** | `CampusMapView` + `public/map/campus-basemap*.svg` | ❌ 不需要 | 本任务的硬要求；叠加活动区域/热点/轨迹/观测点，带 25 个地点与数据来源面板 |
| 在线地图（可选） | `CampusLeafletMap` + OSM 瓦片（`tile.openstreetmap.org`） | ✅ 需要 | 便于看清校园在张江的位置、缩放拖拽；瓦片同样受 ODbL 约束并显示署名 |

默认离线而不是在线，理由：小程序 `web-view`、弱网/断网、以及"不依赖在线瓦片"都是硬约束；
在线瓦片只是"能看周边"的增强，加载失败时页面提示切回离线底图。
在线模式使用 OSM 公共瓦片，**只适合开发/小流量演示**；正式上线若流量增大，
应改为自建瓦片或商业底图（需另做授权与 GCJ-02 转换）。

### 6.1 数据流

```
loadWildlifeMap（application，未改动）
  → 叠加层像素（按仓储下发的底图 affine）
  → rebaseZones/Spots/Tracks/Markers（features/map/campusOverlays.ts）
      旧像素 ──旧 affine⁻¹──▶ WGS84 ──新 affine──▶ OSM 底图像素
  → WildlifeBasemapMap（presentation，未改动）渲染
```

**为什么必须重投影**：`loadWildlifeMap` 返回的叠加层是按**仓储下发的底图仿射**算的
（mock 下是手绘占位图，1200×800）。两张图的视口与比例不同，直接复用像素会让整层系统性偏移。
重投影走回 WGS84，是线性可逆的，不引入额外误差。

**半径必须重算**：`radiusPx = radiusM × 0.9410692043`，不能照抄旧图的 `radiusPx`。

### 6.2 隐私（§11.14 / 规格 §9）

| 要求 | 实现 |
| --- | --- |
| 敏感区不落精确点 | `sightingToMarker` 对 `geo === null` 返回 `null`；敏感区观测只出现在列表，**类型上不可能**被画到地图 |
| k-匿名 < 3 不公开 | `spotMeetsKAnonymity` / mock 仓储已过滤；不足 3 位上报人的观测 `geo` 被扣留 |
| 只显示区段而非个体 | 区域画成圆（敏感区为虚线边界），热点是聚合圆，**没有任何个体精确点** |
| 热点非实时 | 页面显示「历史聚合 · 延迟 ≥24h」；`aggregationDelayHours` 来自契约 |
| 轨迹是推断 | 虚线 + `isInferred: true` + 服务端 `disclaimer`；页面另有显著标注 |
| 底图不含 EXIF/GPS | 底图是矢量图，不含照片元数据 |

### 6.3 已知数据质量问题：mock fixture 与真实底图不对齐（**未修，如实标注**）

mock fixture（`apps/web/src/data/mock/fixtures/wildlife.ts`）的区域坐标是按**旧手绘底图**
写的，不是按真实校园采集的。投到 OSM 底图后：

| mock 区域 | mock 坐标 | 在该坐标附近的真实地物 | 与对应真实地点的距离 |
| --- | --- | --- | --- |
| 图书馆后草坪 | 31.180398, 121.589635 | 信息科学与技术学院 #2（49 m） | 距真实图书馆 **422 m** |
| 人工湖（黑天鹅水域） | 31.177703, 121.592050 | 图书馆（44 m） | 距真实湖心约 **83 m**（基本吻合） |
| 宿舍区西侧（敏感区） | 31.176805, 121.587010 | 行政中心（211 m） | 距真实宿舍区 **693 m** |
| 一食堂周边 | 31.178422, 121.588165 | 创意与艺术学院（44 m） | 距最近餐饮中心 **397 m** |
| 东门水边绿地 | 31.179320, 121.595725 | 金创大厦4号楼（100 m） | 无对应地点定义，未计 |

原因：fixture 的坐标看起来近似于"把 GCJ-02 当成 WGS84"的反向偏移
（真实图书馆 GCJ→WGS 约 31.17962, 121.58822，与 fixture 相差约 170 m），
属于规格 §3 描述的典型坐标系陷阱，但**没有证据**证明作者是有意为之，所以只记录现象。

**处理方式**：

- **没有**在客户端"挪点"掩盖（那会让地图与数据两套真相）；
- 页面显示一条 warning，明确"这是数据问题，不是渲染问题"；
- 修正应在**数据层**：按 `wildlife-map.md §3.4` 重新采集 ≥6 个控制点，
  重锚定 fixture 与 zone seed（超出本次校园地图的写作用域：`data/mock/` 只读）。

---

## 7. 许可与合规（必须遵守）

### 7.1 OpenStreetMap = ODbL 1.0

- **署名**：所有展示 OSM 数据的地方必须出现 **`© OpenStreetMap contributors`**。
  本仓库中出现的位置：
  1. 两张底图 SVG 的左下角（始终可见，不是只在 HTML 里）；
  2. `/wildlife/map` 页面的「底图与数据来源」区块与地图下方；
  3. `campus-poi.json._meta.attribution`、`campus-basemap.geojson.metadata.attribution`；
  4. 本文档。
- **相同方式共享**：`campus-poi.json` 与 `campus-basemap.geojson` 是 OSM 数据的衍生物，
  **同样按 ODbL 1.0 分发**。如果把它们并入产品数据库并向公众提供，
  该衍生数据库也受 ODbL 约束（需做法务确认具体边界）。
- **不额外加限制**：不得对 OSM 数据附加 DRM 或"禁止提取"条款。

### 7.2 学校官网校园地图：**没有抓取、没有复制**

- 学校官网/迎新页可能发布过校园平面图，但**版权状态未确认**，也没有书面授权；
- 本次任务**没有**下载、截图、描摹或复制学校地图；
- 因此"用官方图逐点核对 POI"这一步**未完成**，页面上不能声称"已与官方图核对"；
- 如果将来拿到书面授权：把底图作为可配置资源替换（`CAMPUS_BASEMAP.imageLight/imageDark`），
  许可标为 `school-authorized`，并在 `docs/legal/basemap-authorization.md` 记录授权来源
  （该文件当前**不存在**，因为尚未获得授权）。

### 7.3 其他

- 底图不含任何个人数据；观测点坐标已由服务端模糊化（§11.14），本页面不再二次加工；
- 底图不含在线瓦片请求：所有资源都在 `public/map/` 下，**可离线使用**，
  满足小程序 `web-view` 与弱网场景（不需要地图 key、不需要备案域名）。

---

## 8. 精度与"哪些是推测的"

| 项 | 精度/状态 |
| --- | --- |
| 校园边界 | OSM relation 5390610，未与校方红线核对；面积 609,167.4 m² 为 OSM 编辑成果 |
| 建筑/POI 坐标 | OSM 节点或 way 中心点；平面误差估计 **3–15 m**（依赖航拍描图与志愿编辑），未实测 |
| 底图投影 | 校园尺度等距近似，误差 < 0.1%；像素往返 < 1e-6 px |
| 25 个地点 | **10 已确证 / 7 推断 / 8 近似**；每项依据见 §4 与数据文件 |
| 人工湖名称 | **未知**（OSM 无 name）；图上只写「人工湖」 |
| 一/二/三食堂 | 序号映射**推测** |
| 教学楼 A/B/C | 沿教学中心长轴的**近似**，不是实测三栋 |
| 张江地铁站 | 取最近的**中科路站**，名称语义**存疑** |
| mock wildlife 坐标 | 与真实校园相差 **80–693 m**（见 §6.3），已知问题 |
| 学校官方图比对 | **未做**（版权未确认） |

---

## 9. 本次未做 / 给其他端的建议

### 9.1 未做

- 没有实地 GPS 采集（无设备、无授权），因此所有 POI 精度都是"OSM 的精度"，不是我们的实测；
- 没有与学校官方平面图逐点比对（版权未确认）；
- 没有改 `apps/miniapp` 与 `apps/mobile`（写作用域只到 `apps/web/public/map`、
  `apps/web/src/features/map`、`docs/`）；
- 没有改 `apps/web/src/domain/models/wildlife/*`（新增的底图配置放在 `features/map`，
  旧占位底图保持原样，`/wildlife` 页行为不变）。

### 9.2 给小程序 / 移动端的建议（**未实施**）

1. **小程序**：`<map>` 组件只接受 GCJ-02，且**不能换底图**。若要复用本底图：
   - 走方案 B：`<image src="/map/campus-basemap.svg">` + 覆盖层（SVG/Canvas），完全不碰 GCJ-02；
   - 若必须用 `wx.openLocation`，只在该 API 调用前用 `wgs84ToGcj02()` 转换（唯一消费点）；
   - 不要直接 `import` `apps/web/public/map/*.svg`（小程序包体限制），建议 CDN/对象存储 + 本地缓存。
2. **移动端（Flutter）**：可以直接复用 `campus-basemap.geojson` 与
   `campus-basemap.geometry.json` 的 affine，但要注意 SVG 渲染库的兼容性；
   建议用 GeoJSON + `CustomPainter` 渲染，避免引入 WebView。
3. **共享 25 个地点坐标**：`CAMPUS_MAP_LOCATIONS` 目前只在 Web 的 `features/map` 里。
   建议下一轮提升到 `@kedaya/contracts`（或 `packages/shared`），
   让小程序/移动端/服务端用同一份坐标与可信度，避免三端各写一份再漂移。
4. **数据层修正**：按 §6.3 重锚定 mock fixture；这是上线前必须做的，
   否则地图上的"图书馆后草坪"会一直落在信息学院旁边。

---

## 10. 验证记录（真实输出，2026-10-17 21:26）

```bash
export PATH="/opt/homebrew/bin:$PATH"
cd /Users/azuma/Documents/deepseek-harness/default-workspace/kedaya

npm run typecheck -w @kedaya/web
# → exit 0（0 errors）

npm run test -w @kedaya/web
# → Test Files 38 passed (38)
#   Tests      773 passed (773)
# 其中 18 条是本次新增：src/features/map/campusAssets.test.ts（14）
#                      src/features/map/campusOverlays.test.ts（4）

npm run build -w @kedaya/web
# → ✓ Compiled successfully
#   ✓ Finished TypeScript
#   ✓ Generating static pages (43/43)
#   路由表包含  ○ /wildlife/map

npm run start -w @kedaya/web -- --port 3100
# → 生产模式起服务；/wildlife/map 返回 200，
#   /map/campus-basemap.svg、/map/campus-poi.json 均 200
```

浏览器实测（截图在 `/Users/azuma/Downloads/kdy-shots/`）：

| 截图 | 内容 |
| --- | --- |
| `11-map-offline-light.png` / `12-map-offline-light.png` | 离线底图全页（深色 / 浅色主题） |
| `17-map-detail-light.png` | 离线底图细节：25 个地点标注 + 5 个活动区域 + 3 个热点 + 3 条推断轨迹（虚线） |
| `18-map-detail-dark.png` | 同一画面的深色底图版本 |
| `15-map-online-light.png` | 可选的在线 OSM 瓦片模式（含 ODbL 署名） |
| `16-map-error-state.png` | 错误态：提示 + 重试 + 保留上一次成功数据 |

**关于基线**：任务开始时（尚未改动任何文件）`npm run typecheck -w @kedaya/web` 有 15 条错误，
`npm run test -w @kedaya/web` 是 752 passed / 3 failed，根因是 `src/domain/models/modules.ts`
缺少 `MINIAPP_MODULES` / `WEB_READY_MODULES` / `DELIVERED_MODULES` / `API_ONLY_MODULES` 导出
（不在本次写作用域）。该缺陷在任务进行期间由该模块负责人修复；上面的 0 errors / 773 passed
是**修复后**的最终结果。本次新增文件在修复前后都没有新增 typecheck 错误。

## 11. 未决问题

| # | 问题 | 需要谁 |
| --- | --- | --- |
| M1 | 「张江地铁站」到底指哪一站（中科路 / 张江高科） | 产品 + 运营 |
| M2 | 一/二/三食堂与餐饮中心 #1/#2/#3 的官方对应 | 后勤 |
| M3 | 教学楼 A/B/C 的真实楼栋边界 | 教务/基建 |
| M4 | 人工湖的正式名称 | 宣传/基建 |
| M5 | mock fixture 重锚定（§6.3） | 数据层负责人 |
| M6 | 是否把 `CAMPUS_MAP_LOCATIONS` 提升到 contracts | 架构负责人 |
| M7 | 学校官方平面图授权（如拿到，替换底图并记录 `docs/legal/basemap-authorization.md`） | 校方 + 法务 |
| M8 | 基线 `modules.ts` 缺导出（阻塞 typecheck/build） | 该模块负责人 |
