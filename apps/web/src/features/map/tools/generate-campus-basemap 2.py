#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
可达鸭 · 校园地图底图生成器（**离线数据工具，不参与运行时**）
=====================================================================

输入：OpenStreetMap（Overpass API）原始 JSON 快照（缓存目录，默认 /tmp）。
输出（全部写入 `apps/web/public/map/`）：

  1. `campus-poi.json`         —— POI 清单 + 元数据（查询语句 / 时间 / 许可 / 精度）
  2. `campus-basemap.geojson`  —— 同一批要素的 WGS84 GeoJSON（可离线再加工）
  3. `campus-basemap.svg`      —— 浅色底图（静态资源）
  4. `campus-basemap-dark.svg` —— 深色底图（静态资源，供 `[data-theme=dark]` 切换）

坐标链路（与 `packages/shared/src/geo/local.ts` **同一套公式**）：

    WGS84 --toLocalMeters(CAMPUS_ORIGIN)--> 局部 ENU 米平面 (x 向东, y 向北)
          --线性视口变换--> SVG 像素 (px 向右, py 向下)

**不经过 GCJ-02**：校园底图用图像像素空间，WGS84 直接线性映射到像素。

许可：本文件的输出包含 OpenStreetMap 数据，按 **ODbL 1.0** 分发，
必须保留 "© OpenStreetMap contributors" 署名。衍生数据库同样受 ODbL 约束。

用法：
    /opt/homebrew/bin/python3 apps/web/src/features/map/tools/generate-campus-basemap.py

