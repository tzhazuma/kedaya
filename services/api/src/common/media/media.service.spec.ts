import { describe, expect, it } from 'vitest';

import { DisabledMediaStorage } from './disabled-media.storage';
import { LocalDiskMediaStorage } from './local-disk-media.storage';
import { buildMediaKey, MediaService } from './media.service';
import { createMediaUrlPolicy } from './media-url';
import { type MediaOptions, type MediaPutInput, type MediaStoragePort } from './media.port';

/**
 * 媒体用例测试。
 *
 * 这里守的是"图片能不能安全地进来"这条链路，重点三条：
 *   1. **未配置存储时明确失败**（而不是 500、也不是静默存下未剥离的图）；
 *   2. **元数据一定被剥离**（A2.5）—— 断言落在"存进去的字节里没有 EXIF"；
 *   3. **key 由服务端生成**：客户端无法通过任何入参影响存储路径。
 */

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function jpegWithGps(): Buffer {
  const seg = (marker: number, payload: Buffer): Buffer => {
    const header = Buffer.alloc(4);
    header.writeUInt16BE(marker, 0);
    header.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([header, payload]);
  };

  const sof = Buffer.alloc(9);
  sof.writeUInt8(8, 0);
  sof.writeUInt16BE(3, 1);
  sof.writeUInt16BE(2, 3);
  sof.writeUInt8(1, 5);

  const sos = Buffer.alloc(6);

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xffe0, Buffer.from('JFIF\0')),
    seg(0xffe1, Buffer.from('Exif\0\0MM\0*GPSLatitude\0', 'latin1')),
    seg(0xffdb, Buffer.alloc(65, 1)),
    seg(0xffc0, sof),
    seg(0xffc4, Buffer.alloc(20, 2)),
    seg(0xffda, sos),
    Buffer.from([1, 2, 3, 4]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function dataUrlOf(bytes: Buffer, mime = 'image/jpeg'): string {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/** 记录 put 内容的假存储 */
function createRecordingStorage(): MediaStoragePort & { puts: MediaPutInput[]; removed: string[] } {
  const puts: MediaPutInput[] = [];
  const removed: string[] = [];
  return {
    kind: 's3',
    enabled: true,
    puts,
    removed,
    async put(input) {
      puts.push({ ...input, body: Buffer.from(input.body) });
    },
    async remove(key) {
      removed.push(key);
    },
    publicUrl: (key) => `https://cdn.example.com/${key}`,
  };
}

const OPTIONS: MediaOptions = {
  maxBytes: 2 * 1024 * 1024,
  maxCount: 9,
  maxDimension: 8000,
  accept: ['image/jpeg', 'image/png'],
};

function createService(storage: MediaStoragePort): MediaService {
  return new MediaService(storage, OPTIONS);
}

// ---------------------------------------------------------------------------

describe('MediaService.uploadImage', () => {
  it('落存储的是**已剥离 EXIF/GPS**的字节，并且返回可直接用的绝对地址', async () => {
    const storage = createRecordingStorage();
    const service = createService(storage);

    const result = await service.uploadImage(dataUrlOf(jpegWithGps()), 'http://localhost:3999');

    expect(storage.puts).toHaveLength(1);
    const stored = storage.puts[0]!;
    expect(stored.contentType).toBe('image/jpeg');
    // 关键断言：丢进对象存储的字节里不再有 EXIF 标记
    expect(stored.body.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);
    expect(stored.body.includes(Buffer.from('GPSLatitude', 'latin1'))).toBe(false);
    // 但像素数据还在
    expect(stored.body.includes(Buffer.from([1, 2, 3, 4]))).toBe(true);

    expect(result.metadataStripped).toBe(true);
    expect(result.width).toBe(2);
    expect(result.height).toBe(3);
    expect(result.url).toBe(`https://cdn.example.com/${result.key}`);
  });

  it('key 由服务端生成：客户端无论传什么内容都无法影响存储路径', async () => {
    const storage = createRecordingStorage();
    const service = createService(storage);

    const first = await service.uploadImage(dataUrlOf(jpegWithGps()), 'http://localhost:1');
    const second = await service.uploadImage(dataUrlOf(jpegWithGps()), 'http://localhost:1');

    expect(first.key).not.toBe(second.key);
    expect(first.key).toMatch(/^media-\d{8}-[0-9a-f-]{36}\.jpg$/);
  });

  it('本地模式返回相对路径时补全为绝对地址（小程序 <Image> 不接受相对路径）', async () => {
    const storage = createRecordingStorage();
    storage.publicUrl = (key) => `/api/v1/media/files/${key}`;
    const service = createService(storage);

    const result = await service.uploadImage(dataUrlOf(jpegWithGps()), 'https://api.example.com/');
    expect(result.url).toBe(`https://api.example.com/api/v1/media/files/${result.key}`);
  });

  it('未配置存储时给出可读的 503 文案，而不是 500', async () => {
    const service = createService(new DisabledMediaStorage());
    await expect(service.uploadImage(dataUrlOf(jpegWithGps()), 'http://localhost')).rejects.toThrow(
      /尚未配置/,
    );
  });

  it('伪装的非图片（改了后缀的文本）被拒 —— 只看文件头，不看声明的 MIME', async () => {
    const service = createService(createRecordingStorage());
    const fake = Buffer.from('MZ\x90\x00 this is not an image');
    await expect(service.uploadImage(dataUrlOf(fake), 'http://localhost')).rejects.toThrow(
      /只支持 JPG \/ PNG/,
    );
  });

  it('超过大小上限时拒绝，并告诉用户当前多大', async () => {
    const service = new MediaService(createRecordingStorage(), { ...OPTIONS, maxBytes: 128 });
    await expect(
      service.uploadImage(dataUrlOf(jpegWithGps()), 'http://localhost'),
    ).rejects.toThrow(/不能超过 0 KB|不能超过/);
  });

  it('不是 data URL / 不是 base64 一律拒绝', async () => {
    const service = createService(createRecordingStorage());
    await expect(service.uploadImage('https://evil.example/x.jpg', 'http://localhost')).rejects.toThrow(
      /data URL/,
    );
    await expect(
      service.uploadImage('data:image/jpeg;base64,!!!!not-base64!!!!', 'http://localhost'),
    ).rejects.toThrow(/base64/);
  });

  it('WebP / GIF 明确拒绝（我们没有能力剥离它们的元数据）', async () => {
    const service = createService(createRecordingStorage());
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
    await expect(
      service.uploadImage(`data:image/webp;base64,${webp.toString('base64')}`, 'http://localhost'),
    ).rejects.toThrow(/只支持 JPG \/ PNG/);
  });
});

describe('MediaService.deleteImage', () => {
  it('只允许删除本服务生成的 key 形状（挡住遍历删除）', async () => {
    const storage = createRecordingStorage();
    const service = createService(storage);

    await expect(service.deleteImage('../../etc/passwd')).rejects.toThrow(/无效/);
    await expect(service.deleteImage('other-app/important.jpg')).rejects.toThrow(/无效/);
    expect(storage.removed).toHaveLength(0);
  });

  it('合法 key 会真的调用存储删除，且幂等（不存在也不报错）', async () => {
    const storage = createRecordingStorage();
    const service = createService(storage);
    const key = buildMediaKey('image/jpeg', new Date('2026-10-17T00:00:00.000Z'));

    await service.deleteImage(key);
    await service.deleteImage(key);
    expect(storage.removed).toEqual([key, key]);
  });
});

describe('buildMediaKey', () => {
  it('形状固定、可排序、不含 `/`（因此不可能路径穿越）', () => {
    const key = buildMediaKey('image/png', new Date('2026-10-17T00:00:00.000Z'));
    expect(key).toMatch(/^media-20261017-[0-9a-f-]{36}\.png$/);
    expect(key).not.toContain('/');
    expect(key).not.toContain('..');
  });
});

describe('createMediaUrlPolicy（业务模块写入路径的守卫）', () => {
  it('只放行本平台产出的地址', () => {
    const policy = createMediaUrlPolicy({ publicBaseUrl: 'https://cdn.example.com' });
    const key = buildMediaKey('image/jpeg');

    expect(policy.isAllowed(`https://cdn.example.com/${key}`)).toBe(true);
    expect(policy.isAllowed(`/api/v1/media/files/${key}`)).toBe(true);
    expect(policy.isAllowed(`https://api.example.com/api/v1/media/files/${key}`)).toBe(true);

    // 外链 / 追踪像素 / 伪造 key 一律拒绝
    expect(policy.isAllowed('https://evil.example/pixel.gif')).toBe(false);
    expect(policy.isAllowed('https://cdn.example.com/whatever.jpg')).toBe(false);
    expect(policy.isAllowed(`data:image/jpeg;base64,${Buffer.from('x').toString('base64')}`)).toBe(false);
    expect(policy.isAllowed('javascript:alert(1)')).toBe(false);
  });

  it('assertAllowed 抛的是 VALIDATION_FAILED（不是 500）', () => {
    const policy = createMediaUrlPolicy();
    expect(() => policy.assertAllowed('https://evil.example/x.jpg')).toThrow(/图片地址无效/);
  });

  it('没配 publicBaseUrl 时，CDN 地址也不放行 —— 宁严不松', () => {
    const policy = createMediaUrlPolicy();
    const key = buildMediaKey('image/jpeg');
    expect(policy.isAllowed(`https://cdn.example.com/${key}`)).toBe(false);
    expect(policy.isAllowed(`/api/v1/media/files/${key}`)).toBe(true);
  });
});

describe('LocalDiskMediaStorage（开发模式）', () => {
  it('拒绝含路径的 key，写入/读取/删除闭环', async () => {
    const storage = new LocalDiskMediaStorage({
      directory: `${process.env['TMPDIR'] ?? '/tmp'}/kedaya-media-test`,
      urlBase: '/api/v1/media/files',
    });
    const key = buildMediaKey('image/jpeg');

    await storage.put({ key, body: Buffer.from('hello'), contentType: 'image/jpeg' });
    expect((await storage.read(key)).toString()).toBe('hello');
    expect(storage.publicUrl(key)).toBe(`/api/v1/media/files/${key}`);

    await storage.remove(key);
    await expect(storage.read(key)).rejects.toThrow(/不存在/);

    await expect(
      storage.put({ key: '../escape.jpg', body: Buffer.from('x'), contentType: 'image/jpeg' }),
    ).rejects.toThrow(/非法的存储 key/);
  });
});
