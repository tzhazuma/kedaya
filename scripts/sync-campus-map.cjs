// Public campus GIS snapshot, preserving the source in the app and metadata.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const origin = 'https://map.shanghaitech.edu.cn';
const coefficients = [.00220636496208,111320.7020209128,51751.86112841131,3796837.749470245,992013.7397791013,-1221952.21711287,1340652.697009075,-620943.6990984312,144416.9293806241,37.5];
function project({lng,lat}) { const t=lat/coefficients[9]; return {x:coefficients[0]+coefficients[1]*lng,y:coefficients.slice(2,9).reduce((sum,c,i)=>sum+c*t**i,0)}; }
async function query(entity, params={}) {
  const response=await fetch(`${origin}/gis-service/sys/${entity}/queryListByWhere`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({pageSize:'500',...params}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Campus GIS: ${response.status}`);
  return (await response.json()).value[0].list;
}
async function main(){
  const campus=(await query('campus'))[0], boundary=JSON.parse(campus.position), buildings=await query('archite_entity',{cid:campus.id});
  const points=boundary.map(project), unit=.5, size=256, span=size*unit;
  const left=Math.floor(Math.min(...points.map(p=>p.x))/span),right=Math.floor(Math.max(...points.map(p=>p.x))/span);
  const bottom=Math.floor(Math.min(...points.map(p=>p.y))/span),top=Math.floor(Math.max(...points.map(p=>p.y))/span);
  const width=(right-left+1)*size,height=(top-bottom+1)*size;
  const jobs=[];for(let x=left;x<=right;x++)for(let y=bottom;y<=top;y++)jobs.push({x,y});
  const tiles=[];let cursor=0;
  await Promise.all(Array.from({length:4},async()=>{while(cursor<jobs.length){const {x,y}=jobs[cursor++];const response=await fetch(`${origin}/tiles/19/tile${x}_${y}.png`,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`Campus tile ${x},${y}: ${response.status}`);tiles.push({input:Buffer.from(await response.arrayBuffer()),left:(x-left)*size,top:(top-y)*size});}}));
  const pixel=p=>{const m=project(p);return {x:(m.x-left*span)/unit,y:((top+1)*span-m.y)/unit};};
  const polygon=boundary.map(p=>{const q=pixel(p);return `${q.x},${q.y}`;}).join(' ');
  const mask=Buffer.from(`<svg width="${width}" height="${height}"><polygon fill="white" points="${polygon}"/></svg>`);
  const raster=await sharp({create:{width,height,channels:4,background:'#edf2e6'}}).composite(tiles).png().toBuffer();
  const masked=await sharp(raster).composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
  const image=await sharp(masked).flatten({background:'#edf2e6'}).jpeg({quality:82,mozjpeg:true}).toBuffer();
  const outputs=['apps/miniapp/src/assets/wildlife/campus.jpg','apps/web/public/maps/shanghaitech-campus.jpg'];
  for(const name of outputs){await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),image);}
  const data={source:origin,updatedAt:new Date().toISOString().slice(0,10),projection:'BD09-Mercator',width,height,unit,west:left*span,north:(top+1)*span,boundary,
    buildings:buildings.map(b=>{const outline=JSON.parse(b.position);const lng=(Math.min(...outline.map(p=>p.lng))+Math.max(...outline.map(p=>p.lng)))/2,lat=(Math.min(...outline.map(p=>p.lat))+Math.max(...outline.map(p=>p.lat)))/2;return {id:b.id,name:b.name,...pixel({lng,lat}),lng,lat};})};
  await fs.writeFile(path.join(root,'packages/contracts/src/campus-map-data.json'),JSON.stringify(data,null,2)+'\n');
  console.log(`Campus map: ${tiles.length} tiles, ${width}×${height}, ${buildings.length} official places, campus exterior masked.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