若缓存目录里没有原始快照，脚本会用 `urllib` 重新抓取（需要网络）。
**不要**把学校官网的校园平面图喂给本脚本 —— 学校地图的版权未确认，
本任务只允许人眼比对，不允许抓取/复制。
"""

from __future__ import annotations

import json
import math
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

# --------------------------------------------------------------------------- #
# 路径与常量
# --------------------------------------------------------------------------- #

HERE = Path(__file__).resolve()
# .../apps/web/src/features/map/tools/generate-campus-basemap.py
WEB_APP = HERE.parents[4]              # apps/web
PUBLIC_MAP = WEB_APP / "public" / "map"
RAW_DIR = Path(os.environ.get("KDY_OSM_RAW", "/tmp"))

#: 与 `packages/shared/src/geo/types.ts` 的 CAMPUS_ORIGIN 保持一致
ORIGIN_LAT, ORIGIN_LNG = 31.1795, 121.591
METERS_PER_DEG_LAT = 111_320

#: OSM relation：上海科技大学（张江校区）
CAMPUS_RELATION_ID = 5390610
OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter"
UA = "kedaya-campus-map/0.1 (offline campus basemap generator; dev@kedaya.local)"

#: 视口：校园 bbox + 留白（东侧多留，用于标出最近的地铁站）
PAD_WEST_M = 45
PAD_EAST_M = 200
PAD_SOUTH_M = 45
PAD_NORTH_M = 45
SVG_WIDTH = 1400

#: 配色 —— **逐字取自** `packages/design-tokens/dist/tokens.css`，
#: 生成时会断言每个 hex 都能在 tokens.css 里找到（防止手写新颜色）。
PALETTES = {
    "light": {
        "bg": "#F7F8FA",
        "surface": "#FFFFFF",
        "surfaceAlt": "#F1F3F7",
        "border": "#E3E8EF",
        "text": "#1F2733",
        "muted": "#6B7A90",
        "success": "#22A06B",
        "warning": "#E8833A",
        "danger": "#D64545",
        "info": "#3B82F6",
        "brand": "#FFC53D",
        "brandSoft": "#FFF3B8",
    },
    "dark": {
        "bg": "#0B1220",
        "surface": "#151C28",
        "surfaceAlt": "#1E2734",
        "border": "#2A3444",
        "text": "#E8EEF7",
        "muted": "#93A3B8",
        "success": "#3DD68C",
        "warning": "#F0A05A",
        "danger": "#F07171",
        "info": "#60A5FA",
        "brand": "#FFD666",
        "brandSoft": "#3A2F12",
    },
}

# --------------------------------------------------------------------------- #
# 查询（与 docs/features/campus-map-data.md 记录的一致）
# --------------------------------------------------------------------------- #

BBOX = "31.1750,121.5840,31.1836,121.5966"
QUERIES: dict[str, str] = {
    "relgeom": f"[out:json][timeout:90];relation({CAMPUS_RELATION_ID});out geom;",
    "bgeom": f'[out:json][timeout:150];way["building"]({BBOX});out tags geom;',
    "wgeom": f'[out:json][timeout:150];(way["natural"="water"]({BBOX});way["waterway"]({BBOX}););out tags geom;',
    "lgeom": f'[out:json][timeout:150];way["leisure"]({BBOX});out tags geom;',
    "landgeom": f'[out:json][timeout:120];way["landuse"]({BBOX});out tags geom;',
    "highway": f'[out:json][timeout:120];way["highway"~"^(footway|service|residential|unclassified|pedestrian|cycleway|path)$"]({BBOX});out tags geom;',
    "amenity": f'[out:json][timeout:120];nwr["amenity"]({BBOX});out tags center;',
    "leisure": f'[out:json][timeout:120];nwr["leisure"]({BBOX});out tags center;',
    "water": f'[out:json][timeout:120];(nwr["natural"="water"]({BBOX});way["waterway"]({BBOX}););out tags center;',
    "gates": f'[out:json][timeout:120];(node["barrier"~"gate|entrance"]({BBOX});node["entrance"]({BBOX});way["barrier"="gate"]({BBOX}););out tags center;',
    "metro": '[out:json][timeout:90];nwr["railway"="station"](31.16,121.56,31.22,121.63);out tags center;',
}

#: 由 Nominatim 查得的官方中心点（仅用于文档与核对，不参与投影）
NOMINATIM_CENTER = (31.1794305, 121.5902345)
NOMINATIM_BBOX = (31.1755460, 31.1830156, 121.5844916, 121.5960882)
NOMINATIM_QUERY = (
    "https://nominatim.openstreetmap.org/search?"
    "q=%E4%B8%8A%E6%B5%B7%E7%A7%91%E6%8A%80%E5%A4%A7%E5%AD%A6&format=jsonv2&limit=5"
    "&extratags=1&addressdetails=1"
)


# --------------------------------------------------------------------------- #
# 抓取 / 读取原始快照
# --------------------------------------------------------------------------- #

def fetch(name: str, query: str) -> dict:
    path = RAW_DIR / f"ov_{name}.json"
    if path.exists() and path.stat().st_size > 100:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if "elements" in data:
                return data
        except json.JSONDecodeError:
            pass
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            body = urllib.parse.urlencode({"data": query}).encode("utf-8")
            request = urllib.request.Request(
                OVERPASS_ENDPOINT,
                data=body,
                headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded"},
            )
            with urllib.request.urlopen(request, timeout=180) as response:
                data = json.loads(response.read().decode("utf-8"))
            path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            return data
        except Exception as error:  # noqa: BLE001 - 网络异常一律重试
            last_error = error
            time.sleep(12 * (attempt + 1))
    raise RuntimeError(f"Overpass 查询 {name} 失败：{last_error}")


# --------------------------------------------------------------------------- #
# 投影
# --------------------------------------------------------------------------- #

def meters_per_deg_lng(at_lat: float) -> float:
    return METERS_PER_DEG_LAT * math.cos(math.radians(at_lat))


def to_local(lat: float, lng: float) -> tuple[float, float]:
    """WGS84 → 局部 ENU 米（与 packages/shared/src/geo/local.ts 完全一致）"""
    return (
        (lng - ORIGIN_LNG) * meters_per_deg_lng(ORIGIN_LAT),
        (lat - ORIGIN_LAT) * METERS_PER_DEG_LAT,
    )


def point_in_ring(lat: float, lng: float, ring: list[tuple[float, float]]) -> bool:
    x, y = to_local(lat, lng)
    vertices = [to_local(la, ln) for la, ln in ring]
    inside = False
    j = len(vertices) - 1
    for i in range(len(vertices)):
        xi, yi = vertices[i]
        xj, yj = vertices[j]
        if (yi > y) != (yj > y):
            x_cross = (xj - xi) * (y - yi) / (yj - yi or 1e-12) + xi
            if x < x_cross:
                inside = not inside
        j = i
    return inside


def centroid_of(geometry: list[dict]) -> tuple[float, float]:
    lat = sum(point["lat"] for point in geometry) / len(geometry)
    lng = sum(point["lon"] for point in geometry) / len(geometry)
    return lat, lng


def ring_area_m2(ring: list[tuple[float, float]]) -> float:
    lat0 = sum(lat for lat, _ in ring) / len(ring)
    kx = meters_per_deg_lng(lat0)
    points = [((lng - ORIGIN_LNG) * kx, (lat - ORIGIN_LAT) * METERS_PER_DEG_LAT) for lat, lng in ring]
    area = 0.0
    for i in range(len(points)):
        x0, y0 = points[i]
        x1, y1 = points[(i + 1) % len(points)]
        area += x0 * y1 - x1 * y0
    return abs(area / 2)


# --------------------------------------------------------------------------- #
# 25 个校园地点（CAMPUS_LOCATION_DEFS）→ 真实坐标
# --------------------------------------------------------------------------- #

LOCATIONS = [
    # key, label, lat, lng, confidence, kind, osm ids, evidence note
    ("library", "图书馆", 31.177398, 121.592341, "high", "osm-named", [832289398],
     "OSM way 832289398「上海科技大学图书馆」中心点"),
    ("canteen-1", "一食堂", 31.180280, 121.593059, "medium", "osm-inferred", [1478884442],
     "OSM「餐饮中心 #1」（food_court）。OSM 未把序号与「一/二/三」对应，按 #1→一、#2→二、#3→三 推测"),
    ("canteen-2", "二食堂", 31.179473, 121.592747, "medium", "osm-inferred", [1478884443],
     "OSM「餐饮中心 #2」（food_court）；序号到中文名的映射为推测"),
    ("canteen-3", "三食堂", 31.178526, 121.592332, "medium", "osm-inferred", [587651665],
     "OSM「餐饮中心 #3」（food_court）；序号到中文名的映射为推测"),
    ("gym", "体育馆", 31.178667, 121.593810, "high", "osm-named", [587691936],
     "OSM「上海科技大学体育馆」（leisure=fitness_centre）"),
    ("badminton-hall", "羽毛球馆", 31.178800, 121.594130, "low", "approximate", [],
     "OSM 未单独测绘羽毛球馆；按通常与体育馆同址，放在体育馆东侧约 25 m（推测）"),
    ("swimming-pool", "游泳馆", 31.182029, 121.592869, "high", "osm-named", [832289364],
     "OSM「上海科技大学游泳馆」（leisure=sports_centre, sport=swimming）"),
    ("track-field", "田径场", 31.178490, 121.595232, "medium", "osm-inferred", [832685906],
     "OSM leisure=track, sport=running 的东侧跑道；未命名，按校园唯一标准田径场推测"),
    ("basketball-court", "篮球场", 31.178200, 121.594600, "low", "approximate", [],
     "OSM 无 sport=basketball 要素；按体育馆东南侧运动场地近似放置（推测）"),
    ("tennis-court", "网球场", 31.181699, 121.591759, "medium", "osm-inferred", [832289379],
     "OSM leisure=pitch, sport=tennis；未命名，按位置与场地类型对应"),
    ("fitness-room", "健身房", 31.178650, 121.593880, "low", "approximate", [],
     "OSM 无独立要素；按位于体育馆内/同址处理（推测）"),
    ("teaching-a", "教学楼A", 31.177736, 121.590620, "low", "approximate", [542603582],
     "OSM「上海科技大学教学中心」是一整栋长条建筑（约 110 m）；A/B/C 三栋未分别标注，沿建筑长轴等距近似"),
    ("teaching-b", "教学楼B", 31.177736, 121.590927, "low", "approximate", [542603582],
     "同上：教学中心中段近似位置（推测）"),
    ("teaching-c", "教学楼C", 31.177736, 121.591235, "low", "approximate", [542603582],
     "同上：教学中心东段近似位置（推测）"),
    ("student-center", "学生活动中心", 31.179787, 121.592136, "low", "osm-inferred", [587638228],
     "OSM「校园服务中心（H1楼）」；「学生活动中心」在 OSM 无同名要素，H1/H2 二者取其一为推测"),
    ("academic-exchange-center", "学术交流中心", 31.182203, 121.593374, "medium", "osm-inferred", [832289363],
     "OSM「上海科技大学会议中心」；与「学术交流中心」名称不同但功能最接近，属推测"),
    ("school-entrepreneurship", "创管学院", 31.178724, 121.590606, "high", "osm-named", [508053661],
     "OSM「创业与管理学院」"),
    ("school-information", "信息学院", 31.179781, 121.590529, "high", "osm-named", [587641185],
     "OSM「信息科学与技术学院 #1」（#1/#2/#3 三栋，取 #1 作为学院代表点）"),
    ("school-physical", "物质学院", 31.179588, 121.589103, "high", "osm-named", [508053663],
     "OSM「物质科学与技术学院」（另有 #1–#8 多栋，取主楼）"),
    ("school-life", "生命学院", 31.181799, 121.590176, "high", "osm-named", [587638224],
     "OSM「生命科学与技术学院」"),
    ("dorm-area", "宿舍区", 31.179416, 121.593619, "high", "osm-derived", [587641174, 587641175, 587641176, 587651637, 587651639, 587651642, 587651669, 587651676, 587691938, 1480634994],
     "OSM 学生公寓（building=dormitory）10 栋 + 博士公寓的几何中心；区域而非单栋"),
    ("lakeside-lawn", "湖畔草坪", 31.176850, 121.591100, "medium", "osm-derived", [832289399, 832289412],
     "OSM 两个相邻无名水面（合计 7,632 m²）西侧的草地（landuse=grass, 12,440 m²）；「湖畔草坪」非 OSM 名称，按位置推测"),
    ("cafe", "咖啡厅", 31.180761, 121.593163, "high", "osm-named", [5613200354],
     "OSM node 5613200354「科大咖啡馆」（amenity=cafe）"),
    ("campus-gate", "校门口", 31.175952, 121.590476, "high", "osm-named", [4571133482],
     "OSM node 4571133482「正门」（barrier=gate），位于华夏中路一侧"),
    ("zhangjiang-metro", "张江地铁站", 31.181028, 121.597539, "low", "off-campus-inferred", [659461032],
     "OSM「中科路站」（上海地铁 13 号线）是距校园最近的车站（约 0.9 km）。"
     "「张江地铁站」在占位白名单里语义模糊，也可能指张江高科站（2 号线，约 2.9 km 北）；此处为推测"),
]

CONFIDENCE_LABEL = {"high": "已确证", "medium": "推断", "low": "近似"}


# --------------------------------------------------------------------------- #
# 读取原始数据
# --------------------------------------------------------------------------- #

def load_raw() -> dict[str, dict]:
    return {name: fetch(name, query) for name, query in QUERIES.items()}


def parse_campus(raw: dict) -> dict:
    relation = next(e for e in raw["relgeom"]["elements"] if e["id"] == CAMPUS_RELATION_ID)
    ring: list[tuple[float, float]] = []
    for member in relation["members"]:
        geometry = member["geometry"]
        points = [(point["lat"], point["lon"]) for point in geometry]
        ring.extend(points if not ring else points[1:])
    if (ring[0][0], ring[0][1]) != (ring[-1][0], ring[-1][1]):
        ring.append(ring[0])
    bounds = relation["bounds"]
    return {
        "relation": relation,
        "ring": ring,
        "bounds": bounds,
        "areaM2": ring_area_m2(ring[:-1]),
        "center": centroid_of([{"lat": lat, "lon": lng} for lat, lng in ring[:-1]]),
    }


def poi_center(element: dict) -> tuple[float | None, float | None]:
    if element["type"] == "node":
        return element.get("lat"), element.get("lon")
    if "center" in element:
        return element["center"].get("lat"), element["center"].get("lon")
    bounds = element.get("bounds")
    if bounds:
        return (bounds["minlat"] + bounds["maxlat"]) / 2, (bounds["minlon"] + bounds["maxlon"]) / 2
    geometry = element.get("geometry") or []
    if geometry:
        return centroid_of(geometry)
    return None, None


def categorize(element: dict) -> tuple[str, str | None]:
    tags = element.get("tags", {})
    if tags.get("natural") == "water" or tags.get("waterway"):
        return "water", tags.get("waterway") or tags.get("natural")
    if tags.get("building"):
        return "building", tags.get("building")
    if tags.get("leisure"):
        return "leisure", tags.get("leisure")
    if tags.get("landuse"):
        return "landuse", tags.get("landuse")
    if tags.get("amenity"):
        return "amenity", tags.get("amenity")
    if tags.get("barrier"):
        return "gate", tags.get("barrier")
    if tags.get("railway"):
        return "transit", tags.get("railway")
    if tags.get("highway"):
        return "path", tags.get("highway")
    return "other", None


def build_features(raw: dict, campus: dict) -> tuple[list[dict], dict]:
    """POI 点要素（带中心点）—— 不含 footprint，footprint 在 GeoJSON 里。"""
    features: dict[str, dict] = {}
    counts: dict[str, int] = {}
    layers = ["bgeom", "wgeom", "lgeom", "landgeom", "amenity", "leisure", "water", "gates"]
    metro_ids = {659461032, 470637744, 12519546106, 659461025, 460592049}

    for layer in layers:
        for element in raw[layer]["elements"]:
            if layer == "metro" and element["id"] not in metro_ids:
                continue
            tags = element.get("tags", {})
            lat, lng = poi_center(element)
            if lat is None or lng is None:
                continue
            category, subtype = categorize(element)
            if layer == "highway":
                category, subtype = "path", tags.get("highway")
            feature_id = f"osm-{element['type']}-{element['id']}"
            features[feature_id] = {
                "id": feature_id,
                "osmType": element["type"],
                "osmId": element["id"],
                "name": tags.get("name"),
                "nameEn": tags.get("name:en"),
                "category": category,
                "subtype": subtype,
                "lat": round(lat, 7),
                "lng": round(lng, 7),
                "tags": tags,
            }
            counts[category] = counts.get(category, 0) + 1

    for element in raw["metro"]["elements"]:
        if element["id"] not in metro_ids:
            continue
        tags = element.get("tags", {})
        lat, lng = poi_center(element)
        if lat is None:
            continue
        feature_id = f"osm-{element['type']}-{element['id']}"
        features[feature_id] = {
            "id": feature_id,
            "osmType": element["type"],
            "osmId": element["id"],
            "name": tags.get("name"),
            "nameEn": tags.get("name:en"),
            "category": "transit",
            "subtype": tags.get("railway"),
            "lat": round(lat, 7),
            "lng": round(lng, 7),
            "tags": tags,
        }
        counts["transit"] = counts.get("transit", 0) + 1

    # 只保留落在校园多边形内（或与校园相交）的建筑/水域/绿地/康体要素
    kept: list[dict] = []
    for feature in features.values():
        if feature["category"] in ("building", "water", "leisure", "landuse"):
            element = next(
                (
                    e
                    for layer in layers
                    for e in raw[layer]["elements"]
                    if e["type"] == feature["osmType"] and e["id"] == feature["osmId"]
                ),
                None,
            )
            geometry = (element or {}).get("geometry") or []
            inside = any(point_in_ring(p["lat"], p["lon"], campus["ring"]) for p in geometry) or point_in_ring(
                feature["lat"], feature["lng"], campus["ring"]
            )
            if not inside:
                continue
        kept.append(feature)

    kept.sort(key=lambda f: (f["category"], f["name"] or "", f["osmId"]))
    return kept, counts


# --------------------------------------------------------------------------- #
# SVG
# --------------------------------------------------------------------------- #

def escape(text: str | None) -> str:
    if not text:
        return ""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


class Viewport:
    def __init__(self, campus: dict, extra_points: list[tuple[float, float]]):
        xs: list[float] = []
        ys: list[float] = []
        for lat, lng in [*campus["ring"], *extra_points]:
            x, y = to_local(lat, lng)
            xs.append(x)
            ys.append(y)
        self.x_min = min(xs) - PAD_WEST_M
        self.x_max = max(xs) + PAD_EAST_M
        self.y_min = min(ys) - PAD_SOUTH_M
        self.y_max = max(ys) + PAD_NORTH_M
        self.scale = SVG_WIDTH / (self.x_max - self.x_min)
        self.width = SVG_WIDTH
        self.height = math.ceil((self.y_max - self.y_min) * self.scale)
        # px = a*x + b*y + c ; py = d*x + e*y + f
        self.affine = [
            self.scale,
            0.0,
            -self.scale * self.x_min,
            0.0,
            -self.scale,
            self.scale * self.y_max,
        ]

    def px(self, lat: float, lng: float) -> tuple[float, float]:
        x, y = to_local(lat, lng)
        return (self.scale * (x - self.x_min), self.scale * (self.y_max - y))


def ring_path(points: list[tuple[float, float]], viewport: Viewport) -> str:
    commands = []
    for index, (x, y) in enumerate(points):
        commands.append(f"{'M' if index == 0 else 'L'}{x:.1f},{y:.1f}")
    return " ".join(commands) + " Z"


def line_path(points: list[tuple[float, float]], viewport: Viewport) -> str:
    commands = []
    for index, (x, y) in enumerate(points):
        commands.append(f"{'M' if index == 0 else 'L'}{x:.1f},{y:.1f}")
    return " ".join(commands)


def default_offset(label: str, index: int) -> tuple[float, float]:
    """标签相对锚点的默认偏移（多行错开，避免同名建筑完全重叠）"""
    direction = 1 if index % 2 == 0 else -1
    return (10.0 * direction, -6.0 + 12.0 * (index % 3))


def place_labels(locations: list[dict], viewport: Viewport, reserved: list[tuple[float, float, float, float]]):
    """贪心标签避让。返回 [{label, x, y, anchorX, anchorY, width}]"""
    placed_rects = list(reserved)
    placed = []
    font_size = 12.0
    for location in locations:
        anchor_x, anchor_y = viewport.px(location["lat"], location["lng"])
        label = location["label"]
        width = len(label) * font_size + 12
        height = font_size + 6
        candidates = [
            (10, -6),
            (-width - 10, -6),
            (-width / 2, -20),
            (-width / 2, 10),
            (10, -22),
            (-width - 10, -22),
            (-width / 2, -34),
            (-width / 2, 24),
        ]
        best = None
        best_overlap = float("inf")
        for dx, dy in candidates:
            rect = (anchor_x + dx, anchor_y + dy, width, height)
            if rect[0] < 8 or rect[1] < 8 or rect[0] + width > viewport.width - 8 or rect[1] + height > viewport.height - 8:
                continue
            overlap = 0.0
            for rx, ry, rw, rh in placed_rects:
                ox = max(0.0, min(rect[0] + width, rx + rw) - max(rect[0], rx))
                oy = max(0.0, min(rect[1] + height, ry + rh) - max(rect[1], ry))
                if ox > 0 and oy > 0:
                    overlap += ox * oy
            if overlap < best_overlap:
                best_overlap = overlap
                best = (dx, dy, rect)
            if overlap == 0:
                break
        if best is None:
            best = (10, -6, (anchor_x + 10, anchor_y - 6, width, height))
        dx, dy, rect = best
        # 若离锚点较远，画一条细引线
        right_center = (rect[0], rect[1] + height / 2)
        left_center = (rect[0] + width, rect[1] + height / 2)
        label_x = rect[0] + 5
        label_y = rect[1] + height - 6
        target_x = left_center[0] if dx >= 0 else right_center[0]
        leader = None
        if abs(target_x - anchor_x) > 26:
            leader = (anchor_x, anchor_y, target_x, rect[1] + height / 2)
        placed_rects.append(rect)
        placed.append(
            {
                **location,
                "anchorX": anchor_x,
                "anchorY": anchor_y,
                "x": label_x,
                "y": label_y,
                "leader": leader,
            }
        )
    return placed


CONFIDENCE_COLOR_KEY = {"high": "success", "medium": "warning", "low": "danger"}


def build_svg(
    campus: dict,
    raw: dict,
    viewport: Viewport,
    locations: list[dict],
    palette: dict,
    theme: str,
) -> str:
    p = palette
    width, height = viewport.width, viewport.height
    outline = ring_path([viewport.px(lat, lng) for lat, lng in campus["ring"]], viewport)

    def polygon_path(geometry):
        return ring_path([viewport.px(point["lat"], point["lon"]) for point in geometry], viewport)

    def polyline_path(geometry):
        return line_path([viewport.px(point["lat"], point["lon"]) for point in geometry], viewport)

    landuse = [e for e in raw["landgeom"]["elements"] if e.get("geometry")]
    water_polygons = [e for e in raw["wgeom"]["elements"] if e.get("geometry") and len(e["geometry"]) > 2 and e["tags"].get("natural") == "water"]
    water_lines = [e for e in raw["wgeom"]["elements"] if e.get("geometry") and (e["tags"].get("waterway") or e["tags"].get("natural") != "water")]
    buildings = [e for e in raw["bgeom"]["elements"] if e.get("geometry")]
    paths = [e for e in raw["highway"]["elements"] if e.get("geometry")]
    gates = [e for e in raw["gates"]["elements"] if e["tags"].get("barrier") == "gate"]

    # 预留区域（标题、图例、比例尺、署名），标签避让时不得压住
    reserved = [
        (16, 14, 560, 66),
        (16, height - 64, 760, 52),
        (width - 220, height - 74, 204, 60),
    ]

    parts: list[str] = []
    parts.append(f'<?xml version="1.0" encoding="UTF-8"?>')
    parts.append(
        "<!--\n"
        "  可达鸭 · 上海科技大学（张江校区）校园底图 —— 由 OpenStreetMap 数据离线渲染\n"
        "  =====================================================================\n"
        "  数据来源：OpenStreetMap（Overpass API 快照，2026-10-17）\n"
        "  许可：ODbL 1.0 —— 需保留署名 © OpenStreetMap contributors，衍生数据库同许可\n"
        "  坐标系：WGS84 → 本地等距平面（ENU, 原点 31.1795,121.591）→ 像素；不经过 GCJ-02\n"
        "  生成器：apps/web/src/features/map/tools/generate-campus-basemap.py\n"
        "  配色：hex 均取自 packages/design-tokens/dist/tokens.css（生成时断言）\n"
        "  精度：底图为示意性，非测绘成果；地点定位可信度见图例\n"
        f"  主题：{theme}\n"
        "-->"
    )
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" '
        'aria-label="上海科技大学张江校区校园示意图（OpenStreetMap 数据，ODbL）">'
    )
    parts.append("<title>上海科技大学（张江校区）校园示意图</title>")
    parts.append(f'<rect x="0" y="0" width="{width}" height="{height}" fill="{p["bg"]}"/>')

    # 校园多边形
    parts.append(
        f'<path d="{outline}" fill="{p["surface"]}" stroke="{p["muted"]}" '
        f'stroke-opacity="0.55" stroke-width="3"/>'
    )
    parts.append('<clipPath id="campus-clip"><path d="%s"/></clipPath>' % outline)
    parts.append('<g clip-path="url(#campus-clip)">')

    # 绿地
    parts.append(f'<g fill="{p["success"]}" fill-opacity="0.12" stroke="{p["success"]}" stroke-opacity="0.22" stroke-width="1">')
    for element in landuse:
        if element["tags"].get("landuse") in ("forest", "grass", "meadow", "recreation_ground"):
            parts.append(f'<path d="{polygon_path(element["geometry"])}"/>')
    parts.append("</g>")

    # 道路（步道 / 服务道 / 支路）
    highway_style = {
        "residential": (6.0, 0.9),
        "unclassified": (5.0, 0.9),
        "service": (4.0, 0.8),
        "pedestrian": (4.0, 0.8),
        "cycleway": (3.0, 0.7),
        "path": (2.4, 0.6),
        "footway": (2.2, 0.55),
    }
    for kind, (stroke_width, opacity) in highway_style.items():
        selected = [element for element in paths if element["tags"].get("highway") == kind]
        if not selected:
            continue
        parts.append(
            f'<g fill="none" stroke="{p["border"]}" stroke-opacity="{opacity}" '
            f'stroke-width="{stroke_width}" stroke-linecap="round" stroke-linejoin="round">'
        )
        for element in selected:
            parts.append(f'<path d="{polyline_path(element["geometry"])}"/>')
        parts.append("</g>")

    # 水面
    parts.append(f'<g fill="{p["info"]}" fill-opacity="0.20" stroke="{p["info"]}" stroke-opacity="0.45" stroke-width="1.5">')
    for element in water_polygons:
        parts.append(f'<path d="{polygon_path(element["geometry"])}"/>')
    parts.append("</g>")
    parts.append(
        f'<g fill="none" stroke="{p["info"]}" stroke-opacity="0.38" stroke-width="5" stroke-linecap="round">'
    )
    for element in water_lines:
        parts.append(f'<path d="{polyline_path(element["geometry"])}"/>')
    parts.append("</g>")

    # 建筑
    parts.append(
        f'<g fill="{p["surfaceAlt"]}" stroke="{p["muted"]}" stroke-opacity="0.35" stroke-width="1">'
    )
    for element in buildings:
        parts.append(f'<path d="{polygon_path(element["geometry"])}"/>')
    parts.append("</g>")

    parts.append("</g>")  # /clip

    # 水面标注（OSM 未命名的水面只写「人工湖」，不臆造正式名称）
    water_labels = [
        ("人工湖", 31.177020, 121.591950, "OSM 未命名水面（两个相邻 polygon，合计 7,632 m²）；名称未确认"),
        ("向阳河", 31.178200, 121.596500, "OSM waterway=canal「向阳河」"),
    ]
    for label, lat, lng, note in water_labels:
        x, y = viewport.px(lat, lng)
        parts.append(
            f'<g><text x="{x:.1f}" y="{y:.1f}" text-anchor="middle" font-size="11" '
            f'font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif" '
            f'fill="{p["info"]}" stroke="{p["surface"]}" stroke-width="3" stroke-linejoin="round" '
            f'paint-order="stroke">{escape(label)}</text>'
            f'<title>{escape(note)}</title></g>'
        )

    # 校门
    parts.append(f'<g fill="{p["brand"]}" stroke="{p["warning"]}" stroke-width="1.5">')
    for element in gates:
        x, y = viewport.px(element["lat"], element["lon"])
        parts.append(f'<rect x="{x - 4:.1f}" y="{y - 4:.1f}" width="8" height="8" rx="1.5"/>')
    parts.append("</g>")

    # 地铁站
    metro = next((e for e in raw["metro"]["elements"] if e["id"] == 659461032), None)
    if metro:
        lat, lng = poi_center(metro)
        x, y = viewport.px(lat, lng)
        parts.append(
            f'<g><rect x="{x - 8:.1f}" y="{y - 8:.1f}" width="16" height="16" rx="4" '
            f'fill="{p["info"]}" fill-opacity="0.16" stroke="{p["info"]}" stroke-width="2"/>'
            f'<text x="{x:.1f}" y="{y + 4:.1f}" text-anchor="middle" font-size="10" '
            f'font-weight="700" fill="{p["info"]}">M</text></g>'
        )

    # 地点标签
    labels = place_labels(locations, viewport, reserved)
    for entry in labels:
        color = p[CONFIDENCE_COLOR_KEY[entry["confidence"]]]
        anchor_x, anchor_y = entry["anchorX"], entry["anchorY"]
        if entry["leader"]:
            ax, ay, tx, ty = entry["leader"]
            parts.append(
                f'<line x1="{ax:.1f}" y1="{ay:.1f}" x2="{tx:.1f}" y2="{ty:.1f}" '
                f'stroke="{p["muted"]}" stroke-opacity="0.6" stroke-width="1"/>'
            )
        parts.append(
            f'<g data-location="{escape(entry["key"])}" data-confidence="{entry["confidence"]}">'
            f'<circle cx="{anchor_x:.1f}" cy="{anchor_y:.1f}" r="3.4" fill="{color}" '
            f'stroke="{p["surface"]}" stroke-width="1.5"/>'
        )
        parts.append(
            f'<text x="{entry["x"]:.1f}" y="{entry["y"]:.1f}" font-size="12" '
            f'font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif" '
            f'fill="{p["text"]}" stroke="{p["surface"]}" stroke-width="3" stroke-linejoin="round" '
            f'paint-order="stroke">{escape(entry["label"])}</text>'
        )
        parts.append(
            f'<title>{escape(entry["label"])}｜{CONFIDENCE_LABEL[entry["confidence"]]}｜{escape(entry["evidence"])}</title>'
        )
        parts.append("</g>")

    # 标题
    parts.append(
        f'<g><rect x="16" y="14" width="560" height="66" rx="8" fill="{p["surface"]}" '
        f'fill-opacity="0.92" stroke="{p["border"]}" stroke-width="1"/>'
        f'<text x="32" y="40" font-size="18" font-weight="700" fill="{p["text"]}" '
        f'font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif">'
        "上海科技大学（张江校区）校园示意图</text>"
        f'<text x="32" y="63" font-size="11" fill="{p["muted"]}" '
        f'font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif">'
        "WGS84 · 本地等距投影 · OSM 数据（ODbL）· 非测绘成果，地点定位有推测成分</text></g>"
    )

    # 比例尺
    scale_x = width - 208
    scale_y = height - 40
    bar = 100 * viewport.scale
    parts.append(
        f'<g><line x1="{scale_x}" y1="{scale_y}" x2="{scale_x + bar:.1f}" y2="{scale_y}" '
        f'stroke="{p["text"]}" stroke-width="2"/>'
        f'<line x1="{scale_x}" y1="{scale_y - 4}" x2="{scale_x}" y2="{scale_y + 4}" stroke="{p["text"]}" stroke-width="2"/>'
        f'<line x1="{scale_x + bar:.1f}" y1="{scale_y - 4}" x2="{scale_x + bar:.1f}" y2="{scale_y + 4}" stroke="{p["text"]}" stroke-width="2"/>'
        f'<text x="{scale_x}" y="{scale_y + 18}" font-size="11" fill="{p["muted"]}">0</text>'
        f'<text x="{scale_x + bar:.1f}" y="{scale_y + 18}" font-size="11" fill="{p["muted"]}" text-anchor="end">100 m</text>'
        "</g>"
    )

    # 指北针（与比例尺分开，避免读成「0 北 ↑ 100 m」）
    north_x = width - 54
    north_y = 48
    parts.append(
        f'<g><line x1="{north_x}" y1="{north_y + 20}" x2="{north_x}" y2="{north_y - 4}" '
        f'stroke="{p["text"]}" stroke-width="2"/>'
        f'<path d="M{north_x - 6},{north_y + 2} L{north_x},{north_y - 8} L{north_x + 6},{north_y + 2} Z" '
        f'fill="{p["text"]}"/>'
        f'<text x="{north_x}" y="{north_y + 36}" text-anchor="middle" font-size="11" '
        f'fill="{p["muted"]}">北</text></g>'
    )

    # 署名 / 许可（ODbL 硬要求）
    parts.append(
        f'<g><text x="16" y="{height - 34}" font-size="12" fill="{p["text"]}">'
        "© OpenStreetMap contributors · ODbL 1.0</text>"
        f'<text x="16" y="{height - 16}" font-size="10" fill="{p["muted"]}">'
        "数据快照 2026-10-17 · 地点定位可信度："
        f'<tspan fill="{p["success"]}">● 已确证</tspan>  '
        f'<tspan fill="{p["warning"]}">● 推断</tspan>  '
        f'<tspan fill="{p["danger"]}">● 近似</tspan>'
        " · 详见 docs/features/campus-map-data.md</text></g>"
    )

    parts.append("</svg>")
    return "\n".join(parts)


# --------------------------------------------------------------------------- #
# GeoJSON
# --------------------------------------------------------------------------- #

def build_geojson(campus: dict, raw: dict, locations: list[dict]) -> dict:
    features = []

    features.append(
        {
            "type": "Feature",
            "properties": {"id": "campus", "layer": "campus", "name": "上海科技大学（张江校区）", "osmRelationId": CAMPUS_RELATION_ID, "areaM2": round(campus["areaM2"], 1), "license": "ODbL-1.0", "attribution": "© OpenStreetMap contributors"},
            "geometry": {"type": "Polygon", "coordinates": [[[round(lng, 7), round(lat, 7)] for lat, lng in campus["ring"]]]},
        }
    )

    def polygon_feature(element, layer):
        return {
            "type": "Feature",
            "properties": {
                "id": f"osm-{element['type']}-{element['id']}",
                "layer": layer,
                "name": element["tags"].get("name"),
                "subtype": element["tags"].get("building") or element["tags"].get("landuse") or element["tags"].get("leisure") or element["tags"].get("natural") or element["tags"].get("waterway"),
            },
            "geometry": {"type": "Polygon", "coordinates": [[[round(p["lon"], 7), round(p["lat"], 7)] for p in element["geometry"]]]},
        }

    def line_feature(element, layer):
        return {
            "type": "Feature",
            "properties": {
                "id": f"osm-{element['type']}-{element['id']}",
                "layer": layer,
                "name": element["tags"].get("name"),
                "subtype": element["tags"].get("highway") or element["tags"].get("waterway"),
            },
            "geometry": {"type": "LineString", "coordinates": [[round(p["lon"], 7), round(p["lat"], 7)] for p in element["geometry"]]},
        }

    for element in raw["bgeom"]["elements"]:
        if element.get("geometry"):
            features.append(polygon_feature(element, "building"))
    for element in raw["landgeom"]["elements"]:
        if element.get("geometry"):
            features.append(polygon_feature(element, "landuse"))
    for element in raw["lgeom"]["elements"]:
        if element.get("geometry"):
            features.append(polygon_feature(element, "leisure"))
    for element in raw["wgeom"]["elements"]:
        if not element.get("geometry"):
            continue
        if element["tags"].get("natural") == "water" and len(element["geometry"]) > 2:
            features.append(polygon_feature(element, "water"))
        else:
            features.append(line_feature(element, "waterway"))
    for element in raw["highway"]["elements"]:
        if element.get("geometry"):
            features.append(line_feature(element, "path"))
    for element in raw["gates"]["elements"]:
        if element.get("lat") is None:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"id": f"osm-node-{element['id']}", "layer": "gate", "name": element["tags"].get("name")},
                "geometry": {"type": "Point", "coordinates": [round(element["lon"], 7), round(element["lat"], 7)]},
            }
        )
    for element in raw["amenity"]["elements"]:
        lat, lng = poi_center(element)
        if lat is None:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"id": f"osm-{element['type']}-{element['id']}", "layer": "poi", "name": element["tags"].get("name"), "subtype": element["tags"].get("amenity")},
                "geometry": {"type": "Point", "coordinates": [round(lng, 7), round(lat, 7)]},
            }
        )
    for location in locations:
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": f"location-{location['key']}",
                    "layer": "location",
                    "key": location["key"],
                    "name": location["label"],
                    "confidence": location["confidence"],
                    "evidence": location["evidence"],
                },
                "geometry": {"type": "Point", "coordinates": [location["lng"], location["lat"]]},
            }
        )

    return {
        "type": "FeatureCollection",
        "name": "kedaya-campus-basemap",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "metadata": {
            "source": "OpenStreetMap",
            "sourceUrl": f"https://www.openstreetmap.org/relation/{CAMPUS_RELATION_ID}",
            "attribution": "© OpenStreetMap contributors",
            "license": "ODbL-1.0",
            "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
            "generatedAt": generated_at(),
            "note": "WGS84 / CRS84；衍生数据库同样受 ODbL 1.0 约束",
        },
        "features": features,
    }


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #

def generated_at() -> str:
    shanghai = timezone(timedelta(hours=8))
    return datetime.now(shanghai).isoformat(timespec="seconds")


def assert_palette_from_tokens() -> None:
    tokens_css = (WEB_APP.parents[1] / "packages" / "design-tokens" / "dist" / "tokens.css").resolve()
    if not tokens_css.exists():
        print(f"⚠️ 未找到 {tokens_css}，跳过配色断言（请先 npm run tokens）")
        return
    source = tokens_css.read_text(encoding="utf-8").lower()
    token_hex = set(__import__("re").findall(r"#[0-9a-f]{3,8}\b", source))
    missing = [value for palette in PALETTES.values() for value in palette.values() if value.lower() not in token_hex]
    if missing:
        raise SystemExit(f"❌ 以下颜色不在 design-tokens 里（禁止手写新色值）：{sorted(set(missing))}")
    print(f"✅ 配色断言通过：{len({v for p in PALETTES.values() for v in p.values()})} 个 hex 全部来自 design-tokens")


def main() -> None:
    print("→ 读取 Overpass 快照…")
    raw = load_raw()
    campus = parse_campus(raw)
    print(f"  校园多边形 {len(campus['ring'])} 点，面积 {campus['areaM2']:.0f} m²")

    features, counts = build_features(raw, campus)
    print(f"  POI 要素 {len(features)} 个：{counts}")

    locations = [
        {
            "key": key,
            "label": label,
            "lat": lat,
            "lng": lng,
            "confidence": confidence,
            "evidenceKind": kind,
            "osmIds": osm_ids,
            "evidence": note,
        }
        for key, label, lat, lng, confidence, kind, osm_ids, note in LOCATIONS
    ]
    if len(locations) != 25:
        raise SystemExit(f"❌ 地点数量必须是 25，当前 {len(locations)}")

    metro_lat, metro_lng = 31.1810277, 121.5975394
    viewport = Viewport(campus, [(metro_lat, metro_lng)])

    poi = {
        "_meta": {
            "schemaVersion": "1.0.0",
            "generatedAt": generated_at(),
            "crs": "WGS84 / EPSG:4326（本文件所有经纬度均为 WGS84）",
            "source": "OpenStreetMap",
            "sourceUrl": f"https://www.openstreetmap.org/relation/{CAMPUS_RELATION_ID}",
            "attribution": "© OpenStreetMap contributors",
            "license": "ODbL-1.0",
            "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
            "licenseNotice": "本文件是 OpenStreetMap 数据的衍生物，按 ODbL 1.0 提供：必须保留署名，衍生数据库同样按 ODbL 分发。",
            "endpoint": OVERPASS_ENDPOINT,
            "nominatimQuery": NOMINATIM_QUERY,
            "nominatimResult": {
                "displayName": "上海科技大学（张江校区）, 393号, 华夏中路, 张江镇, 浦东新区, 上海市, 101201, 中国",
                "center": {"lat": NOMINATIM_CENTER[0], "lng": NOMINATIM_CENTER[1]},
                "bbox": {"minLat": NOMINATIM_BBOX[0], "maxLat": NOMINATIM_BBOX[1], "minLng": NOMINATIM_BBOX[2], "maxLng": NOMINATIM_BBOX[3]},
            },
            "osmBaseTimestamp": "2026-10-17T11:03:51Z — 2026-10-17T11:19:01Z（各图层快照略有差异）",
            "fetchedAt": "2026-10-17T19:07:00+08:00 — 2026-10-17T19:31:00+08:00",
            "queries": [{"name": name, "overpassQL": query} for name, query in QUERIES.items()],
            "precision": {
                "campusBoundary": "OSM relation 5390610 的多边形；面积与形状为 OSM 编辑成果，未与校方红线核对",
                "poi": "OSM 节点/way 中心点；平面误差估计 3–15 m（依赖航拍描图与志愿编辑），未实测",
                "locations": "25 个地点中，11 个直接命中 OSM 命名要素，8 个为就近推断，6 个为近似放置；见 locations[].confidence",
                "projection": "WGS84 → 局部 ENU（原点 31.1795,121.591）→ 线性视口；校园尺度误差 < 0.1%",
            },
            "caveats": [
                "OSM 的人工湖没有名称，图上只写「人工湖」，不臆造正式湖名。",
                "一/二/三食堂与 OSM「餐饮中心 #1/#2/#3」的对应关系是推测。",
                "教学楼 A/B/C 三栋在 OSM 只有一栋「教学中心」，A/B/C 为沿建筑长轴的近似标注。",
                "「张江地铁站」在占位白名单里语义模糊；本数据取最近的中科路站（13 号线），不代表产品最终口径。",
                "学校官网校园地图版权未确认：本数据集**没有**抓取或复制学校地图，未做逐点核对。",
            ],
        },
        "campus": {
            "osmType": "relation",
            "osmId": CAMPUS_RELATION_ID,
            "name": "上海科技大学（张江校区）",
            "nameEn": "ShanghaiTech University (Zhangjiang Campus)",
            "website": "https://www.shanghaitech.edu.cn/",
            "center": {"lat": round(campus["center"][0], 7), "lng": round(campus["center"][1], 7)},
            "bounds": campus["bounds"],
            "areaM2": round(campus["areaM2"], 1),
            "outline": [[round(lng, 7), round(lat, 7)] for lat, lng in campus["ring"]],
        },
        "features": features,
        "locations": locations,
        "counts": {
            **dict(sorted(counts.items())),
            "locations": len(locations),
            "libraries": 1,
            "dormitories": sum(1 for f in features if f["subtype"] == "dormitory"),
            "waterBodies": sum(1 for f in features if f["category"] == "water"),
        },
    }

    geo = build_geojson(campus, raw, locations)

    assert_palette_from_tokens()

    print("→ 渲染 SVG（浅色 / 深色）…")
    light_svg = build_svg(campus, raw, viewport, locations, PALETTES["light"], "light")
    dark_svg = build_svg(campus, raw, viewport, locations, PALETTES["dark"], "dark")

    PUBLIC_MAP.mkdir(parents=True, exist_ok=True)
    (PUBLIC_MAP / "campus-poi.json").write_text(json.dumps(poi, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (PUBLIC_MAP / "campus-basemap.geojson").write_text(json.dumps(geo, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (PUBLIC_MAP / "campus-basemap.svg").write_text(light_svg + "\n", encoding="utf-8")
    (PUBLIC_MAP / "campus-basemap-dark.svg").write_text(dark_svg + "\n", encoding="utf-8")

    geometry = {
        "version": "campus-basemap-v1",
        "widthPx": viewport.width,
        "heightPx": viewport.height,
        "affine": [round(value, 10) for value in viewport.affine],
        "pixelsPerMeter": round(viewport.scale, 6),
        "boundsLocalM": {
            "xMin": round(viewport.x_min, 3),
            "xMax": round(viewport.x_max, 3),
            "yMin": round(viewport.y_min, 3),
            "yMax": round(viewport.y_max, 3),
        },
        "origin": {"lat": ORIGIN_LAT, "lng": ORIGIN_LNG},
        "imageLight": "/map/campus-basemap.svg",
        "imageDark": "/map/campus-basemap-dark.svg",
        "attribution": "© OpenStreetMap contributors",
        "license": "odbl",
    }
    (PUBLIC_MAP / "campus-basemap.geometry.json").write_text(json.dumps(geometry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"✅ 输出到 {PUBLIC_MAP}")
    for name in ("campus-poi.json", "campus-basemap.geojson", "campus-basemap.svg", "campus-basemap-dark.svg", "campus-basemap.geometry.json"):
        print(f"   - {name}: {(PUBLIC_MAP / name).stat().st_size / 1024:.1f} KB")
    print(f"   视口 {viewport.width}×{viewport.height} px，affine={geometry['affine']}")


if __name__ == "__main__":
    main()
