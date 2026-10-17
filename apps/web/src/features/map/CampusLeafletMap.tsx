'use client';

/**
 * 校园地图 · **真实瓦片版**（Leaflet + OpenStreetMap）。
 *
 * ## 与静态底图版（`CampusMapView`）的分工
 * 两个版本**不是替代关系，而是各有胜场**：
 *
 * | | 真实瓦片（本文件） | 静态底图（`CampusMapView`） |
 * | --- | --- | --- |
 * | 缩放/拖拽 | ✅ 真实地图交互 | ❌ 固定视图 |
 * | 校园外上下文 | ✅ 能看清学校在张江的哪一块 | ❌ 只有校内 |
 * | 校内小径/草坪 | ⚠️ OSM 在校园尺度的覆盖不完整 | ✅ 按真实 POI 手绘，信息密度更高 |
 * | 离线可用 | ❌ 需要网络（瓦片） | ✅ 纯静态资源 |
 * | 坐标系 | WGS84（OSM 原生） | WGS84 → 仿射到像素 |
 *
 * ⚠️ **两版都用 WGS84，都不经过 GCJ-02**。这是刻意的一致性：
 * 我们的唯一真相是 WGS84（契约 §2.6），只在渲染国内商业地图时才需要 GCJ-02 转换。
 * OSM 是 WGS84，所以这里**不需要**任何转换 —— 少一次转换就少一类偏移 bug。
 *
 * ## 为什么不用高德/腾讯瓦片
 * 它们需要 API key、需要 GCJ-02、且有商用授权问题。OSM 无 key、无授权门槛
 * （ODbL，署名即可），适合学生项目。要换商业底图时，只需替换 `TILE_URL` 与
 * 加一层 `wgs84ToGcj02`（已有 `packages/shared/src/geo/gcj02.ts`）。
 *
 * ## 许可
 * 底图瓦片 © OpenStreetMap contributors（ODbL）。
 * 署名**必须**显示在地图上，不能藏起来 —— 这是使用 OSM 瓦片的硬性条件。
 */

import { useEffect, useRef } from 'react';

/** OSM 标准瓦片（无 key）。换商业底图时改这一行即可。 */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

/** 上海科技大学（张江校区）的范围，来自 OSM relation 5390610 */
export const CAMPUS_BOUNDS = {
  south: 31.175546,
  west: 121.5844916,
  north: 31.1830156,
  east: 121.5975,
} as const;

export const CAMPUS_CENTER = {
  lat: 31.1785176,
  lng: 121.5909954,
} as const;

export interface CampusPoi {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly lat: number;
  readonly lng: number;
}

export interface CampusMapMarker {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly label: string;
  /** 语义色调 → 由 `currentColor` 走设计令牌，**不在这里写色值** */
  readonly tone?: 'brand' | 'danger' | 'success' | 'warning';
}

export interface CampusLeafletMapProps {
  /** 校园 POI（来自 `/map/campus-poi.json`，真实 OSM 数据） */
  readonly pois?: readonly CampusPoi[];
  /** 观测点 / 轨迹点（已按契约 §11.14 模糊化） */
  readonly markers?: readonly CampusMapMarker[];
  /** 高亮某个地点（用于列表 ↔ 地图联动） */
  readonly selectedId?: string | null;
  readonly className?: string;
}

const TONE_VAR: Record<NonNullable<CampusMapMarker['tone']>, string> = {
  brand: 'var(--kdy-color-brand)',
  danger: 'var(--kdy-color-danger)',
  success: 'var(--kdy-color-success)',
  warning: 'var(--kdy-color-warning)',
};

/** 点位描边色：跟随主题的表面色（浅色白 / 深色深蓝），不手写 hex */
const SURFACE_VAR = 'var(--kdy-color-surface)';

