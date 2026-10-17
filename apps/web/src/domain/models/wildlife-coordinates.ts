/** 微信地图的 GCJ-02 与浏览器/OSM 的 WGS-84 之间转换；境外原样返回。 */
export type WildlifePoint = { latitude: number; longitude: number };
export function wgsToGcj(point: WildlifePoint): WildlifePoint {
  const { latitude: lat, longitude: lng } = point;
  if (lng < 72.004 || lng > 137.8347 || lat < .8293 || lat > 55.8271) return point;
  const x = lng - 105, y = lat - 35, pi = Math.PI;
  let dLat = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*Math.sqrt(Math.abs(x));
  dLat += (20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  dLat += (20*Math.sin(y*pi)+40*Math.sin(y/3*pi))*2/3;
  dLat += (160*Math.sin(y/12*pi)+320*Math.sin(y*pi/30))*2/3;
  let dLng = 300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));
  dLng += (20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  dLng += (20*Math.sin(x*pi)+40*Math.sin(x/3*pi))*2/3;
  dLng += (150*Math.sin(x/12*pi)+300*Math.sin(x/30*pi))*2/3;
  const rad = lat/180*pi, magic = 1-.00669342162296594323*Math.sin(rad)**2, root = Math.sqrt(magic);
  return { latitude: lat+dLat*180/((6378245*(1-.00669342162296594323))/(magic*root)*pi), longitude: lng+dLng*180/(6378245/root*Math.cos(rad)*pi) };
}
export function gcjToWgs(point: WildlifePoint): WildlifePoint {
  let result = { ...point };
  for (let i=0;i<5;i++) { const transformed=wgsToGcj(result); result={latitude:result.latitude+point.latitude-transformed.latitude,longitude:result.longitude+point.longitude-transformed.longitude}; }
  return result;
}
