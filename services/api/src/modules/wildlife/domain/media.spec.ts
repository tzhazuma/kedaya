/**
 * wildlife · 图片链路验收（规格 §4 / §11.5）
 *
 * **最重要的一条是 T9**：构造带 GPS EXIF 的 JPEG → 走上传链路 → 断言输出无 EXIF。
 * 这是隐私防线的最后一道 —— EXIF 里的 GPS 精度可达米级，
 * 会**完全绕过** §9 精心设计的全部位置模糊化。
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  MEDIA_MAX_BYTES,
  MEDIA_MAX_EDGE_PX,
  MEDIA_MAX_PIXELS,
  acceptUpload,
  assertNoMetadata,
  hasMetadata,
  inspectMetadata,
  readImageSize,
  sniffImageMime,
  stripMetadata,
  tiffHasGpsInfo,
} from './media';
import { AppError } from '../../../common/errors/app-error';
import {
  buildJpegHeader,
  buildJpegWithComment,
  buildJpegWithGpsExif,
  buildJpegWithPlainExif,
  buildJpegWithXmpGps,
  buildPlainJpeg,
  buildPlainPng,
  buildPlainWebp,
  buildPngWithGpsExif,
  buildPngWithGpsText,
  buildTextFile,
  buildTiffWithGps,
  buildWebpWithGpsExif,
} from '../../../../test/fixtures/wildlife-media';

/** 断言抛出的 AppError 带指定 reason */
async function expectReason(fn: () => unknown, reason: string): Promise<void> {
  try {
    await fn();
    throw new Error('期望抛错但没有');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).details).toMatchObject({ reason });
  }
}

describe('§4.3 EXIF 剥离（T9，**失败则不得合并**）', () => {
  it('带 GPS EXIF 的 JPEG：输入确实含 GPS，输出**完全没有** EXIF/GPS', async () => {
    const input = await buildJpegWithGpsExif();

    // 先证明夹具本身"有毒"：否则测试可能因为夹具没带 GPS 而假通过
    expect(tiffHasGpsInfo(buildTiffWithGps())).toBe(true);
    const before = inspectMetadata(input, 'image/jpeg');
    expect(before.hasExif).toBe(true);
    expect(before.hasGps).toBe(true);
    // sharp（独立第三方解析器）也确认输入带 EXIF
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const accepted = acceptUpload(input, 'image/jpeg');

    // ① 我们自己的解析器：无任何元数据
    const after = inspectMetadata(accepted.data, 'image/jpeg');
    expect(after).toEqual({ hasExif: false, hasGps: false, hasXmp: false, hasTextChunks: false });
    // ② 独立解析器复核：sharp 也读不到 EXIF
    expect((await sharp(accepted.data).metadata()).exif).toBeUndefined();
    // ③ 原始字节里不再有 Exif 魔数，也不再有 GPS 标签字节
    expect(accepted.data.includes(Buffer.from('Exif\0\0', 'binary'))).toBe(false);
    expect(accepted.data.includes(Buffer.from([0x88, 0x25]))).toBe(false);
    // ④ 输出仍是**可解码**的图片（剥离不等于把图弄坏）
    const meta = await sharp(accepted.data).metadata();
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(24);
    expect(accepted.width).toBe(32);
    expect(accepted.height).toBe(24);
  });

  it('只有 EXIF（无 GPS）也要剥离', async () => {
    const input = await buildJpegWithPlainExif();
    expect(inspectMetadata(input, 'image/jpeg').hasExif).toBe(true);
    const accepted = acceptUpload(input, 'image/jpeg');
    expect(inspectMetadata(accepted.data, 'image/jpeg').hasExif).toBe(false);
  });

  it('XMP（纯文本 GPS）也要剥离', async () => {
    const input = await buildJpegWithXmpGps();
    const before = inspectMetadata(input, 'image/jpeg');
    expect(before.hasXmp).toBe(true);
    expect(before.hasGps).toBe(true);

    const accepted = acceptUpload(input, 'image/jpeg');
    const after = inspectMetadata(accepted.data, 'image/jpeg');
    expect(after.hasXmp).toBe(false);
    expect(after.hasGps).toBe(false);
  });

  it('COM 自由文本段（"宿舍 12 号楼 305"）也要剥离', async () => {
    const input = await buildJpegWithComment();
    expect(inspectMetadata(input, 'image/jpeg').hasTextChunks).toBe(true);
    const accepted = acceptUpload(input, 'image/jpeg');
    expect(inspectMetadata(accepted.data, 'image/jpeg').hasTextChunks).toBe(false);
    expect(accepted.data.toString('binary')).not.toContain('dorm 12');
  });

  it('PNG 的 eXIf 块（含 GPS IFD）被剥离', async () => {
    const input = await buildPngWithGpsExif();
    expect(inspectMetadata(input, 'image/png')).toMatchObject({ hasExif: true, hasGps: true });

    const accepted = acceptUpload(input, 'image/png');
    expect(inspectMetadata(accepted.data, 'image/png')).toEqual({
      hasExif: false,
      hasGps: false,
      hasXmp: false,
      hasTextChunks: false,
    });
    expect(accepted.data.includes(Buffer.from('eXIf', 'ascii'))).toBe(false);
    // 仍可解码
    expect((await sharp(accepted.data).metadata()).width).toBe(32);
  });

  it('PNG 的 tEXt 块（明文 GPS 坐标）被剥离', async () => {
    const input = await buildPngWithGpsText();
    expect(inspectMetadata(input, 'image/png')).toMatchObject({ hasTextChunks: true, hasGps: true });

    const accepted = acceptUpload(input, 'image/png');
    expect(inspectMetadata(accepted.data, 'image/png').hasTextChunks).toBe(false);
    expect(accepted.data.toString('binary')).not.toContain('121.5901');
  });

  it('WebP 的 EXIF 块（含 GPS IFD）被剥离', async () => {
    const input = await buildWebpWithGpsExif();
    expect(inspectMetadata(input, 'image/webp')).toMatchObject({ hasExif: true, hasGps: true });

    const accepted = acceptUpload(input, 'image/webp');
    expect(inspectMetadata(accepted.data, 'image/webp')).toEqual({
      hasExif: false,
      hasGps: false,
      hasXmp: false,
      hasTextChunks: false,
    });
    expect((await sharp(accepted.data).metadata()).width).toBe(32);
  });

  it('干净图片原样通过（剥离不是"把图都改一遍"）', async () => {
    const input = await buildPlainJpeg();
    const accepted = acceptUpload(input, 'image/jpeg');
    expect(hasMetadata(accepted.data, 'image/jpeg')).toBe(false);
    expect(accepted.mime).toBe('image/jpeg');
  });

  it('assertNoMetadata 是**防御性**断言：有人塞回 EXIF 就抛错（宁可 500）', async () => {
    const dirty = await buildJpegWithGpsExif();
    expect(() => assertNoMetadata(dirty, 'image/jpeg')).toThrow(/EXIF_STRIP_FAILED/);
    expect(() => assertNoMetadata(dirty, 'image/jpeg')).toThrow(/gps=true/);
  });

  it('stripMetadata 幂等：剥两次与剥一次结果相同', async () => {
    const input = await buildJpegWithGpsExif();
    const once = stripMetadata(input, 'image/jpeg');
    const twice = stripMetadata(once, 'image/jpeg');
    expect(twice.equals(once)).toBe(true);
  });

  it('剥离后容器类型不变（不会把 JPEG 变成别的）', async () => {
    for (const [build, mime] of [
      [buildPlainJpeg, 'image/jpeg'],
      [buildPlainPng, 'image/png'],
      [buildPlainWebp, 'image/webp'],
    ] as const) {
      const input = await build();
      const accepted = acceptUpload(input, mime);
      expect(sniffImageMime(accepted.data)).toBe(mime);
    }
  });
});

