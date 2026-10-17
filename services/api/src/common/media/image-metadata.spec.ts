import { describe, expect, it } from 'vitest';

import { ImageRejectedError, sanitizeImage, sniffImageType } from './image-metadata';

/**
 * 图片元数据剥离测试。
 *
 * 这组测试守的是**隐私**（契约 A2.5），所以断言方式刻意选得"笨"：
 * 不看函数返回值里的中间结构，而是直接检查**最终字节**里还能不能找到
 * 那些元数据标记（`Exif\0\0`、`GPSLatitude`、`tEXt`…）。
 * 只有"输入里有、输出里没有"才算真的剥离干净。
 */

// ---------------------------------------------------------------------------
// 构造器：手工拼出结构合法的最小 JPEG / PNG
// ---------------------------------------------------------------------------

function segment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(marker, 0);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

/**
 * 结构合法的最小 JPEG：
 *   SOI → APP0(JFIF) → [extraSegments] → DQT → SOF0(2×3) → DHT → SOS → 扫描数据 → EOI
 */
function buildJpeg(extraSegments: Buffer[], scanData = Buffer.from([0x12, 0x34, 0x56, 0x78])): Buffer {
  const sof = Buffer.alloc(9);
  sof.writeUInt8(8, 0); // precision
  sof.writeUInt16BE(3, 1); // height = 3
  sof.writeUInt16BE(2, 3); // width = 2
  sof.writeUInt8(1, 5); // 1 component
  sof.writeUInt8(1, 6);
  sof.writeUInt8(0x11, 7);
  sof.writeUInt8(0, 8);

  const sos = Buffer.alloc(6);
  sos.writeUInt8(1, 0); // 1 component
  sos.writeUInt8(1, 1);
  sos.writeUInt8(0, 2);
  sos.writeUInt8(0, 3);
  sos.writeUInt8(63, 4);
  sos.writeUInt8(0, 5);

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    segment(0xffe0, Buffer.from('JFIF\0', 'latin1')),
    ...extraSegments,
    segment(0xffdb, Buffer.alloc(65, 0x01)), // DQT
    segment(0xffc0, sof), // SOF0
    segment(0xffc4, Buffer.alloc(20, 0x02)), // DHT
    segment(0xffda, sos), // SOS
    scanData,
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

/** 带 GPS 的 EXIF APP1 —— 真实相机就是这么写的 */
function exifApp1(): Buffer {
  const payload = Buffer.concat([
    Buffer.from('Exif\0\0', 'latin1'),
    Buffer.from('MM\0*', 'latin1'),
    // GPSLatitude / GPSLongitude 这类 tag 名，够用来断言"还在不在"
    Buffer.from('GPSLatitude\0GPSLongitude\0GPSAltitude\0', 'latin1'),
  ]);
  return segment(0xffe1, payload);
}

function iccApp2(): Buffer {
  return segment(0xffe2, Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.alloc(16)]));
}

function nonIccApp2(): Buffer {
  return segment(0xffe2, Buffer.from('MPF\0GPSLatitude\0', 'latin1'));
}

function commentSegment(): Buffer {
  return segment(0xfffe, Buffer.from('shot at home GPSLatitude', 'latin1'));
}

function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'latin1');
  // 本模块不校验 CRC，测试里用真实 CRC 反而会掩盖"CRC 原样搬运"的断言
  return Buffer.concat([header, data, Buffer.from([0xde, 0xad, 0xbe, 0xef])]);
}

