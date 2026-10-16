/**
 * wildlife 测试夹具：**带 GPS EXIF 的图片**（规格 §4.3 / §11.5 T9）
 *
 * 为什么自己造而不用现成图片：
 *   · 需要**真的**含 GPS IFD（tag 0x8825）的 EXIF，才能证明"剥离后 GPS 也没了"；
 *   · 需要能精确控制容器（JPEG APP1 / PNG eXIf+tEXt / WebP EXIF），
 *     才能逐格式验证剥离；
 *   · 二进制夹具进仓库不如生成器可读 —— 这里每个字节的来由都写清楚了。
 *
 * 像素数据由 sharp 生成（真实可解码的 JPEG/PNG/WebP），元数据段由本文件拼装。
 */
import sharp from 'sharp';

/* ------------------------------------------------------------------ *
 * TIFF / EXIF
 * ------------------------------------------------------------------ */

/**
 * 一个最小的 TIFF：IFD0 里只有 GPSInfoIFDPointer(0x8825)，
 * 指向一个含 GPSLatitudeRef / GPSLatitude 的 GPS IFD。
 *
 * 这正是"照片里带拍摄地点"的形态，也是 §9 位置模糊化最容易被绕过的路径。
 */
export function buildTiffWithGps(): Buffer {
  const header = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]); // II, 42, IFD0 @8

  // IFD0：1 个条目（GPSInfoIFDPointer），下一个 IFD 偏移 0
  const ifd0 = Buffer.alloc(2 + 12 + 4);
  ifd0.writeUInt16LE(1, 0);
  ifd0.writeUInt16LE(0x8825, 2); // GPSInfoIFDPointer
  ifd0.writeUInt16LE(3, 4); // SHORT
  ifd0.writeUInt32LE(1, 6);
  ifd0.writeUInt16LE(30, 10); // 指向 GPS IFD（相对 TIFF 起点）
  ifd0.writeUInt32LE(0, 14);

  // GPS IFD @30：GPSLatitudeRef='N' + GPSLatitude=3 个有理数
  const gps = Buffer.alloc(2 + 12 * 2 + 4 + 24);
  gps.writeUInt16LE(2, 0);
  gps.writeUInt16LE(0x0001, 2); // GPSLatitudeRef
  gps.writeUInt16LE(2, 4); // ASCII
  gps.writeUInt32LE(2, 6);
  gps.write('N\0', 10, 'ascii');
  gps.writeUInt16LE(0x0002, 14); // GPSLatitude
  gps.writeUInt16LE(5, 16); // RATIONAL
  gps.writeUInt32LE(3, 18);
  gps.writeUInt32LE(30 + 2 + 12 * 2 + 4, 22); // 指向有理数数组
  gps.writeUInt32LE(0, 26);
  const rationals = Buffer.alloc(24);
  rationals.writeUInt32LE(31, 0);
  rationals.writeUInt32LE(1, 4);
  rationals.writeUInt32LE(10, 8);
  rationals.writeUInt32LE(1, 12);
  rationals.writeUInt32LE(40, 16);
  rationals.writeUInt32LE(1, 20);

  return Buffer.concat([header, ifd0, gps, rationals]);
}

/** APP1 段：`FFE1 <len> "Exif\0\0" <TIFF>` */
function app1Segment(tiff: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), length, payload]);
}

/** XMP APP1 段（同样可以携带 GPS，且是纯文本） */
export function app1XmpSegment(gps = true): Buffer {
  const xmp =
    `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">` +
    (gps ? `<rdf:Description exif:GPSLatitude="31,10.692N" exif:GPSLongitude="121,35.406E"/>` : '') +
    `</x:xmpmeta><?xpacket end="w"?>`;
  const header = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'binary');
  const payload = Buffer.concat([header, Buffer.from(xmp, 'utf8')]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), length, payload]);
}

/* ------------------------------------------------------------------ *
 * 基础图片（真实可解码）
 * ------------------------------------------------------------------ */

export async function buildPlainJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 200, g: 180, b: 60 } } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function buildPlainPng(): Promise<Buffer> {
  return sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 60, g: 120, b: 200 } } })
    .png()
    .toBuffer();
}

export async function buildPlainWebp(): Promise<Buffer> {
  return sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 60, g: 200, b: 120 } } })
    .webp()
    .toBuffer();
}

/* ------------------------------------------------------------------ *
 * 带 GPS 元数据的图片
 * ------------------------------------------------------------------ */

