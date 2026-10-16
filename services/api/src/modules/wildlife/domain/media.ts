/**
 * wildlife · 图片上传的校验与**元数据剥离**（规格 §4）
 *
 * ## 为什么 EXIF 剥离是硬要求，而不是可选项
 *
 * 手机照片的 EXIF 里**通常带 GPS 坐标**（精度可达米级）。我们在 §9 精心设计的
 * 位置模糊化会被 EXIF **完全绕过** —— 用户看到地图上是个 50m 的模糊圈，
 * 但下载原图就能读到精确到 3 米的拍摄点，**直接暴露宿舍房间位置**。
 *
 * ## 为什么本文件不依赖 sharp 做剥离
 *
 * 剥离是**隐私防线**，不应该依赖某个原生模块是否装好、其默认行为是否随版本变化。
 * 因此这里用**纯 TypeScript 的容器级剥离**：
 *   · JPEG：删除除 JFIF(APP0) / Adobe(APP14) 之外的全部 APPn 段与 COM 段；
 *   · PNG ：删除 eXIf / tEXt / iTXt / zTXt / tIME 等一切可承载文本的辅助块；
 *   · WebP：删除 RIFF 容器里的 EXIF / XMP 块。
 * 剥离后**必须重新解析并断言**（`assertNoMetadata`）—— 客户端承诺不算数，
 * 服务端必须自证。宁可 500（`EXIF_STRIP_FAILED`），也不放行带 GPS 的图。
 *
 * 缩略图是**非隐私路径**，走 sharp（`data/media-processor.ts`），
 * 装不上就降级为"无缩略图"，不影响上传与隐私保证。
 */

import { ValidationError } from '../../../common/errors/app-error';

/* ------------------------------------------------------------------ *
 * 限制（规格 §4.2）
 * ------------------------------------------------------------------ */

/** 服务端接受上限：5 MB / 张 */
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
/** 最大边长（超过则服务端缩放，这里先拒绝） */
export const MEDIA_MAX_EDGE_PX = 4096;
/** 最大像素数（防解压炸弹） */
export const MEDIA_MAX_PIXELS = 40_000_000;
/** 缩略图长边 */
export const MEDIA_THUMB_EDGE_PX = 400;
/** 单次上报最多照片数（规格 §4.2：`photoUrls` ≤3） */
export const MEDIA_MAX_PER_SIGHTING = 3;

export const MEDIA_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type MediaMime = (typeof MEDIA_ALLOWED_MIME)[number];

/* ------------------------------------------------------------------ *
 * 魔数嗅探（规格 §4.2：**必须**读文件头，不信任 Content-Type）
 * ------------------------------------------------------------------ */

const JPEG_SOI = 0xffd8;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 从**文件头**判断真实类型。
 *
 * 规格 §4.2 明确要求：不信任 `Content-Type`，防止改扩展名绕过
 * （T36：把文本文件改名成 .jpg 必须被拒）。
 */
export function sniffImageMime(buf: Buffer): MediaMime | null {
  if (buf.length < 12) return null;
  if (buf.readUInt16BE(0) === JPEG_SOI) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 尺寸解析（纯 TS，防解压炸弹需要先知道像素数）
 * ------------------------------------------------------------------ */

export interface ImageSize {
  width: number;
  height: number;
}

/** JPEG：在 SOFn 段里读高/宽 */
function readJpegSize(buf: Buffer): ImageSize | null {
  let offset = 2; // 跳过 SOI
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) return null;
    const marker = buf[offset + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) return null;
    // SOF0..SOF15（C4 = DHT、C8 = JPG、CC = DAC 不是 SOF）
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 9 > buf.length) return null;
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    if (marker === 0xda) return null; // 进入扫描数据，没找到 SOF
    offset += 2 + length;
  }
  return null;
}

