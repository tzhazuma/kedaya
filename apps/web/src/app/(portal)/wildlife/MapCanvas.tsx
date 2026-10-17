'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { WILDLIFE_CATEGORIES } from '@kedaya/contracts/wildlife';
import type { WildlifeSighting } from '@kedaya/contracts/wildlife';
import { CAMPUS_MAP, CAMPUS_PLACES, CAMPUS_FEATURED, campusPixel, campusCoordinate, isOnCampus } from '@kedaya/contracts/campus-map';
import type { WildlifePoint } from '@/domain/models/wildlife-coordinates';
import 'leaflet/dist/leaflet.css';
export type WildlifeBounds = { south: number; north: number; west: number; east: number };
export default function MapCanvas({ records, onSelect, onBounds, onPick, picked, picking, myPosition, focus }:
  { records: WildlifeSighting[]; onSelect: (items: WildlifeSighting[]) => void; onBounds: (b: WildlifeBounds) => void;
    onPick: (p: WildlifePoint) => void; picked: WildlifePoint | null; picking: boolean; myPosition: WildlifePoint | null; focus: WildlifePoint | null }) {
  const div = useRef<HTMLDivElement>(null), map = useRef<Leaflet.Map | null>(null), L = useRef<typeof Leaflet | null>(null);
  const layers = useRef<Leaflet.LayerGroup | null>(null), labels = useRef<Leaflet.LayerGroup | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [search, setSearch] = useState(''), [detail, setDetail] = useState(false);
  const callbacks = useRef({ onBounds, onSelect, onPick, picking });
  useEffect(() => { callbacks.current = { onBounds, onSelect, onPick, picking }; }, [onBounds, onSelect, onPick, picking]);
  useEffect(() => {
    let disposed = false;
    void import('leaflet').then(leaflet => {
      if (disposed || !div.current) return;
      L.current = leaflet;
      const extent = leaflet.latLngBounds([0, 0], [CAMPUS_MAP.height, CAMPUS_MAP.width]);
      const m = leaflet.map(div.current, { crs: leaflet.CRS.Simple, maxBounds: extent, maxBoundsViscosity: 1,
        minZoom: -4, maxZoom: 1, zoomSnap: .25, scrollWheelZoom: true }); map.current = m;
      leaflet.imageOverlay('/maps/shanghaitech-campus.jpg', extent, { alt: '上海科技大学官方校园详细底图', pane: 'tilePane' })
        .on('error', () => setError('校园底图加载失败，请刷新重试。')).addTo(m);
      m.attributionControl.addAttribution('底图与建筑：<a href="https://map.shanghaitech.edu.cn/" target="_blank">上海科技大学校园 GIS</a> · 物质塔：OpenStreetMap');
      // 初始视野必须铺满容器：按容器宽高取"cover"，移动端才不会变成中间一条小图。
      m.fitBounds(extent, { padding: [8, 8] });
      const fitZoom = m.getZoom(), box = m.getSize();
      const coverZoom = box.x > 0 && box.y > 0
        ? Math.max(Math.log2(box.x / CAMPUS_MAP.width), Math.log2(box.y / CAMPUS_MAP.height))
        : fitZoom;
      m.setMinZoom(fitZoom); m.setZoom(Math.min(1, Math.max(fitZoom, coverZoom)));
      layers.current = leaflet.layerGroup().addTo(m); labels.current = leaflet.layerGroup().addTo(m);
      const emitBounds = () => {
        const b = m.getBounds();
        const northWest = campusCoordinate(b.getWest(), CAMPUS_MAP.height - b.getNorth());
        const southEast = campusCoordinate(b.getEast(), CAMPUS_MAP.height - b.getSouth());
        callbacks.current.onBounds({ south: southEast.latitude, north: northWest.latitude, west: northWest.longitude, east: southEast.longitude });
      };
      m.on('moveend zoomend', emitBounds);
      m.on('click', (e: Leaflet.LeafletMouseEvent) => {
        if (!callbacks.current.picking) return;
        const point = campusCoordinate(e.latlng.lng, CAMPUS_MAP.height - e.latlng.lat);
        if (!isOnCampus(point)) { setError('请在上科大校园内部选择发现位置。'); return; }
        setError(''); callbacks.current.onPick(point);
      });
      emitBounds(); setReady(true);
    }).catch(() => setError('校园地图组件加载失败，请刷新。'));
    return () => { disposed = true; map.current?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const leaflet = L.current, group = labels.current; if (!ready || !leaflet || !group) return;
    group.clearLayers();
    for (const place of detail ? CAMPUS_PLACES : CAMPUS_FEATURED) {
      const text = document.createElement('span'); text.className = `wr-campus-label ${place.kind}`; text.textContent = place.name;
      const marker = leaflet.marker([CAMPUS_MAP.height - place.y, place.x], { icon: leaflet.divIcon({ html: text, className: 'wr-campus-label-anchor', iconSize: [0, 0] }) }).addTo(group);
      marker.on('click', () => { if (callbacks.current.picking) callbacks.current.onPick(place);
        else { map.current?.setView([CAMPUS_MAP.height - place.y, place.x], -.25); setSearch(''); } });
    }
  }, [ready, detail]);
  useEffect(() => {
    const leaflet = L.current, group = layers.current; if (!ready || !leaflet || !group) return; group.clearLayers();
    const buckets = new Map<string, WildlifeSighting[]>();
    // 服务端已在发布时校验过校园范围；这里不再用 isOnCampus 过滤，
    // 否则「模糊位置」取整后落到边界外的合法记录会从地图上消失。
    for (const r of records) { const key = `${Math.round(r.latitude * 3000)},${Math.round(r.longitude * 3000)}`; const items = buckets.get(key) ?? []; items.push(r); buckets.set(key, items); }
    for (const items of buckets.values()) {
      const r = items[0]!, p = campusPixel(r), c = WILDLIFE_CATEGORIES.find(c => c.id === r.category);
      const side = items.length > 1 ? 42 : 34, badge = document.createElement('span');
      badge.className = items.length > 1 ? 'wr-animal-marker multi' : 'wr-animal-marker';
      badge.style.background = c?.color ?? '#607b50';
      badge.textContent = items.length > 1 ? String(items.length) : c?.glyph ?? '野';
      const marker = leaflet.marker([CAMPUS_MAP.height - p.y, p.x], { riseOnHover: true,
        icon: leaflet.divIcon({ html: badge, className: 'wr-animal-marker-anchor', iconSize: [side, side], iconAnchor: [side / 2, side / 2] }) }).addTo(group);
      const text = document.createElement('span');
      text.textContent = items.length > 1 ? `${items.length} 次偶遇` : r.animal?.name ?? c?.label ?? r.category;
      marker.bindTooltip(text); marker.on('click', () => callbacks.current.onSelect(items));
    }
    if (myPosition && isOnCampus(myPosition)) { const p = campusPixel(myPosition); leaflet.circleMarker([CAMPUS_MAP.height - p.y, p.x], { radius: 8, color: '#fff', weight: 3, fillColor: '#287ce0', fillOpacity: 1 }).bindTooltip('我的位置（仅自己可见）').addTo(group); }
    if (picked && isOnCampus(picked)) { const p = campusPixel(picked); leaflet.circleMarker([CAMPUS_MAP.height - p.y, p.x], { radius: 12, color: '#e25838', fillColor: '#e25838', fillOpacity: .7 }).bindTooltip('已选发现位置', { permanent: true }).addTo(group); }
  }, [ready, records, myPosition, picked]);
  useEffect(() => { if (ready && focus && isOnCampus(focus)) { const p = campusPixel(focus); map.current?.setView([CAMPUS_MAP.height - p.y, p.x], -.25); } }, [ready, focus]);
  function go(place: typeof CAMPUS_PLACES[number]) { map.current?.setView([CAMPUS_MAP.height - place.y, place.x], -.25); setSearch(''); if (picking) onPick(place); }
  return <div className='wr-campus-map'>
    <div className='wr-campus-tools'><label><span>校园地标</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder='搜索物质塔、图书馆、宿舍、桥…' /></label>
      <button onClick={() => setDetail(v => !v)}>{detail ? '显示主要地标' : '显示全部建筑'}</button>
      <button onClick={() => map.current?.fitBounds([[0, 0], [CAMPUS_MAP.height, CAMPUS_MAP.width]])}>校园全景</button></div>
    {search && <div className='wr-campus-results'>{CAMPUS_PLACES.filter(p => p.name.includes(search)).slice(0, 10).map(p => <button key={p.id} onClick={() => go(p)}>{p.name}</button>)}</div>}
    <div className='wr-map-wrap'><div ref={div} className='wr-map' aria-label='仅上海科技大学校园内部的详细地图' />
      {error && <p className='wr-map-error'>{error}</p>}{picking && <div className='wr-pick-hint'>点击校园内部或地标，选择动物发现位置</div>}</div>
    <p className='wr-campus-note'>仅展示上科大校园 · 建筑、河道、桥梁可放大查看{myPosition && !isOnCampus(myPosition) ? ' · 你目前在校园范围外，地图保持在校内' : ''}</p>
  </div>;
}