/** 在 SOI 之后插入 APP1（真实的带 GPS 照片就是这个形状） */
export async function buildJpegWithGpsExif(): Promise<Buffer> {
  const base = await buildPlainJpeg();
  return Buffer.concat([base.subarray(0, 2), app1Segment(buildTiffWithGps()), base.subarray(2)]);
}

/** 只有 EXIF、没有 GPS IFD（剥离要连它一起去掉） */
export async function buildJpegWithPlainExif(): Promise<Buffer> {
  const base = await buildPlainJpeg();
  const tiff = Buffer.concat([
    Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
    (() => {
      const ifd = Buffer.alloc(2 + 12 + 4);
      ifd.writeUInt16LE(1, 0);
      ifd.writeUInt16LE(0x013b, 2); // Artist
      ifd.writeUInt16LE(2, 4);
      ifd.writeUInt32LE(4, 6);
      ifd.write('abcd', 10, 'ascii');
      ifd.writeUInt32LE(0, 14);
      return ifd;
    })(),
  ]);
  return Buffer.concat([base.subarray(0, 2), app1Segment(tiff), base.subarray(2)]);
}

/** 带 XMP（纯文本 GPS）的 JPEG */
export async function buildJpegWithXmpGps(): Promise<Buffer> {
  const base = await buildPlainJpeg();
  return Buffer.concat([base.subarray(0, 2), app1XmpSegment(true), base.subarray(2)]);
}

/** 带 COM 段（自由文本，同样是元数据） */
export async function buildJpegWithComment(text = 'shot at dorm 12, room 305'): Promise<Buffer> {
  const base = await buildPlainJpeg();
  const payload = Buffer.from(text, 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  const com = Buffer.concat([Buffer.from([0xff, 0xfe]), length, payload]);
  return Buffer.concat([base.subarray(0, 2), com, base.subarray(2)]);
}

/* ------------------------------------------------------------------ *
 * PNG 块（需要自己算 CRC）
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** 在 IEND 之前插入一个块 */
function insertPngChunk(png: Buffer, chunk: Buffer): Buffer {
  const iendOffset = png.length - 12; // IEND 块固定 12 字节且在末尾
  return Buffer.concat([png.subarray(0, iendOffset), chunk, png.subarray(iendOffset)]);
}

/** PNG + eXIf 块（含 GPS IFD） */
export async function buildPngWithGpsExif(): Promise<Buffer> {
  const base = await buildPlainPng();
  return insertPngChunk(base, pngChunk('eXIf', buildTiffWithGps()));
}

/** PNG + tEXt 块（纯文本 GPS —— 同样必须被剥离） */
export async function buildPngWithGpsText(): Promise<Buffer> {
  const base = await buildPlainPng();
  const data = Buffer.concat([
    Buffer.from('GPSLatitude', 'ascii'),
    Buffer.from([0]),
    Buffer.from('31.1782 N, 121.5901 E', 'ascii'),
  ]);
  return insertPngChunk(base, pngChunk('tEXt', data));
}

/* ------------------------------------------------------------------ *
 * WebP
 * ------------------------------------------------------------------ */

/** WebP + EXIF 块（含 GPS IFD） */
export async function buildWebpWithGpsExif(): Promise<Buffer> {
  const base = await buildPlainWebp();
  const tiff = buildTiffWithGps();
  const header = Buffer.alloc(8);
  header.write('EXIF', 0, 'ascii');
  header.writeUInt32LE(tiff.length, 4);
  const padded = tiff.length % 2 === 1 ? Buffer.concat([tiff, Buffer.from([0])]) : tiff;
  return Buffer.concat([base, header, padded]);
}

/* ------------------------------------------------------------------ *
 * 其它
 * ------------------------------------------------------------------ */

/** 不是图片的文本文件（T36：改扩展名绕过必须被魔数校验拦住） */
export function buildTextFile(): Buffer {
  return Buffer.from('这不是图片，只是把扩展名改成了 .jpg\n'.repeat(20), 'utf8');
}

/**
 * 只声明尺寸、不含真实扫描数据的 JPEG 头。
 *
 * 用于测"边长上限"与"像素数上限"两条不同的规则 ——
 * 不需要真的解码，因为这两条判定都在解码之前（防解压炸弹的意义所在）。
 */
export function buildJpegHeader(width: number, height: number): Buffer {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0); // SOF0
  sof.writeUInt16BE(17, 2); // 段长
  sof.writeUInt8(8, 4); // 精度
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof.writeUInt8(3, 9); // 3 个分量
  for (let i = 0; i < 3; i += 1) {
    sof.writeUInt8(i + 1, 10 + i * 3);
    sof.writeUInt8(0x11, 11 + i * 3);
    sof.writeUInt8(0, 12 + i * 3);
  }
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
}