/** PNG：IHDR 固定在前 24 字节内 */
function readPngSize(buf: Buffer): ImageSize | null {
  if (buf.length < 24) return null;
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** WebP：三种帧头（VP8 / VP8L / VP8X） */
function readWebpSize(buf: Buffer): ImageSize | null {
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const fourCC = buf.subarray(offset, offset + 4).toString('ascii');
    const size = buf.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (fourCC === 'VP8X' && data + 10 <= buf.length) {
      const w = 1 + (buf[data + 4]! | (buf[data + 5]! << 8) | (buf[data + 6]! << 16));
      const h = 1 + (buf[data + 7]! | (buf[data + 8]! << 8) | (buf[data + 9]! << 16));
      return { width: w, height: h };
    }
    if (fourCC === 'VP8L' && data + 5 <= buf.length) {
      const bits = buf.readUInt32LE(data + 1);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (fourCC === 'VP8 ' && data + 10 <= buf.length) {
      // 3 字节 frame tag + 3 字节同步码 0x9d 0x01 0x2a，随后是 14bit 宽高
      if (buf[data + 3] === 0x9d && buf[data + 4] === 0x01 && buf[data + 5] === 0x2a) {
        const w = buf.readUInt16LE(data + 6) & 0x3fff;
        const h = buf.readUInt16LE(data + 8) & 0x3fff;
        return { width: w, height: h };
      }
    }
    offset = data + size + (size % 2); // RIFF 块 2 字节对齐
  }
  return null;
}

export function readImageSize(buf: Buffer, mime: MediaMime): ImageSize | null {
  if (mime === 'image/jpeg') return readJpegSize(buf);
  if (mime === 'image/png') return readPngSize(buf);
  return readWebpSize(buf);
}

/* ------------------------------------------------------------------ *
 * 元数据检测（剥离前后的**同一套**判据）
 * ------------------------------------------------------------------ */

export interface MetadataReport {
  /** 存在 EXIF（APP1 "Exif\0\0" / PNG eXIf / WebP EXIF） */
  hasExif: boolean;
  /** EXIF 的 IFD0/ExifIFD 里有 GPSInfoIFDPointer（tag 0x8825）→ 有 GPS */
  hasGps: boolean;
  /** 存在 XMP（同样可以带 GPS） */
  hasXmp: boolean;
  /** 存在其它可承载自由文本的段（COM / tEXt / iTXt / zTXt / IPTC） */
  hasTextChunks: boolean;
}

const EMPTY_REPORT: MetadataReport = {
  hasExif: false,
  hasGps: false,
  hasXmp: false,
  hasTextChunks: false,
};

/** TIFF 结构里是否存在 GPS IFD 指针（tag 0x8825） */
export function tiffHasGpsInfo(tiff: Buffer): boolean {
  if (tiff.length < 8) return false;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return false;
  const u16 = (o: number): number => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number): number => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  if (u16(2) !== 42) return false;

  const GPS_TAG = 0x8825;
  const EXIF_IFD_TAG = 0x8769;

  const ifdHasTag = (offset: number, tag: number): boolean => {
    if (offset <= 0 || offset + 2 > tiff.length) return false;
    const count = u16(offset);
    // 防御损坏文件：条目数不可能超过剩余空间
    if (count > (tiff.length - offset - 2) / 12) return false;
    for (let i = 0; i < count; i += 1) {
      const entry = offset + 2 + i * 12;
      if (entry + 12 > tiff.length) return false;
      if (u16(entry) === tag) return true;
    }
    return false;
  };

  const ifd0 = u32(4);
  if (ifdHasTag(ifd0, GPS_TAG)) return true;
  // 有些写入器把 GPS 放在 ExifIFD 里
  if (ifdHasTag(ifd0, EXIF_IFD_TAG)) {
    const count = u16(ifd0);
    for (let i = 0; i < count; i += 1) {
      const entry = ifd0 + 2 + i * 12;
      if (entry + 12 > tiff.length) break;
      if (u16(entry) === EXIF_IFD_TAG) {
        const sub = u32(entry + 8);
        if (ifdHasTag(sub, GPS_TAG)) return true;
      }
    }
  }
  return false;
}

