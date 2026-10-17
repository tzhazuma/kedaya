'use client';
import { isOnCampus } from '@kedaya/contracts/campus-map';
import { useEffect, useRef, useState } from 'react';
import { WILDLIFE_CATEGORIES } from '@kedaya/contracts/wildlife';
import type { WildlifeAnimal, WildlifePhoto, WildlifeSighting } from '@kedaya/contracts/wildlife';
import type { WildlifePoint } from '@/domain/models/wildlife-coordinates';
import { fetchAnimals, photoUrl, wildlifeQuery, wildlifeRequest } from './api';

export function CategorySelect({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return <select value={value} onChange={e => onChange(e.target.value)}>{WILDLIFE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>;
}
function PhotoUpload({ value, onChange, onBusy, max }: { value: WildlifePhoto[]; onChange: (p: WildlifePhoto[]) => void; onBusy: (b: boolean) => void; max: number }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function upload(files: FileList | null) {
    if (!files) return; setBusy(true); onBusy(true); setError(''); const saved: WildlifePhoto[]=[];
    try { for(const file of [...files].slice(0,max-value.length)) {
      if(file.size>8*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('请选择不超过 8MB 的 JPEG、PNG 或 WebP 图片');
      const body=new FormData();body.append('file',file);saved.push(await wildlifeRequest<WildlifePhoto>('photos',{method:'POST',body}));
    } } catch(e){setError(e instanceof Error?e.message:'照片上传失败');} finally{onChange([...value,...saved]);setBusy(false);onBusy(false);}
  }
  return <div><div className='wr-photo-grid'>{value.map(p=><div key={p.id}><img src={photoUrl(p)} alt='已上传的动物照片' /><button type='button' onClick={()=>onChange(value.filter(v=>v.id!==p.id))}>移除</button></div>)}</div>
    {value.length<max&&<label className='wr-upload'>{busy?'上传中…':'＋ 拍照 / 选择照片'}<input type='file' accept='image/jpeg,image/png,image/webp' multiple={max>1} disabled={busy} onChange={e=>{void upload(e.target.files);e.target.value='';}} /></label>}
    <small>最多 {max} 张，每张不超过 8MB；发布后的照片可在不同设备查看。</small>{error&&<p role='alert' className='wr-error'>{error}</p>}</div>;
}
function newKey(){return globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`;}
function dateInput(value?: string){const d=value?new Date(value):new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export function EncounterForm({ point, original, animal, onPick, onClose, onSaved, onCreateAnimal }: {
  point: WildlifePoint | null; original?: WildlifeSighting; animal?: WildlifeAnimal; onPick: () => void; onClose: () => void; onSaved: (sighting: WildlifeSighting) => void; onCreateAnimal: () => void;
}) {
  const [category,setCategory]=useState(original?.category??animal?.category??'cat'),[description,setDescription]=useState(original?.description??''),[place,setPlace]=useState(original?.place??'');
  const [photos,setPhotos]=useState<WildlifePhoto[]>(original?.photos??[]),[blurred,setBlurred]=useState(original?.locationBlurred??false),[observed,setObserved]=useState(dateInput(original?.observedAt));
  const [animalId,setAnimalId]=useState(original?.animalId??animal?.id??''),[search,setSearch]=useState(''),[animals,setAnimals]=useState<WildlifeAnimal[]>([]);
  const [busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[error,setError]=useState(''),key=useRef(newKey()),lock=useRef(false);
  const [lat,setLat]=useState(String(point?.latitude??original?.latitude??'')),[lng,setLng]=useState(String(point?.longitude??original?.longitude??''));
  useEffect(()=>{if(point){setLat(String(point.latitude));setLng(String(point.longitude));}},[point]);
  useEffect(()=>{if(animal){setCategory(animal.category);setAnimalId(animal.id);}},[animal]);
  useEffect(()=>{let cancelled=false;const timer=setTimeout(()=>{void fetchAnimals(wildlifeQuery({category,search,limit:100})).then(p=>{if(!cancelled)setAnimals(p.items);}).catch(e=>{if(!cancelled)setError(e.message);});},300);return()=>{cancelled=true;clearTimeout(timer);};},[category,search]);
  async function submit(e: React.FormEvent){e.preventDefault();if(lock.current)return;setError('');const latitude=Number(lat),longitude=Number(lng),d=new Date(observed);
    const originalBlur = original?.locationBlurred && latitude===original.latitude && longitude===original.longitude;
    if(!lat.trim()||!lng.trim()||(!isOnCampus({latitude,longitude})&&!originalBlur)){setError('请选择上科大校园内部的真实发现位置');return;}
    if(!Number.isFinite(d.getTime())||d.getTime()>Date.now()+300000){setError('请填写正确的发现时间');return;}
    lock.current=true;setBusy(true);try{const body={category,description,place,latitude,longitude,locationBlurred:blurred,observedAt:d.toISOString(),animalId:animalId||null,photoIds:photos.map(p=>p.id),...(!original?{clientRequestId:key.current}:{})};
      const saved=await wildlifeRequest<WildlifeSighting>(original?`sightings/${original.id}`:'sightings',{method:original?'PATCH':'POST',body:JSON.stringify(body)});onSaved(saved);
    }catch(e){setError(e instanceof Error?e.message:'发布失败');}finally{lock.current=false;setBusy(false);}}
  return <form onSubmit={e=>{void submit(e);}} className='wr-form'><div className='wr-modal-title'><div><small>LEAVE A CAMPUS POSTCARD</small><h2>{original?'编辑偶遇':'记录一次偶遇'}</h2></div><button type='button' onClick={onClose}>关闭 ×</button></div>
    <label>动物类别<CategorySelect value={category} onChange={v=>{setCategory(v);setAnimalId('');}} /></label>
    <div className='wr-actions'><button type='button' onClick={onPick}>在地图上选点</button><span>{lat&&lng?'已填入发现坐标':'尚未选择发现位置'}</span></div>
    <div className='wr-form-grid'><label>纬度（GCJ-02）<input required type='number' step='any' min='-90' max='90' value={lat} onChange={e=>setLat(e.target.value)} /></label><label>经度（GCJ-02）<input required type='number' step='any' min='-180' max='180' value={lng} onChange={e=>setLng(e.target.value)} /></label></div>
    <label>发现地点<input required maxLength={200} value={place} onChange={e=>setPlace(e.target.value)} placeholder='例如：图书馆东侧草坪' /></label>
    <label className='wr-check'><input type='checkbox' checked={blurred} onChange={e=>setBlurred(e.target.checked)} />模糊位置（约百米，不保存精确点）</label>
    {original?.locationBlurred&&<small>这条记录的坐标已按约百米模糊保存。取消勾选不会恢复精确位置；重新在地图上选点可以保存新的精确位置。</small>}
    <label>偶遇照片</label><PhotoUpload value={photos} onChange={setPhotos} onBusy={setUploading} max={6} />
    <label>写一段校园故事<textarea required maxLength={1500} value={description} onChange={e=>setDescription(e.target.value)} placeholder='它在做什么？有什么有趣的瞬间？' /></label>
    <label>发现时间<input required type='datetime-local' value={observed} onChange={e=>setObserved(e.target.value)} /></label>
    <label>关联已有居民（可选）<input value={search} onChange={e=>setSearch(e.target.value)} placeholder='搜索昵称、外貌或区域' /><select value={animalId} onChange={e=>setAnimalId(e.target.value)}><option value=''>暂不关联身份卡</option>
      {animalId&&!animals.some(a=>a.id===animalId)&&<option value={animalId}>{animal?.name??original?.animal?.name??'已关联居民'}</option>}{animals.map(a=><option key={a.id} value={a.id}>{a.name} · {a.commonArea} · {a.appearance.slice(0,30)}</option>)}</select></label>
    <button type='button' onClick={onCreateAnimal}>先去档案馆搜索 / 建立身份卡</button><small>这是一条历史观察记录，不代表动物或观察者的实时位置。</small>{error&&<p role='alert' className='wr-error'>{error}</p>}
    <button className='wr-primary' type='submit' disabled={busy||uploading}>{busy?'正在保存…':uploading?'等待照片上传…':original?'保存修改':'发布偶遇明信片'}</button>
  </form>;
}
export function AnimalForm({ original, onClose, onSaved, onExisting }: { original?: WildlifeAnimal; onClose:()=>void;onSaved:(a:WildlifeAnimal)=>void;onExisting:(a:WildlifeAnimal)=>void }){
  const [name,setName]=useState(original?.name??''),[category,setCategory]=useState(original?.category??'cat'),[appearance,setAppearance]=useState(original?.appearance??''),[area,setArea]=useState(original?.commonArea??''),[description,setDescription]=useState(original?.description??'');
  const [photos,setPhotos]=useState<WildlifePhoto[]>(original?.avatar?[original.avatar]:[]),[candidates,setCandidates]=useState<WildlifeAnimal[]>([]),[checked,setChecked]=useState(false),[searched,setSearched]=useState(false);
  const [busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[error,setError]=useState(''),key=useRef(newKey()),lock=useRef(false);
  useEffect(()=>{if(original)return;let cancel=false;setChecked(false);setSearched(false);const timer=setTimeout(()=>{void fetchAnimals(wildlifeQuery({category,search:name,limit:12})).then(p=>{if(!cancel){setCandidates(p.items);setSearched(true);}}).catch(e=>{if(!cancel)setError(e.message);});},400);return()=>{cancel=true;clearTimeout(timer);};},[category,name,original]);
  async function submit(e:React.FormEvent){e.preventDefault();if(lock.current)return;if(!original&&(!checked||!searched)){setError('请先核对已有身份卡，确认不是同一只动物');return;}lock.current=true;setBusy(true);setError('');try{
    const saved=await wildlifeRequest<WildlifeAnimal>(original?`animals/${original.id}`:'animals',{method:original?'PATCH':'POST',body:JSON.stringify({name,category,appearance,commonArea:area,description,avatarId:photos[0]?.id??null,...(!original?{clientRequestId:key.current}:{})})});onSaved(saved);
  }catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{lock.current=false;setBusy(false);}}
  return <form className='wr-form' onSubmit={e=>{void submit(e);}}><div className='wr-modal-title'><div><small>CAMPUS RESIDENT IDENTITY</small><h2>{original?'编辑身份卡':'建立居民身份卡'}</h2></div><button type='button' onClick={onClose}>关闭 ×</button></div>
    <label>居民昵称（允许重名）<input required maxLength={60} value={name} onChange={e=>setName(e.target.value)} placeholder='例如：橘子' /></label><label>动物类别<CategorySelect value={category} onChange={setCategory}/></label>
    {!original&&<section className='wr-similar'><h3>先看看，它已经有名字了吗？</h3><p>核对外貌和区域，避免重复建档。</p>{candidates.map(a=><button type='button' key={a.id} onClick={()=>onExisting(a)}>{a.name} · {a.commonArea||'区域待补充'}<small>{a.appearance}</small></button>)}
      {searched&&!candidates.length&&<p>当前没有找到相似昵称，可以更换名字再次搜索。</p>}<label className='wr-check'><input type='checkbox' checked={checked} disabled={!searched} onChange={e=>setChecked(e.target.checked)}/>已核对，没有发现同一位居民</label></section>}
    <label>身份照片</label><PhotoUpload value={photos} onChange={setPhotos} max={1} onBusy={setUploading}/><label>外貌特征<textarea maxLength={500} value={appearance} onChange={e=>setAppearance(e.target.value)} placeholder='毛色、花纹、体型等辨识特征'/></label>
    <label>常见出没区域<input maxLength={200} value={area} onChange={e=>setArea(e.target.value)} /></label><label>居民小传<textarea maxLength={1500} value={description} onChange={e=>setDescription(e.target.value)} /></label>
    {error&&<p role='alert' className='wr-error'>{error}</p>}<button type='submit' className='wr-primary' disabled={busy||uploading}>{busy?'保存中…':original?'保存身份卡':'建立共享身份卡'}</button></form>;
}
