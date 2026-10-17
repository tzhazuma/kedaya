// 真实 HTTP + PostgreSQL 验收。只清理本次运行创建的数据，不修改已有居民内容。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createRequire } from 'node:module';
const { isOnCampus } = createRequire(import.meta.url)('../dist/packages/contracts/src/campus-map.js');
try { process.loadEnvFile('.env'); } catch {}
const origin = process.env.WILDLIFE_TEST_API ?? 'http://127.0.0.1:3001';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const animals=[], sightings=[], images=[], users=[];
let checks=0;
function check(condition,message){assert.ok(condition,message);checks++;}
async function call(path,method='GET',body,token){
  const headers={};if(token)headers.Authorization=`Bearer ${token}`;
  if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';
  const r=await fetch(`${origin}/api/v1/${path}`,{method,headers,body:body?body instanceof FormData?body:JSON.stringify(body):undefined});
  const data=await r.json();return {status:r.status,...data};
}
async function upload(buffer,mime,token){const form=new FormData();form.append('file',new Blob([buffer],{type:mime}),'animal.png');return call('wildlife/photos','POST',form,token);}
const nonce=String(Date.now()).slice(-8);
try {
  const a=await call('auth/login','POST',{ticket:`mock-${nonce}`}),b=await call('auth/login','POST',{ticket:`mock-${String((Number(nonce)+1)%100000000).padStart(8,'0')}`});
  check(a.ok&&b.ok,'two existing auth accounts can log in');users.push(a.data.user.id,b.data.user.id);
  const A=a.data.accessToken,B=b.data.accessToken;
  const categories=await call('wildlife/categories');check(categories.ok&&categories.data.length>=7,'public categories');
  const raw=await sharp({create:{width:64,height:64,channels:3,background:'#db9246'}}).png().toBuffer();
  const uploaded=await upload(raw,'image/png',A);check(uploaded.ok,'real photo upload');images.push(uploaded.data.id);
  const invalid=await upload(Buffer.from('<svg onload="alert(1)"/>'),'image/png',A);check(invalid.status===400,'mismatched image content rejected');
  const animalBody={name:`验收居民-${randomUUID().slice(0,8)}`,category:'cat',avatarId:uploaded.data.id,appearance:'橘白相间',commonArea:'校园测试区域',description:'自动验收临时身份卡',clientRequestId:randomUUID()};
  const animal=await call('wildlife/animals','POST',animalBody,A);check(animal.ok,'shared identity created');animals.push(animal.data.id);
  const publicAnimal=await call(`wildlife/animals/${animal.data.id}`);check(publicAnimal.ok&&publicAnimal.data.avatar.id===uploaded.data.id,'identity public with persistent image id');
  const makeBody=()=>({category:'cat',description:'真实数据库验收临时观察',place:'校园测试区域',latitude:31.17731,longitude:121.59412,locationBlurred:false,observedAt:new Date().toISOString(),animalId:animal.data.id,photoIds:[],clientRequestId:randomUUID()});
  const body={...makeBody(),photoIds:[uploaded.data.id]};
  const first=await call('wildlife/sightings','POST',body,A);check(first.ok,'A publishes a photo sighting');sightings.push(first.data.id);
  const second=await call('wildlife/sightings','POST',makeBody(),B);check(second.ok,'B records the same animal');sightings.push(second.data.id);
  const shared=await call(`wildlife/sightings/${first.data.id}`,'GET',undefined,B);check(shared.ok&&shared.data.description===body.description,'B reads A shared sighting');
  const replay=await call('wildlife/sightings','POST',body,A);check(replay.ok&&replay.data.id===first.data.id,'retry returns same sighting');
  const changed=await call('wildlife/sightings','POST',{...body,description:'different'},A);check(changed.status===409,'idempotency key cannot overwrite different payload');
  const timeline=await call(`wildlife/animals/${animal.data.id}/sightings`);check(timeline.ok&&timeline.data.items.length===2,'one animal has observations from two users');
  const counted=await call(`wildlife/animals/${animal.data.id}`);check(counted.data.sightingCount===2,'shared sighting count');
  const savedImage=await fetch(`${origin}${shared.data.photos[0].url}`);check(savedImage.ok&&savedImage.headers.get('content-type').includes('image/jpeg'),'uploaded photo available by public URL');
  const metadata=await sharp(Buffer.from(await savedImage.arrayBuffer())).metadata();check(!metadata.exif,'photo EXIF stripped');
  const wrongEdit=await call(`wildlife/sightings/${first.data.id}`,'PATCH',{description:'try to overwrite'},B);check(wrongEdit.status===403,'B cannot edit A sighting');
  const wrongDelete=await call(`wildlife/sightings/${first.data.id}`,'DELETE',undefined,B);check(wrongDelete.status===403,'B cannot delete A sighting');
  const wrongIdentity=await call(`wildlife/animals/${animal.data.id}`,'PATCH',{name:'overwrite'},B);check(wrongIdentity.status===403,'B cannot edit A identity');
  const unauth=await call('wildlife/sightings','POST',makeBody());check(unauth.status===401,'anonymous write denied');
  const refreshBearer=await call('wildlife/sightings','POST',makeBody(),a.data.refreshToken);check(refreshBearer.status===401,'refresh token cannot authorize writes');
  const stolenPhoto=await call('wildlife/sightings','POST',{...makeBody(),photoIds:[uploaded.data.id]},B);check(stolenPhoto.status===400,'another user cannot claim uploaded draft photo');
  const mismatch=await call('wildlife/sightings','POST',{...makeBody(),category:'bird'},A);check(mismatch.status===400,'animal category must match identity');
  const future=await call('wildlife/sightings','POST',{...makeBody(),observedAt:new Date(Date.now()+86400000).toISOString()},A);check(future.status===400,'future observation rejected');
  const invalidCoordinate=await call('wildlife/sightings','POST',{...makeBody(),latitude:100},A);check(invalidCoordinate.status===400,'invalid coordinate rejected');
  const offCampus=await call('wildlife/sightings','POST',{...makeBody(),latitude:31.23,longitude:121.47},A);check(offCampus.status===400,'off-campus sighting rejected');
  const box=await call(`wildlife/sightings?animalId=${animal.data.id}&south=31.17&north=31.18&west=121.59&east=121.60&limit=1`);check(box.ok&&box.data.items.length===1&&box.data.nextCursor,'bounding box and cursor pagination');
  const page2=await call(`wildlife/sightings?animalId=${animal.data.id}&limit=1&cursor=${box.data.nextCursor}`);check(page2.ok&&page2.data.items[0].id!==box.data.items[0].id,'second page no duplicates');
  const emptyBox=await call(`wildlife/sightings?animalId=${animal.data.id}&south=0&north=1&west=0&east=1`);check(emptyBox.data.items.length===0,'map query excludes out of bounds records');
  const changedIdentity=await call(`wildlife/animals/${animal.data.id}`,'PATCH',{category:'bird'},A);check(changedIdentity.status===409,'identity category cannot invalidate existing footprints');
  const edited=await call(`wildlife/sightings/${first.data.id}`,'PATCH',{description:'观察记录已编辑'},A);check(edited.ok&&edited.data.description==='观察记录已编辑','owner can edit');
  const blurred=await call('wildlife/sightings','POST',{...makeBody(),locationBlurred:true},A);check(blurred.ok&&blurred.data.latitude===31.177&&blurred.data.place.includes('模糊'),'blurred location stored without exact coordinate');sightings.push(blurred.data.id);
  // 校园南边界附近的模糊点：取整后不能掉出校园包围盒，否则记录会从地图和视野查询里消失。
  const edge=await call('wildlife/sightings','POST',{...makeBody(),latitude:31.1734,longitude:121.5932,locationBlurred:true},A);
  check(edge.ok&&edge.data.latitude>=31.1732&&edge.data.longitude>=121.5891,'blurred edge sighting stays inside campus bounds');sightings.push(edge.data.id);
  check(isOnCampus(edge.data),'blurred edge sighting stays inside actual campus polygon');
  const keepBlurred=await call(`wildlife/sightings/${edge.data.id}`,'PATCH',{description:'保留模糊位置的编辑',locationBlurred:false},A);
  check(keepBlurred.ok&&keepBlurred.data.locationBlurred,'unchecking blur cannot reveal an old exact location');
  // Simulate an older rounding result on this run's fixture only.
  await db.wildlifeSighting.update({where:{id:edge.data.id},data:{latitude:31.173,longitude:121.593,locationBlurred:true}});
  const legacy=await call(`wildlife/sightings/${edge.data.id}`,'PATCH',{description:'旧边界记录仍可编辑'},A);
  check(legacy.ok&&legacy.data.description==='旧边界记录仍可编辑','legacy blurred record can be edited without reselecting position');
  check(legacy.data.locationBlurred&&isOnCampus(legacy.data),'legacy blurred position moves to a coarse campus point');
  const legacyStored=await db.wildlifeSighting.findUnique({where:{id:edge.data.id}});
  check(legacyStored.locationBlurred&&isOnCampus(legacyStored),'coarse campus point persisted without restoring exact coordinates');
  const edgeVisible=await call('wildlife/sightings?south=31.1732&north=31.1809&west=121.5891&east=121.6007&limit=100');
  check(edgeVisible.data.items.some(item=>item.id===edge.data.id),'blurred edge sighting stays visible in viewport query');
  const persisted=await db.wildlifeSighting.findUnique({where:{id:first.data.id},include:{photos:true}});check(persisted&&persisted.photos.length===1,'HTTP write persisted in actual database');
  const deleted=await call(`wildlife/sightings/${first.data.id}`,'DELETE',undefined,A);check(deleted.ok,'owner can delete');
  const after=await call(`wildlife/sightings/${first.data.id}`);check(after.status===404,'deleted sighting disappears');
  console.log(`Wildlife acceptance passed: ${checks} checks with two accounts, real HTTP, photos and PostgreSQL.`);
} finally {
  await db.wildlifeSighting.deleteMany({where:{id:{in:sightings}}});
  await db.wildlifeAnimal.deleteMany({where:{id:{in:animals}}});
  const files=await db.wildlifeImage.findMany({where:{id:{in:images}}});
  await db.wildlifeImage.deleteMany({where:{id:{in:images}}});
  for(const file of files)await unlink(resolve(process.env.WILDLIFE_UPLOAD_DIR??'./uploads/wildlife',file.filename)).catch(()=>undefined);
  // AuthIdentity 外键由用户表级联；只清理本次新建账号。
  await db.user.deleteMany({where:{id:{in:users}}});
  await db.$disconnect();
}