function inspectJpeg(buf: Buffer): MetadataReport {
  const report: MetadataReport = { ...EMPTY_REPORT };
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) break;
    const payload = buf.subarray(offset + 4, offset + 2 + length);

    if (marker === 0xe1) {
      if (payload.subarray(0, 6).toString('binary') === 'Exif\0\0') {
        report.hasExif = true;
        if (tiffHasGpsInfo(payload.subarray(6))) report.hasGps = true;
      } else if (payload.subarray(0, 28).toString('binary').startsWith('http://ns.adobe.com/xap/1.0/')) {
        report.hasXmp = true;
        // XMP 里的 GPS 是纯文本，扫一下关键字
        const text = payload.toString('binary');
        if (/GPSLatitude|exif:GPS|geo:lat/i.test(text)) report.hasGps = true;
      }
    } else if (marker === 0xed || marker === 0xfe || marker === 0xec) {
      // APP13(IPTC/Photoshop) / COM / APP12(Ducky)
      report.hasTextChunks = true;
    }
    offset += 2 + length;
  }
  return report;
}

function inspectPng(buf: Buffer): MetadataReport {
  const report: MetadataReport = { ...EMPTY_REPORT };
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'eXIf') {
      report.hasExif = true;
      if (tiffHasGpsInfo(data)) report.hasGps = true;
    } else if (type === 'iTXt' || type === 'tEXt' || type === 'zTXt') {
      report.hasTextChunks = true;
      const text = data.toString('binary');
      if (/XML:com\.adobe\.xmp/i.test(text)) report.hasXmp = true;
      if (/GPS|latitude|longitude/i.test(text)) report.hasGps = true;
    }
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  return report;
}

function inspectWebp(buf: Buffer): MetadataReport {
  const report: MetadataReport = { ...EMPTY_REPORT };
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const fourCC = buf.subarray(offset, offset + 4).toString('ascii');
    const size = buf.readUInt32LE(offset + 4);
    const data = buf.subarray(offset + 8, offset + 8 + size);
    if (fourCC === 'EXIF') {
      report.hasExif = true;
      if (tiffHasGpsInfo(data)) report.hasGps = true;
    } else if (fourCC === 'XMP ') {
      report.hasXmp = true;
      if (/GPSLatitude|geo:lat/i.test(data.toString('binary'))) report.hasGps = true;
    }
    offset += 8 + size + (size % 2);
  }
  return report;
}

/** 检查容器里是否还有元数据。**剥离前后用的是同一套判据** */
export function inspectMetadata(buf: Buffer, mime: MediaMime): MetadataReport {
  if (mime === 'image/jpeg') return inspectJpeg(buf);
  if (mime === 'image/png') return inspectPng(buf);
  return inspectWebp(buf);
}

/** 是否含任何元数据 */
export function hasMetadata(buf: Buffer, mime: MediaMime): boolean {
  const r = inspectMetadata(buf, mime);
  return r.hasExif || r.hasGps || r.hasXmp || r.hasTextChunks;
}

/* ------------------------------------------------------------------ *
 * 剥离
 * ------------------------------------------------------------------ */

/** 剥离失败（宁可 500，也不放行带 GPS 的图） */
export class ExifStripError extends Error {
  constructor(message = 'EXIF_STRIP_FAILED') {
    super(message);
    this.name = 'ExifStripError';
  }
}