function buildPng(chunks: Buffer[]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0); // width = 4
  ihdr.writeUInt32BE(6, 4); // height = 6
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', Buffer.from(ihdr)),
    ...chunks,
    pngChunk('IDAT', Buffer.from([0x01, 0x02, 0x03])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const GPS_TEXT = 'GPSLatitude';

// ---------------------------------------------------------------------------

describe('sniffImageType', () => {
  it('只认文件头，不认后缀名', () => {
    expect(sniffImageType(buildJpeg([]))).toBe('image/jpeg');
    expect(sniffImageType(buildPng([]))).toBe('image/png');
    expect(sniffImageType(Buffer.from('MZ\x90\x00 not an image'))).toBeNull();
    // GIF89a / RIFF(WebP) 都不支持
    expect(sniffImageType(Buffer.from('GIF89a....'))).toBeNull();
    expect(sniffImageType(Buffer.from('RIFF....WEBPVP8 '))).toBeNull();
  });
});

describe('JPEG · EXIF GPS 剥离', () => {
  it('APP1(EXIF) / COM / 非 ICC 的 APP2 全部消失，像素数据一字不改', () => {
    const input = buildJpeg([exifApp1(), commentSegment(), nonIccApp2(), iccApp2()]);
    const out = sanitizeImage(input);

    expect(out.type).toBe('image/jpeg');
    // 剥离后的字节里不能再出现任何元数据标记
    expect(out.bytes.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);
    expect(out.bytes.includes(Buffer.from(GPS_TEXT, 'latin1'))).toBe(false);
    // 只删段、不动像素：压缩后的字节一定比原图小，但仍以 SOI 开头、EOI 结尾
    expect(out.bytes.readUInt16BE(0)).toBe(0xffd8);
    expect(out.bytes.readUInt16BE(out.bytes.length - 2)).toBe(0xffd9);
    expect(out.bytes.length).toBeLessThan(input.length);
    // 扫描数据原样保留
    expect(out.bytes.includes(Buffer.from([0x12, 0x34, 0x56, 0x78]))).toBe(true);
  });

  it('ICC 色彩描述被保留（否则广色域照片会偏色）', () => {
    const out = sanitizeImage(buildJpeg([iccApp2()])).bytes;
    expect(out.includes(Buffer.from('ICC_PROFILE', 'latin1'))).toBe(true);
  });

  it('JFIF(APP0) 被保留', () => {
    const out = sanitizeImage(buildJpeg([])).bytes;
    expect(out.includes(Buffer.from('JFIF', 'latin1'))).toBe(true);
  });

  it('EOI 之后的追加内容被丢弃（有些相机把缩略图塞在文件尾）', () => {
    const input = Buffer.concat([buildJpeg([]), Buffer.from('GPSLatitude hidden tail', 'latin1')]);
    const out = sanitizeImage(input).bytes;
    expect(out.includes(Buffer.from(GPS_TEXT, 'latin1'))).toBe(false);
    expect(out.readUInt16BE(out.length - 2)).toBe(0xffd9);
  });

  it('能解析出宽高（3 行 2 列）', () => {
    const out = sanitizeImage(buildJpeg([]));
    expect(out.width).toBe(2);
    expect(out.height).toBe(3);
  });

  it('结构损坏（缺 SOS）时抛错，而不是原样放行', () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8]), segment(0xffe1, exifApp1())]);
    expect(() => sanitizeImage(broken)).toThrow(ImageRejectedError);
  });

  it('段长度越界时抛错', () => {
    const broken = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe1, 0xff, 0xff]),
      Buffer.from([0x00, 0x01]),
    ]);
    expect(() => sanitizeImage(broken)).toThrow(ImageRejectedError);
  });
});

describe('PNG · 元数据剥离', () => {
  it('tEXt / eXIf / tIME 被丢弃，IHDR/IDAT/IEND 与它们的 CRC 原样保留', () => {
    const input = buildPng([
      pngChunk('tEXt', Buffer.from(`Comment\0${GPS_TEXT}`, 'latin1')),
      pngChunk('eXIf', Buffer.from('MM\0* GPSLatitude', 'latin1')),
      pngChunk('tIME', Buffer.from([0x07, 0xe8, 1, 1, 0, 0, 0])),
    ]);
    const out = sanitizeImage(input);

    expect(out.type).toBe('image/png');
    expect(out.bytes.includes(Buffer.from(GPS_TEXT, 'latin1'))).toBe(false);
    expect(out.bytes.includes(Buffer.from('tEXt', 'latin1'))).toBe(false);
    expect(out.bytes.includes(Buffer.from('eXIf', 'latin1'))).toBe(false);
    expect(out.bytes.includes(Buffer.from('IHDR', 'latin1'))).toBe(true);
    expect(out.bytes.includes(Buffer.from('IDAT', 'latin1'))).toBe(true);
    expect(out.bytes.includes(Buffer.from('IEND', 'latin1'))).toBe(true);
    // CRC 没有被重算（chunk 原样搬运）
    expect(out.bytes.includes(Buffer.from([0xde, 0xad, 0xbe, 0xef]))).toBe(true);
    expect(out.width).toBe(4);
    expect(out.height).toBe(6);
  });

  it('必须兼容 iOS 截图常见的 sRGB / pHYs 等非元数据块', () => {
    const out = sanitizeImage(buildPng([pngChunk('pHYs', Buffer.alloc(9))])).bytes;
    expect(out.includes(Buffer.from('pHYs', 'latin1'))).toBe(true);
  });

  it('IEND 之后的内容被丢弃', () => {
    const input = Buffer.concat([buildPng([]), Buffer.from('GPSLatitude', 'latin1')]);
    expect(sanitizeImage(input).bytes.includes(Buffer.from(GPS_TEXT, 'latin1'))).toBe(false);
  });

  it('缺 IEND 时抛错', () => {
    const broken = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', Buffer.alloc(13)),
    ]);
    expect(() => sanitizeImage(broken)).toThrow(ImageRejectedError);
  });
});

describe('sanitizeImage · 边界', () => {
  it('空内容 / 非图片一律拒绝，且文案告诉用户怎么办', () => {
    expect(() => sanitizeImage(Buffer.alloc(0))).toThrow('图片内容为空');
    expect(() => sanitizeImage(Buffer.from('hello'))).toThrow('只支持 JPG / PNG 图片');
  });
});
