'use client';

/**
 * 校园地图 · **底图切换面板**。
 *
 * 用户可以在两种底图之间切换：
 *
 * | 模式 | 底图 | 适合 |
 * | --- | --- | --- |
 * | `offline`（默认） | 仓库内离线渲染的 SVG/GeoJSON | 校园尺度的小径与草坪细节、**断网也能用**、小程序 web-view |
 * | `real` | Leaflet + OpenStreetMap 真实瓦片（需网络） | 看清校园在张江的位置、缩放拖拽、看校门与周边道路 |
 *
 * 两者都用 **WGS84**、都不经过 GCJ-02 —— 少一次转换就少一类偏移 bug。
 *
 * 默认给 `offline`：本模块的硬要求是"不依赖在线瓦片"（小程序 web-view 与离线场景
 * 都必须能用），在线瓦片只是**可选增强**。断网/瓦片不可达时页面仍然完整可用。
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { CampusLeafletMap, CAMPUS_BOUNDS, type CampusPoi } from './CampusLeafletMap';

interface CampusPoiFile {
  readonly _meta?: { readonly attribution?: string; readonly license?: string };
  readonly campus?: { readonly name?: string };
  readonly features?: readonly {
    readonly id: string;
    readonly name?: string | null;
    readonly category?: string;
    readonly lat?: number;
    readonly lng?: number;
  }[];
}

/** 从 `/map/campus-poi.json` 读真实 OSM POI（只保留有名字、有坐标的） */
async function loadCampusPois(signal: AbortSignal): Promise<CampusPoi[]> {
  const response = await fetch('/map/campus-poi.json', { signal });
  if (!response.ok) throw new Error(`读取校园 POI 失败：HTTP ${response.status}`);
  const data = (await response.json()) as CampusPoiFile;

  return (data.features ?? []).flatMap((feature) => {
    const name = typeof feature.name === 'string' ? feature.name.trim() : '';
    if (name.length === 0) return [];
    if (typeof feature.lat !== 'number' || typeof feature.lng !== 'number') return [];
    return [
      {
        id: feature.id,
        name,
        category: feature.category ?? 'other',
        lat: feature.lat,
        lng: feature.lng,
      },
    ];
  });
}

type BasemapMode = 'real' | 'offline';

export interface CampusBasemapToggleProps {
  /** 离线底图（由调用方传入，通常是已有的 `CampusMapView`） */
  readonly offlineView?: React.ReactNode;
  readonly className?: string;
}

export function CampusBasemapToggle({ offlineView, className }: CampusBasemapToggleProps) {
  const [mode, setMode] = useState<BasemapMode>('offline');

  const { data: pois = [], isLoading, isError, error } = useQuery({
    queryKey: ['campus-poi'],
    queryFn: ({ signal }) => loadCampusPois(signal),
    // POI 来自仓库内静态文件，内容不会变；重进页面不必重下
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });

  const markers = useMemo(
    () =>
      pois.slice(0, 0).map((poi) => ({
        // 占位：观测点由后续图层接入（这里先留结构，避免把未模糊化的坐标画出来）
        id: poi.id,
        lat: poi.lat,
        lng: poi.lng,
        label: poi.name,
      })),
    [pois],
  );

  return (
    <div className={className}>
      {/* ---- 底图切换 ---- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="底图选择"
          className="inline-flex overflow-hidden rounded-lg border border-border"
        >
<button
            type="button"
            role="tab"
            aria-selected={mode === 'offline'}
            onClick={() => setMode('offline')}
            className={
              mode === 'offline'
                ? 'bg-brand-soft px-3 py-1.5 text-sm font-medium text-brand-strong'
                : 'px-3 py-1.5 text-sm text-muted hover:text-body'
            }
          >
            离线底图（默认）
          </button>
<button
            type="button"
            role="tab"
            aria-selected={mode === 'real'}
            onClick={() => setMode('real')}
            className={
              mode === 'real'
                ? 'bg-brand-soft px-3 py-1.5 text-sm font-medium text-brand-strong'
                : 'px-3 py-1.5 text-sm text-muted hover:text-body'
            }
          >
            在线地图（需网络）
          </button>
        </div>
        <span className="text-xs text-muted">
          {mode === 'real'
            ? '在线瓦片 © OpenStreetMap contributors（ODbL）；需要网络，可缩放拖拽。'
            : '离线渲染（默认）：断网可用；校园尺度的小径与草坪比街道图更细，可叠加已模糊化的动物图层。'}
        </span>
      </div>

      {/* ---- 地图本体 ---- */}
      {mode === 'real' ? (
        <div className="overflow-hidden rounded-xl border border-border">
          {isLoading ? (
            <div className="flex h-[420px] items-center justify-center text-sm text-muted">
              正在加载校园地点…
            </div>
          ) : isError ? (
            <div className="flex h-[420px] flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm text-danger">校园地点加载失败</p>
              <p className="text-xs text-muted">
                {error instanceof Error ? error.message : '未知错误'}
              </p>
              <p className="text-xs text-muted">
                可以切到「离线底图」继续使用 —— 它不依赖网络。
              </p>
            </div>
          ) : (
            <CampusLeafletMap pois={pois} markers={markers} className="h-[420px]" />
          )}
        </div>
      ) : (
        <div>{offlineView}</div>
      )}

      {/* ---- 数据来源（许可要求，不能藏） ---- */}
      <p className="mt-2 text-xs text-muted">
        坐标范围 WGS84 {CAMPUS_BOUNDS.south.toFixed(6)}–{CAMPUS_BOUNDS.north.toFixed(6)}°N，
        {CAMPUS_BOUNDS.west.toFixed(6)}–{CAMPUS_BOUNDS.east.toFixed(6)}°E（OSM relation 5390610）。
        地图数据 © OpenStreetMap contributors，ODbL 1.0。
      </p>
    </div>
  );
}
