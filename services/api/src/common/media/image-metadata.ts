/**
 * 图片元数据剥离（契约 06-roadmap A2.5：上传图片的 EXIF GPS 必须被剥离）。
 *
 * 为什么**必须**在服务端做：客户端压缩只是"顺手"（`wx.compressImage` 会重编码、
 * 通常顺带丢掉 EXIF），但客户端是可以被替换的（抓包直接发原始文件），
 * 因此**唯一可信的剥离点在后端**。这里做的三件事：
 *
 *   1. **魔术字节嗅探**：只认 JPEG / PNG 的真实文件头，绝不信任 `Content-Type`
 *      或文件名后缀 —— 否则「把 .exe 改名成 .jpg」就能进对象存储；
 *   2. **元数据剥离**：
 *      · JPEG：丢弃 APP1（EXIF / XMP，GPS 就在 EXIF 里）、APP13（IPTC/Photoshop 元数据）、
 *        COM（注释），以及非 ICC 的 APP2；
 *      · PNG：丢弃 tEXt / zTXt / iTXt / eXIf / tIME；
 *      保留 APP0(JFIF)、APP2(ICC 色彩描述)、APP14(Adobe)，以及所有解码必需段 ——
 *      **只删元数据，不动像素数据**，所以是无损的；
 *   3. **结构校验**：解析失败一律**抛错**，绝不"原样放行"。
 *      这是本文件最重要的性质：宁可拒绝一张图，也不能把带 GPS 的图存进对象存储。
 *
 * 刻意**不支持** WebP / GIF / HEIC：
 *   · WebP 的 EXIF/XMP 放在 RIFF chunk 里，剥离后还要同步修正 VP8X 的 flag 位，
 *     写错就会产出坏图 —— 与其半吊子处理，不如明确拒绝并让客户端转成 JPG；
 *   · GIF / HEIC 同理（HEIC 还需要 box 级重写）。
 *   拒绝时给出的错误文案会明确告知支持范围，客户端据此提示用户。
 *
 * 零依赖：不引 `sharp`（原生库，且本项目容器里没有）。这与 A2.5 的诉求一致 ——
 * A2.5 只要求"GPS 被剥离"，不要求缩放；缩放由客户端在选图后完成。
 */

/** 支持的图片类型（同时也是允许的 `Content-Type`） */
export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;
export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

/** 剥离失败的统一错误类型 —— 调用方据此回 `VALIDATION_FAILED` 而不是 500 */
export class ImageRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageRejectedError';
  }
}

export interface ImageInfo {
  type: SupportedImageType;
  /** 剥离后的字节 */
  bytes: Buffer;
  /** 像素尺寸（解析不到为 null，但目前两种格式都能解析到） */
  width: number | null;
  height: number | null;
}

const JPEG_SOI = 0xffd8;
const JPEG_EOI = 0xffd9;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 只按文件头判定类型；判定不出返回 null（调用方负责拒绝） */
export function sniffImageType(bytes: Buffer): SupportedImageType | null {
  if (bytes.length >= 2 && bytes.readUInt16BE(0) === JPEG_SOI) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  return null;
}

/**
 * 校验 + 剥离元数据。这是对外的唯一入口。
 *
 * @throws ImageRejectedError 类型不支持 / 结构损坏 / 尺寸解析不出
 */