describe('§4.2 魔数校验与格式限制（T36 / T35 / T40）', () => {
  it('改扩展名的文本文件被拒（**不信任 Content-Type**）', async () => {
    const text = buildTextFile();
    await expectReason(() => acceptUpload(text, 'image/jpeg'), 'MEDIA_UNSUPPORTED_TYPE');
  });

  it('声明 image/png 但实际是 JPEG → 按文件头处理（魔数优先）', async () => {
    const jpeg = await buildPlainJpeg();
    const accepted = acceptUpload(jpeg, 'image/png');
    expect(accepted.mime).toBe('image/jpeg');
  });

  it('空内容被拒', async () => {
    await expectReason(() => acceptUpload(Buffer.alloc(0), 'image/jpeg'), 'MEDIA_UNSUPPORTED_TYPE');
  });

  it('超过 5 MB → MEDIA_TOO_LARGE（T35）', async () => {
    const huge = Buffer.alloc(MEDIA_MAX_BYTES + 1, 0xff);
    await expectReason(() => acceptUpload(huge, 'image/jpeg'), 'MEDIA_TOO_LARGE');
  });

  it('边长超过 4096px → MEDIA_TOO_LARGE', async () => {
    const wide = buildJpegHeader(MEDIA_MAX_EDGE_PX + 100, 500);
    await expectReason(() => acceptUpload(wide, 'image/jpeg'), 'MEDIA_TOO_LARGE');
  });

  it('像素数超过 40 MP → MEDIA_TOO_MANY_PIXELS（T40，解压炸弹）', async () => {
    // 4096 × 10000 = 40.96 MP：像素数先于边长判定，因此这条规则**可达**
    const bomb = buildJpegHeader(4096, 10_000);
    expect(4096 * 10_000).toBeGreaterThan(MEDIA_MAX_PIXELS);
    await expectReason(() => acceptUpload(bomb, 'image/jpeg'), 'MEDIA_TOO_MANY_PIXELS');
  });

  it('尺寸解析：JPEG/PNG/WebP 三种容器都能读出真实尺寸', async () => {
    expect(readImageSize(await buildPlainJpeg(), 'image/jpeg')).toEqual({ width: 32, height: 24 });
    expect(readImageSize(await buildPlainPng(), 'image/png')).toEqual({ width: 32, height: 24 });
    expect(readImageSize(await buildPlainWebp(), 'image/webp')).toEqual({ width: 32, height: 24 });
  });

  it('损坏的图片（只有 SOI）被拒，而不是崩溃', () => {
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg');
    expect(readImageSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg')).toBeNull();
  });
});

describe('缩略图（规格 §4.4，非隐私路径）', () => {
  it('sharp 可用时能生成 400px 长边 WebP 缩略图', async () => {
    const input = await buildPlainJpeg();
    const accepted = acceptUpload(input, 'image/jpeg');
    const thumb = await sharp(accepted.data).resize({ width: 400, height: 400, fit: 'inside' }).webp({ quality: 80 }).toBuffer();
    const meta = await sharp(thumb).metadata();
    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(400);
    // 缩略图同样不含元数据（它是从已剥离的字节生成的）
    expect((await sharp(thumb).metadata()).exif).toBeUndefined();
  });
});