/** JPEG：保留 SOI/SOF/SOS/EOI 与 APP0(JFIF)、APP14(Adobe)，删掉其余 APPn 与 COM */
function stripJpeg(buf: Buffer): Buffer {
  const out: Buffer[] = [buf.subarray(0, 2)]; // SOI
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(buf.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    if (marker === 0xda) {
      // 扫描数据：原样保留到文件末尾（含 EOI）
      out.push(buf.subarray(offset));
      return Buffer.concat(out);
    }
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) break;
    const end = offset + 2 + length;
    // **只丢元数据段，其余一律保留**：
    //   APPn 段里除了 APP0(JFIF) 与 APP14(Adobe) 都是元数据载体
    //   （APP1=EXIF/XMP、APP2=ICC/FlashPix、APP12=Ducky、APP13=IPTC/Photoshop）；
    //   COM(0xFFFE) 是自由文本。
    // ⚠️ 这里必须写成"丢弃名单"而不是"保留名单"：早先写成只保留 APP0/APP14，
    // 结果把 SOF/DQT/DHT 这些**结构性**段一起丢了，输出变成
    // "SOS before SOF" 的坏文件 —— 由 `media.spec.ts` 的"输出仍可解码"断言抓出。
    const isAppSegment = marker >= 0xe0 && marker <= 0xef;
    const isMetadataSegment = (isAppSegment && marker !== 0xe0 && marker !== 0xee) || marker === 0xfe;
    if (!isMetadataSegment) out.push(buf.subarray(offset, end));
    offset = end;
  }
  if (offset < buf.length) out.push(buf.subarray(offset));
  return Buffer.concat(out);
}

/** PNG：只保留关键块与色彩/透明度辅助块，删除一切文本/时间/EXIF 块 */
const PNG_KEEP_AUXILIARY = new Set([
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'bKGD',
  'pHYs',
  'sBIT',
  'hIST',
  'sPLT',
  'acTL',
  'fcTL',
  'fdAT',
]);

function stripPng(buf: Buffer): Buffer {
  const out: Buffer[] = [buf.subarray(0, 8)]; // signature
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const end = offset + 12 + length;
    if (end > buf.length) break;
    const critical = type[0] === type[0]!.toUpperCase();
    if (critical || PNG_KEEP_AUXILIARY.has(type)) out.push(buf.subarray(offset, end));
    if (type === 'IEND') break;
    offset = end;
  }
  return Buffer.concat(out);
}

/** WebP：删除 RIFF 容器里的 EXIF / XMP 块（保留 VP8 系、ICCP、ANIM 等块） */
function stripWebp(buf: Buffer): Buffer {
  const chunks: Array<{ fourCC: string; body: Buffer }> = [];
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const fourCC = buf.subarray(offset, offset + 4).toString('ascii');
    const size = buf.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > buf.length) break;
    if (fourCC !== 'EXIF' && fourCC !== 'XMP ') {
      // 重新拼装时补回 2 字节对齐的填充
      const padded = size % 2 === 1 ? Buffer.concat([buf.subarray(offset + 8, end), Buffer.from([0])]) : buf.subarray(offset + 8, end);
      chunks.push({ fourCC, body: padded });
    }
    offset = end + (size % 2);
  }
  const body = Buffer.concat(
    chunks.map((c) => {
      const header = Buffer.alloc(8);
      header.write(c.fourCC, 0, 'ascii');
      header.writeUInt32LE(c.body.length, 4);
      return Buffer.concat([header, c.body]);
    }),
  );
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WEBP', 8, 'ascii');
  return Buffer.concat([riff, body]);
}

/**
 * 剥离容器里的一切元数据（**服务端强制**，规格 §4.3）。
 *
 * 不重新编码像素 —— 只做容器级删除。这既更快，也避免二次有损压缩。
 * 剥离后调用方**必须**再跑 `assertNoMetadata()`。
 */
export function stripMetadata(buf: Buffer, mime: MediaMime): Buffer {
  if (mime === 'image/jpeg') return stripJpeg(buf);
  if (mime === 'image/png') return stripPng(buf);
  return stripWebp(buf);
}