export function sanitizeImage(bytes: Buffer): ImageInfo {
  if (bytes.length === 0) throw new ImageRejectedError('图片内容为空');

  const type = sniffImageType(bytes);
  if (type === null) {
    throw new ImageRejectedError('只支持 JPG / PNG 图片（请重新导出后再上传）');
  }
  if (type === 'image/jpeg') return sanitizeJpeg(bytes);
  return sanitizePng(bytes);
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

/** 直接丢弃的 APPn 段（GPS / 作者 / 软件 / 注释都在这里） */
const JPEG_DROP_MARKERS = new Set([
  0xffe1, // APP1：EXIF（含 GPS）、XMP
  0xffed, // APP13：IPTC / Photoshop 元数据（可能含 GPS）
  0xfffe, // COM：注释
]);

/**
 * 处理策略：
 *   · APP0(JFIF) 保留 —— 声明像素密度，丢了不影响解码但没必要丢；
 *   · APP2 仅当是 ICC 色彩描述时保留（丢掉会让广色域照片偏色）；
 *   · APP14(Adobe) 保留 —— 影响 CMYK/YCCK 解释；
 *   · 其余 APPn 与 COM 一律丢弃；
 *   · 走到 SOS 后**原样复制**到第一个 EOI（像素数据一个字都不动），
 *     并丢弃 EOI 之后的所有内容（有些相机把缩略图/私货追加在文件尾）。
 */
function sanitizeJpeg(bytes: Buffer): ImageInfo {
  const kept: Buffer[] = [bytes.subarray(0, 2)]; // SOI
  let offset = 2;
  let width: number | null = null;
  let height: number | null = null;
  let sawSos = false;

  while (offset + 1 < bytes.length) {
    const marker = bytes.readUInt16BE(offset);

    // 填充字节（某些编码器会写连续的 0xFF）—— 跳过即可
    if ((marker & 0xff00) !== 0xff00) {
      throw new ImageRejectedError('JPEG 结构损坏（标记错位）');
    }
    if (marker === 0xffff) {
      offset += 1;
      continue;
    }

    // 无需长度字段的标记：RSTn / TEM / SOI / EOI
    if (marker === JPEG_EOI) {
      throw new ImageRejectedError('JPEG 结构损坏（未找到扫描数据）');
    }
    if (marker >= 0xffd0 && marker <= 0xffd7) {
      throw new ImageRejectedError('JPEG 结构损坏（扫描前出现 RSTn）');
    }

    if (offset + 4 > bytes.length) throw new ImageRejectedError('JPEG 结构损坏（段长度越界）');
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) {
      throw new ImageRejectedError('JPEG 结构损坏（段长度非法）');
    }
    const segment = bytes.subarray(offset, offset + 2 + length);

    if (marker === 0xffda) {
      // SOS：其后是熵编码数据，原样复制直到 EOI
      kept.push(segment);
      offset += 2 + length;
      sawSos = true;
      break;
    }

    if (isStartOfFrame(marker)) {
      // SOFn 里带高度/宽度
      if (segment.length >= 9) {
        height = segment.readUInt16BE(5);
        width = segment.readUInt16BE(7);
      }
    }

    if (!shouldDropJpegSegment(marker, segment)) kept.push(segment);
    offset += 2 + length;
  }

  if (!sawSos) throw new ImageRejectedError('JPEG 结构损坏（缺少扫描数据）');

  const eoiIndex = bytes.indexOf(Buffer.from([0xff, 0xd9]), offset);
  if (eoiIndex < 0) throw new ImageRejectedError('JPEG 结构损坏（缺少结束标记）');
  kept.push(bytes.subarray(offset, eoiIndex + 2));

  if (width === null || height === null || width <= 0 || height <= 0) {
    throw new ImageRejectedError('无法识别图片尺寸（文件可能已损坏）');
  }

  return { type: 'image/jpeg', bytes: Buffer.concat(kept), width, height };
}

function isStartOfFrame(marker: number): boolean {
  // SOF0..SOF15，排除 DHT(c4) / JPG(c8) / DAC(cc)
  return (
    marker >= 0xffc0 &&
    marker <= 0xffcf &&
    marker !== 0xffc4 &&
    marker !== 0xffc8 &&
    marker !== 0xffcc
  );
}

function shouldDropJpegSegment(marker: number, segment: Buffer): boolean {
  if (JPEG_DROP_MARKERS.has(marker)) return true;

  // APP2：只留 ICC 色彩描述（payload 前 11 字节是 'ICC_PROFILE'）
  if (marker === 0xffe2) {
    const payload = segment.subarray(4);
    return !(payload.length >= 11 && payload.subarray(0, 11).toString('latin1') === 'ICC_PROFILE');
  }

  // 其余 APPn（APP3..APP12 / APP15）一律丢弃；APP0(JFIF) 与 APP14(Adobe) 保留
  if (marker >= 0xffe0 && marker <= 0xffef) {
    return marker !== 0xffe0 && marker !== 0xffee;
  }

  return false;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

/** 含隐私/元数据的 chunk —— 直接丢弃 */
const PNG_DROP_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

/**
 * PNG 是分块结构，丢弃整块**不会**影响其它块的 CRC（每个块自带 CRC），
 * 因此这里只做"过滤重建"，其余块连数据带 CRC 原样搬运。
 * 同时校验：必须以 IHDR 开头、以 IEND 结尾，否则判为损坏。
 */
function sanitizePng(bytes: Buffer): ImageInfo {
  const kept: Buffer[] = [bytes.subarray(0, 8)]; // signature
  let offset = 8;
  let width: number | null = null;
  let height: number | null = null;
  let sawIhdr = false;

  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('latin1');
    const end = offset + 12 + length; // 4 长度 + 4 类型 + 数据 + 4 CRC
    if (length > 0x7fffffff || end > bytes.length) {
      throw new ImageRejectedError('PNG 结构损坏（块长度越界）');
    }

    if (!sawIhdr) {
      if (type !== 'IHDR' || length !== 13) {
        throw new ImageRejectedError('PNG 结构损坏（首个块不是 IHDR）');
      }
      sawIhdr = true;
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
    }

    if (!PNG_DROP_CHUNKS.has(type)) kept.push(bytes.subarray(offset, end));
    offset = end;

    if (type === 'IEND') {
      if (width === null || height === null || width <= 0 || height <= 0) {
        throw new ImageRejectedError('无法识别图片尺寸（文件可能已损坏）');
      }
      // IEND 之后的内容一律丢弃
      return { type: 'image/png', bytes: Buffer.concat(kept), width, height };
    }
  }

  throw new ImageRejectedError('PNG 结构损坏（缺少 IEND）');
}
