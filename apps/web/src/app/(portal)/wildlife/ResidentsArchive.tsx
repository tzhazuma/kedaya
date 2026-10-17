'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WILDLIFE_CAMPUS, WILDLIFE_CATEGORIES } from '@kedaya/contracts/wildlife';
import type { WildlifeAnimal, WildlifeSighting } from '@kedaya/contracts/wildlife';
import { CAMPUS_BOUNDS } from '@kedaya/contracts/campus-map';
import { wgsToGcj, type WildlifePoint } from '@/domain/models/wildlife-coordinates';
import MapCanvas from './MapCanvas';
import type { WildlifeBounds } from './MapCanvas';
import { AnimalForm, EncounterForm } from './ArchiveForms';
import { currentWildlifeUser, fetchAnimals, fetchSightings, photoUrl, wildlifeLogin, wildlifeQuery, wildlifeRequest, wildlifeSignOut } from './api';
import './wildlife.css';

const label=(id:string)=>WILDLIFE_CATEGORIES.find(c=>c.id===id)?.label??id;
const when=(date:string)=>new Date(date).toLocaleString('zh-CN');
export default function ResidentsArchive(){
  const [tab,setTab]=useState<'map'|'animals'>('map'),[category,setCategory]=useState(''),[days,setDays]=useState(0),[search,setSearch]=useState('');
  const [bounds,setBounds]=useState<WildlifeBounds>(CAMPUS_BOUNDS);
  const [records,setRecords]=useState<WildlifeSighting[]>([]),[animals,setAnimals]=useState<WildlifeAnimal[]>([]),[cursor,setCursor]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<WildlifeSighting[]>([]),[resident,setResident]=useState<WildlifeAnimal|null>(null);
  const [editor,setEditor]=useState<'sighting'|'animal'|null>(null),[editingRecord,setEditingRecord]=useState<WildlifeSighting|undefined>(),[editingAnimal,setEditingAnimal]=useState<WildlifeAnimal|undefined>();
  const [related,setRelated]=useState<WildlifeAnimal|undefined>(),[picked,setPicked]=useState<WildlifePoint|null>(null),[picking,setPicking]=useState(false),[focus,setFocus]=useState<WildlifePoint|null>(null),[position,setPosition]=useState<WildlifePoint|null>(null);
  const [nestedAnimal,setNestedAnimal]=useState(false);
  const [user,setUser]=useState<ReturnType<typeof currentWildlifeUser>>(null),[student,setStudent]=useState('20260001'),[authBusy,setAuthBusy]=useState(false),[locating,setLocating]=useState(false);
  const seq=useRef(0),watch=useRef<number|null>(null),[revision,setRevision]=useState(0);
  const refresh=()=>setRevision(n=>n+1);
  const updateBounds=useCallback((b:WildlifeBounds)=>setBounds(old=>JSON.stringify(old)===JSON.stringify(b)?old:b),[]);
  useEffect(()=>{
    let cancelled=false;setUser(currentWildlifeUser());
    // 首次进入自动定位一次；不持续监听，避免在用户未主动开启时跟踪位置。
    if(navigator.geolocation) navigator.geolocation.getCurrentPosition(
      r=>{if(cancelled)return;const p=wgsToGcj({latitude:r.coords.latitude,longitude:r.coords.longitude});setPosition(p);setFocus(p);},
      ()=>undefined,{enableHighAccuracy:true,timeout:8000,maximumAge:60000});
    return()=>{cancelled=true;if(watch.current!==null)navigator.geolocation?.clearWatch(watch.current);};
  },[]);
  useEffect(()=>{
    const n=++seq.current;setBusy(true);setError('');setCursor(null);
    const timer=setTimeout(()=>{
      const query=wildlifeQuery(tab==='map'?{...bounds,category,limit:100,since:days?new Date(Date.now()-days*86400000).toISOString():undefined}:{category,search,limit:30});
      const result=tab==='map'?fetchSightings(query):fetchAnimals(query);
      void result.then(page=>{if(seq.current!==n)return;if(tab==='map')setRecords(page.items as WildlifeSighting[]);else setAnimals(page.items as WildlifeAnimal[]);setCursor(page.nextCursor);})
        .catch(e=>{if(seq.current===n)setError(e.message);}).finally(()=>{if(seq.current===n)setBusy(false);});
    },250);
    return()=>{clearTimeout(timer);seq.current++;};
  },[tab,category,search,days,bounds,revision]);
  async function more(){if(!cursor||busy)return;const n=seq.current;setBusy(true);try{
    const query=wildlifeQuery(tab==='map'?{...bounds,category,limit:100,cursor,since:days?new Date(Date.now()-days*86400000).toISOString():undefined}:{category,search,limit:30,cursor});
    if(tab==='map'){const p=await fetchSightings(query);if(seq.current!==n)return;setRecords(old=>[...old,...p.items]);setCursor(p.nextCursor);}else{const p=await fetchAnimals(query);if(seq.current!==n)return;setAnimals(old=>[...old,...p.items]);setCursor(p.nextCursor);}
  }catch(e){setError(e instanceof Error?e.message:'加载失败');}finally{if(seq.current===n)setBusy(false);}}
  function locate(){if(!navigator.geolocation){setError('浏览器不支持定位，仍可在地图上选点。');return;}if(watch.current!==null)navigator.geolocation.clearWatch(watch.current);let first=true;setLocating(true);setError('');
    watch.current=navigator.geolocation.watchPosition(r=>{setLocating(false);const p=wgsToGcj({latitude:r.coords.latitude,longitude:r.coords.longitude});setPosition(p);if(first){setFocus(p);first=false;}},()=>{setLocating(false);setError('定位被拒绝或不可用。仍可浏览地图，并手动选点发布。');},{enableHighAccuracy:true,timeout:15000,maximumAge:10000});}
  function createRecord(animal?:WildlifeAnimal){if(!user){setError('请先在账号栏连接共享服务账号，再记录偶遇。');return;}setRelated(animal);setNestedAnimal(false);setEditingRecord(undefined);setPicked(null);setResident(null);setSelected([]);setEditor('sighting');setTab('map');}
  function createAnimal(){if(!user){setError('请先连接共享服务账号，再建立身份卡。');return;}setNestedAnimal(false);setEditingAnimal(undefined);setResident(null);setEditor('animal');}
  async function login(){setAuthBusy(true);setError('');try{setUser(await wildlifeLogin(student));}catch(e){setError(e instanceof Error?e.message:'登录失败');}finally{setAuthBusy(false);}}
  async function remove(record:WildlifeSighting){if(!window.confirm('删除这次偶遇？删除后其他同学也将无法查看。'))return;try{await wildlifeRequest(`sightings/${record.id}`,{method:'DELETE'});setSelected([]);refresh();}catch(e){setError(e instanceof Error?e.message:'删除失败');}}
  return <div className='wr-page'>
    <header className='wr-header'><div><p className='wr-eyebrow'>SHANGHAITECH · WILD RESIDENTS ARCHIVE</p><h1>野生居民档案<span>记录每一次偶遇，认识校园里的每一位野生居民。</span></h1></div><div className='wr-stamp'>校园<br/>共栖日记</div></header>
    <div className='wr-toolbar'><nav aria-label='野生居民导航'><button className={tab==='map'?'active':''} onClick={()=>setTab('map')}>野生居民地图</button><button className={tab==='animals'?'active':''} onClick={()=>setTab('animals')}>居民档案馆</button></nav>
      <a href='https://map.shanghaitech.edu.cn/' target='_blank' rel='noreferrer'>学校官方导览 ↗</a></div>
    <section className='wr-auth' aria-label='共享服务账号'>{user?<><span>以 {user.user.displayName} 记录 · 与全校共享</span><button onClick={()=>{wildlifeSignOut();setUser(null);}}>退出账号</button></>:<><span>公开档案可直接浏览</span><label>开发账号<input aria-label='8 位测试学号' value={student} maxLength={8} onChange={e=>setStudent(e.target.value)} /></label><button disabled={authBusy} onClick={()=>{void login();}}>{authBusy?'连接中…':'连接共享服务'}</button><small>目前复用现有开发认证，不代表真实校园认证。</small></>}</section>
    <div className='wr-filters'><button className={!category?'active':''} onClick={()=>setCategory('')}>全部居民</button>{WILDLIFE_CATEGORIES.map(c=><button className={category===c.id?'active':''} key={c.id} onClick={()=>setCategory(c.id)}><i style={{background:c.color}}/>{c.label}</button>)}</div>
    {error&&<div className='wr-error' role='alert'>{error}<button onClick={refresh}>重新同步</button></div>}
    {tab==='map'?<><div className='wr-map-tools'><div>{[0,1,7,30].map(n=><button key={n} className={days===n?'active':''} onClick={()=>setDays(n)}>{n?`最近 ${n} 天`:'全部时间'}</button>)}</div><div><button disabled={locating} onClick={locate}>{locating?'定位中…':'◎ 我的位置'}</button><button onClick={()=>setFocus({...WILDLIFE_CAMPUS})}>回到校园</button><button onClick={refresh}>刷新</button></div></div>
      <MapCanvas records={records} onSelect={setSelected} onBounds={updateBounds} picking={picking} picked={picked} myPosition={position} focus={focus} onPick={p=>{setPicked(p);setPicking(false);}} />
      {picking?<div className='wr-actions'><p>点击地图上的实际发现地点，坐标会填入明信片。</p><button onClick={()=>setPicking(false)}>返回填写</button></div>:<div className='wr-actions'><button className='wr-primary' onClick={()=>createRecord()}>＋ 记录偶遇</button><span>标记是历史偶遇，不是动物实时位置。你的蓝色定位点仅自己可见。</span></div>}
      <section className='wr-stories'><div className='wr-section-heading'><h2>这一带的校园故事</h2><span>{busy?'同步中…':`${records.length} 次偶遇`}</span></div>{!records.length&&!busy&&!error&&<div className='wr-empty'><span>一段故事，等你发现</span><p>这个范围和时间里还没有记录。偶遇一位野生居民后，给同学们留张明信片吧。</p></div>}
        <div className='wr-story-grid'>{records.map(r=><button className='wr-story-card' key={r.id} onClick={()=>setSelected([r])}>{r.photos[0]?<img src={photoUrl(r.photos[0])} alt={r.animal?.name??label(r.category)}/>:<div className='wr-no-photo'>{label(r.category)}</div>}<div><small>{when(r.observedAt)} · {r.place}</small><h3>{r.animal?.name??label(r.category)}</h3><p>{r.description}</p><span>来自 {r.author.displayName} 的校园日记 →</span></div></button>)}</div></section></>:<section>
      <div className='wr-archive-search'><input aria-label='搜索居民' placeholder='搜索昵称、外貌或常见区域…' value={search} onChange={e=>setSearch(e.target.value)}/><button className='wr-primary' onClick={createAnimal}>＋ 建立身份卡</button></div>
      {busy&&<p>正在翻阅居民档案…</p>}{!animals.length&&!busy&&!error&&<div className='wr-empty'>还没有找到这位居民，换个昵称或区域搜索看看。</div>}
      <div className='wr-residents-grid'>{animals.map(a=><button key={a.id} className='wr-resident-card' onClick={()=>setResident(a)}>{a.avatar?<img src={photoUrl(a.avatar)} alt={a.name}/>:<div className='wr-no-photo'>{label(a.category)}</div>}<div><small>CAMPUS RESIDENT</small><h2>{a.name}</h2><p>{label(a.category)} · {a.sightingCount} 次偶遇</p><p>{a.appearance||'外貌有待继续观察'}</p><small>常见区域：{a.commonArea||'尚未记录'}</small></div></button>)}</div>
    </section>}
    {cursor&&<button className='wr-more' disabled={busy} onClick={()=>{void more();}}>加载更多{tab==='map'?'偶遇':'居民'}</button>}
    <p className='wr-footer-note'>保持距离，安静观察。这里的每一张身份卡和明信片，都由同学们共同积累。</p>
    {editor&&<div className='wr-overlay' style={{display:picking?'none':undefined}}><section role='dialog' aria-modal='true' aria-label={editor==='sighting'?'记录偶遇':'居民身份卡'} className='wr-dialog'>
      {(editor==='sighting'||nestedAnimal)&&<div hidden={editor!=='sighting'}><EncounterForm original={editingRecord} animal={related} point={picked} onPick={()=>{setPicking(true);setTab('map');}} onClose={()=>setEditor(null)} onSaved={s=>{setEditor(null);setPicked(null);setSelected([s]);refresh();}}
        onCreateAnimal={()=>{setEditingAnimal(undefined);setNestedAnimal(true);setEditor('animal');}} /></div>}
      {editor==='animal'&&<AnimalForm original={editingAnimal} onClose={()=>{if(nestedAnimal){setNestedAnimal(false);setEditor('sighting');}else setEditor(null);}} onSaved={a=>{if(nestedAnimal){setRelated(a);setNestedAnimal(false);setEditor('sighting');}else{setEditor(null);setTab('animals');}refresh();}} onExisting={a=>{if(nestedAnimal){setRelated(a);setNestedAnimal(false);setEditor('sighting');}else{setEditor(null);setResident(a);}}}/>}
    </section></div>}
    {selected.length>0&&<div className='wr-overlay'><section role='dialog' aria-modal='true' aria-label='动物偶遇明信片' className='wr-dialog'><button className='wr-close' onClick={()=>setSelected([])}>关闭 ×</button><p className='wr-eyebrow'>POSTCARDS FROM CAMPUS · {selected.length} 次附近偶遇</p>{selected.map(r=><article className='wr-postcard' key={r.id}>
      <div className='wr-postcard-photos'>{r.photos.map(p=><a key={p.id} href={photoUrl(p)} target='_blank' rel='noreferrer'><img src={photoUrl(p)} alt='动物偶遇照片'/></a>)}</div><h2>{r.animal?.name??label(r.category)}</h2><p>{when(r.observedAt)} · {r.place}</p><p className='wr-full-story'>{r.description}</p><small>由 {r.author.displayName} 留下{r.locationBlurred?' · 位置已模糊':''}</small>
      <div className='wr-actions'>{r.animalId&&<button className='wr-primary' onClick={()=>{void wildlifeRequest<WildlifeAnimal>(`animals/${r.animalId}`).then(a=>{setSelected([]);setResident(a);}).catch(e=>setError(e.message));}}>认识这位居民</button>}
        {user?.user.id===r.createdBy&&<><button onClick={()=>{setEditingRecord(r);setRelated(undefined);setPicked({latitude:r.latitude,longitude:r.longitude});setSelected([]);setEditor('sighting');}}>编辑 / 关联身份</button><button onClick={()=>{void remove(r);}}>删除偶遇</button></>}</div></article>)}</section></div>}
    {resident&&<ResidentDetails animal={resident} userId={user?.user.id} onClose={()=>setResident(null)} onEncounter={()=>createRecord(resident)} onEdit={()=>{setEditingAnimal(resident);setResident(null);setEditor('animal');}} onSelect={r=>{setResident(null);setSelected([r]);}}/>}
  </div>;
}
function ResidentDetails({animal,userId,onClose,onEncounter,onEdit,onSelect}:{animal:WildlifeAnimal;userId?:string;onClose:()=>void;onEncounter:()=>void;onEdit:()=>void;onSelect:(r:WildlifeSighting)=>void}){
  const [records,setRecords]=useState<WildlifeSighting[]>([]),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function load(next?:string){setBusy(true);try{const p=await fetchSightings(wildlifeQuery({animalId:animal.id,cursor:next,limit:30}));setRecords(old=>next?[...old,...p.items]:p.items);setCursor(p.nextCursor);}catch(e){setError(e instanceof Error?e.message:'足迹加载失败');}finally{setBusy(false);}}
  useEffect(()=>{setRecords([]);setCursor(null);setError('');void load();},[animal.id]);
  return <div className='wr-overlay'><section className='wr-dialog' role='dialog' aria-modal='true' aria-label='居民身份档案'><button className='wr-close' onClick={onClose}>关闭 ×</button><p className='wr-eyebrow'>SHANGHAITECH WILD RESIDENT · IDENTITY CARD</p>
    {animal.avatar&&<img className='wr-passport-photo' src={photoUrl(animal.avatar)} alt={animal.name}/>}<h2>{animal.name}</h2><p>{label(animal.category)} · 累计 {animal.sightingCount} 次偶遇</p><small>居民编号 {animal.id}</small><dl><dt>外貌特征</dt><dd>{animal.appearance||'尚未记录'}</dd><dt>常见区域</dt><dd>{animal.commonArea||'等待更多观察'}</dd><dt>居民小传</dt><dd>{animal.description||'属于它的故事，等下一次偶遇继续。'}</dd></dl><small>由 {animal.creator.displayName} 于 {when(animal.createdAt)} 建档</small>
    <div className='wr-actions'><button className='wr-primary' onClick={onEncounter}>我也遇见过它</button>{userId===animal.createdBy&&<button onClick={onEdit}>编辑身份卡</button>}</div><h3>居民足迹</h3>{error&&<p className='wr-error'>{error}</p>}{busy&&<p>正在读取足迹…</p>}{!records.length&&!busy&&!error&&<p>还没有偶遇记录。</p>}{records.map(r=><button className='wr-footprint' key={r.id} onClick={()=>onSelect(r)}><small>{when(r.observedAt)}</small><strong>{r.place}</strong><p>{r.description}</p><span>翻开明信片 →</span></button>)}{cursor&&<button disabled={busy} onClick={()=>{void load(cursor);}}>更早的足迹</button>}
  </section></div>;
}