/**
 * 剥离后的**防御性断言**（规格 §4.3）。
 *
 * 若剥离后仍能解析出 EXIF / GPS / XMP / 文本段，直接抛错 ——
 * 这比"静默放行"安全得多：一次 500 好过一次隐私泄漏。
 */
export function assertNoMetadata(buf: Buffer, mime: MediaMime): void {
  const report = inspectMetadata(buf, mime);
  if (report.hasExif || report.hasGps || report.hasXmp || report.hasTextChunks) {
    throw new ExifStripError(
      `EXIF_STRIP_FAILED: 剥离后仍检出元数据 exif=${report.hasExif} gps=${report.hasGps} xmp=${report.hasXmp} text=${report.hasTextChunks}`,
    );
  }
  if (sniffImageMime(buf) !== mime) {
    throw new ExifStripError('EXIF_STRIP_FAILED: 剥离后容器类型发生变化');
  }
}

/* ------------------------------------------------------------------ *
 * 入口校验
 * ------------------------------------------------------------------ */

export interface AcceptedMedia {
  mime: MediaMime;
  width: number;
  height: number;
  /** 剥离后的字节数 */
  byteSize: number;
  /** 剥离后的内容（**可直接入库**） */
  data: Buffer;
}

/**
 * 完整的上传入口校验：大小 → 魔数 → 尺寸 → 剥离 → 断言。
 *
 * 失败一律 `VALIDATION_FAILED`，`details.reason` 用规格 §10.3 的取值
 * （`MEDIA_TOO_LARGE` / `MEDIA_UNSUPPORTED_TYPE` / `MEDIA_TOO_MANY_PIXELS`）。
 */
export function acceptUpload(buf: Buffer, declaredMime?: string): AcceptedMedia {
  if (buf.length === 0) {
    throw new ValidationError('上传内容为空', { reason: 'MEDIA_UNSUPPORTED_TYPE' });
  }
  if (buf.length > MEDIA_MAX_BYTES) {
    throw new ValidationError(`图片超过 ${MEDIA_MAX_BYTES / 1024 / 1024} MB 上限`, {
      reason: 'MEDIA_TOO_LARGE',
      maxBytes: MEDIA_MAX_BYTES,
      byteSize: buf.length,
    });
  }

  // 魔数校验：**不信任 Content-Type**（规格 §4.2）
  const mime = sniffImageMime(buf);
  if (!mime) {
    throw new ValidationError('只接受 JPEG / PNG / WebP 图片（按文件头判定）', {
      reason: 'MEDIA_UNSUPPORTED_TYPE',
      declaredMime: declaredMime ?? null,
    });
  }

  const size = readImageSize(buf, mime);
  if (!size) {
    throw new ValidationError('无法解析图片尺寸，文件可能已损坏', { reason: 'MEDIA_UNSUPPORTED_TYPE' });
  }

  // ⚠️ 顺序有意义：**先判像素数（解压炸弹），再判边长**。
  // 若先判边长（4096），那么 4096×4096 = 16.7MP 的上限永远达不到 40MP，
  // 像素数这条规则就变成**死代码** —— 一条永远不会触发的防护等于没有防护。
  if (size.width * size.height > MEDIA_MAX_PIXELS) {
    throw new ValidationError(`图片像素数超过 ${MEDIA_MAX_PIXELS}（防解压炸弹）`, {
      reason: 'MEDIA_TOO_MANY_PIXELS',
      pixels: size.width * size.height,
    });
  }
  if (size.width > MEDIA_MAX_EDGE_PX || size.height > MEDIA_MAX_EDGE_PX) {
    throw new ValidationError(`图片边长超过 ${MEDIA_MAX_EDGE_PX}px`, {
      reason: 'MEDIA_TOO_LARGE',
      width: size.width,
      height: size.height,
    });
  }

  const stripped = stripMetadata(buf, mime);
  assertNoMetadata(stripped, mime);

  return {
    mime,
    width: size.width,
    height: size.height,
    byteSize: stripped.length,
    data: stripped,
  };
}