/**
 * 真实瓦片地图。
 *
 * ⚠️ Leaflet 必须在**客户端**初始化（它直接操作 DOM），且只能初始化一次 ——
 * React 严格模式下 effect 会跑两次，重复初始化会让地图控件叠加。
 * 因此用 `mapRef.current` 做幂等保护，并在卸载时 `remove()`。
 */
export function CampusLeafletMap({
  pois = [],
  markers = [],
  selectedId = null,
  className,
}: CampusLeafletMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const poiLayerRef = useRef<any>(null);
  const markerLayerRef = useRef<any>(null);

  /* ---------- 初始化（只做一次） ---------- */
  useEffect(() => {
    let disposed = false;

    void (async () => {
      const L = (await import('leaflet')).default;
      // Leaflet 的样式必须显式引入，否则瓦片会拼错位
      await import('leaflet/dist/leaflet.css');

      if (disposed || containerRef.current === null || mapRef.current !== null) return;

      const map = L.map(containerRef.current, {
        center: [CAMPUS_CENTER.lat, CAMPUS_CENTER.lng],
        zoom: 16,
        zoomControl: true,
        // 校园尺度下滚轮缩放容易误触，改为需要按住 ⌘/Ctrl
        scrollWheelZoom: false,
        attributionControl: true,
      });

      L.tileLayer(TILE_URL, {
        maxZoom: 19,
        // ⚠️ 署名必须存在 —— OSM 使用条件
        attribution: TILE_ATTRIBUTION,
      }).addTo(map);

      // 校园边界（虚线，提示"这是我们关心的范围"）
      L.rectangle(
        [
          [CAMPUS_BOUNDS.south, CAMPUS_BOUNDS.west],
          [CAMPUS_BOUNDS.north, CAMPUS_BOUNDS.east],
        ],
        {
          color: TONE_VAR.brand,
          weight: 1.5,
          dashArray: '6 4',
          fill: false,
        },
      ).addTo(map);

      poiLayerRef.current = L.layerGroup().addTo(map);
      markerLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      poiLayerRef.current = null;
      markerLayerRef.current = null;
    };
  }, []);

  /* ---------- POI 图层 ---------- */
  useEffect(() => {
    void (async () => {
      const L = (await import('leaflet')).default;
      const layer = poiLayerRef.current;
      if (layer === null) return;
      layer.clearLayers();

      for (const poi of pois) {
        const isSelected = poi.id === selectedId;
        const circle = L.circleMarker([poi.lat, poi.lng], {
          radius: isSelected ? 9 : 5,
          color: SURFACE_VAR,
          weight: 2,
          fillColor: TONE_VAR.brand,
          fillOpacity: isSelected ? 1 : 0.75,
        });
        if (poi.name.length > 0) {
          circle.bindTooltip(poi.name, { direction: 'top', offset: [0, -8] });
        }
        circle.addTo(layer);
      }
    })();
  }, [pois, selectedId]);

  /* ---------- 观测点图层 ---------- */
  useEffect(() => {
    void (async () => {
      const L = (await import('leaflet')).default;
      const layer = markerLayerRef.current;
      if (layer === null) return;
      layer.clearLayers();

      for (const marker of markers) {
        L.circleMarker([marker.lat, marker.lng], {
          radius: 6,
          color: SURFACE_VAR,
          weight: 2,
          fillColor: TONE_VAR[marker.tone ?? 'success'],
          fillOpacity: 0.9,
        })
          .bindTooltip(marker.label, { direction: 'top', offset: [0, -8] })
          .addTo(layer);
      }
    })();
  }, [markers]);

  return (
    <div
      ref={containerRef}
      className={className}
      // Leaflet 需要容器有确定高度；调用方可以用 className 覆盖
      style={{ width: '100%', height: '100%', minHeight: 360 }}
      // 地图是交互控件，给一个可读的名字（无障碍）
      role="application"
      aria-label="上海科技大学张江校区地图（OpenStreetMap 底图）"
    />
  );
}
