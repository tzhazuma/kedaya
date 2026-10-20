#!/usr/bin/env node
/**
 * 上科大一图通（map.niyiwei.com）**照片清单**导入器。
 *
 * ## 授权前提（重要）
 *
 * 项目负责人唐志昊已口头获得对方参赛组同意，允许合并其：
 *   · 地下车库照片 / 导向图；
 *   · 食堂菜单照片。
 *
 * **没有书面文件**。因此本脚本与生成物都按「可撤回的借用」处理：
 *   1. 每一条照片都带 `credit`（来源方署名）与 `sourceUrl`；
 *   2. 生成物有 `NIYIWEI_PHOTOS_ENABLED` 开关；
 *   3. `node tools/import-niyiwei-photos.mjs --revoke` 一条命令清空清单并关闭开关；
 *   4. `--restore` 可重新生成（需要网络；撤回不需要网络）。
 *
 * ## 只取照片，不取别的
 *
 * 本脚本只从两个公开端点读取**照片路径**：
 *   · `/api/canteens`（失败时回落 `/data/canteens.json`）—— 只取 `stalls[].photos`
 *     中以 `photos/menus/` 开头的条目，**丢弃**菜品、价格、营养、评论等所有字段；
 *   · `/data/underground.json` —— 只取 `sources[].image`。
 *
 * 不登录、不绕过任何限制、不写 cookie、不抓取用户数据或评论。站点没有
 * robots.txt（404），这些照片本身是公开静态资源。
 *
 * ## 为什么默认**不**把图片打进仓库 / 小程序包
 *
 * 实测 54 张图共 **31.41 MiB**，而微信主包上限 2 MiB（当前主包约 1.65 MiB）。
 * 因此清单默认使用**远程 URL**，小程序包体积增量为 0。若确需离线归档，
 * 用 `--download`（默认落到 `apps/miniapp/src/assets/niyiwei/`，**不会**被
 * `config/index.ts` 的 copy 规则打进主包，因为没有任何代码 import 它们）。
 *
 * ⚠️ 远程图片在真机上要求把 `map.niyiwei.com` 加入小程序后台的
 * 「downloadFile 合法域名」；否则图片不显示。这是部署配置，不是代码问题。
 *
 * ## 用法
 *
 *   node tools/import-niyiwei-photos.mjs              # 生成/更新远程清单（默认）
 *   node tools/import-niyiwei-photos.mjs --check      # 只探测全部图片可访问性与体积
 *   node tools/import-niyiwei-photos.mjs --dry-run    # 只打印，不写文件
 *   node tools/import-niyiwei-photos.mjs --download   # 额外下载原图做离线归档
 *   node tools/import-niyiwei-photos.mjs --download --out /tmp/niyiwei
 *   node tools/import-niyiwei-photos.mjs --revoke     # 一键下架（断网也能跑）
 *   node tools/import-niyiwei-photos.mjs --restore    # 重新生成清单
 *
 * 幂等：输出按 poiId + url 排序；文件内容不变时不落盘；下载按内容 sha256 命名，
 * 重复运行不会产生重复文件。
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const ORIGIN = 'https://map.niyiwei.com';
const CANTEEN_API = `${ORIGIN}/api/canteens`;
const CANTEEN_STATIC = `${ORIGIN}/data/canteens.json`;
const UNDERGROUND = `${ORIGIN}/data/underground.json`;

/** 生成物路径（本仓库唯一照片清单） */
const MANIFEST = path.join(
  REPO_ROOT,
  'apps',
  'miniapp',
  'src',
  'application',
  'campusPoi',
  'campusPoiPhotos.ts',
);

/** 默认下载目录：不在任何 copy 规则里，也不会被 webpack 打包 */
const DEFAULT_DOWNLOAD_DIR = path.join(
  REPO_ROOT,
  'apps',
  'miniapp',
  'src',
  'assets',
  'niyiwei',
);

/**
 * 署名文案。
 *
 * ⚠️ 对方站点**没有**逐张标注拍摄者姓名，我们也不编造。署名到「来源方」粒度：
 * 这是著作权的实际持有方（参赛组），也是授权方。若日后对方给出具体拍摄者，
 * 改这一处常量并重跑即可。
 */
const CREDIT =
  '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权';

const AUTHORIZED_BY = '唐志昊（可达鸭项目负责人）';
const AUTH_MODE = 'oral'; // 口头授权，无书面凭证 —— 所以必须可撤回
const AUTH_DATE = '2026-10-20';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36 kedaya-photo-import/1.0';

const MENU_PATH = /^photos\/menus\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp)$/i;
const GARAGE_PATH = /^\/data\/underground\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp)$/i;

/* ------------------------------------------------------------------ *
 * 参数
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const options = {
    mode: 'generate', // generate | revoke | check
    download: false,
    out: DEFAULT_DOWNLOAD_DIR,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--revoke') options.mode = 'revoke';
    else if (arg === '--check') options.mode = 'check';
    else if (arg === '--restore') options.mode = 'generate';
    else if (arg === '--download') options.download = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--out') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('--out 需要一个目录参数');
      }
      options.out = path.resolve(process.cwd(), value);
      i += 1;
    } else {
      throw new Error(`未知参数：${arg}（用 --help 查看用法）`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`用法：node tools/import-niyiwei-photos.mjs [选项]

  （无参数）        从 map.niyiwei.com 拉取照片清单并生成 campusPoiPhotos.ts
  --check          只探测 54 张图的可访问性与总体积，不写文件
  --dry-run        打印将写入的条目，不落盘
  --download       额外下载原图（默认 apps/miniapp/src/assets/niyiwei/）
  --out <dir>      指定下载目录（配合 --download）
  --revoke         一键下架：清空清单、关闭开关（不需要网络）
  --restore        重新生成清单（等同无参数）
  --help           显示本帮助
`);
}

/* ------------------------------------------------------------------ *
 * 抓取（只读；只保留照片路径）
 * ------------------------------------------------------------------ */

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.json();
}

function absolutePhotoPath(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.startsWith(`${ORIGIN}/`) ? trimmed : null;
  }
  return trimmed.startsWith('/') ? `${ORIGIN}${trimmed}` : `${ORIGIN}/${trimmed}`;
}

/**
 * 拉取并归一化照片清单。
 *
 * 返回的条目**只有** poiId / title / url / sourceUrl，绝不携带菜品、价格、
 * 评论或用户数据 —— 那些字段在下面的循环里从未被读取。
 */
async function fetchPhotoIndex() {
  let canteenPayload;
  let canteenSource = CANTEEN_API;
  try {
    canteenPayload = await fetchJson(CANTEEN_API);
  } catch (apiError) {
    console.warn(`! ${CANTEEN_API} 不可用（${apiError.message}），回落静态 JSON`);
    canteenPayload = await fetchJson(CANTEEN_STATIC);
    canteenSource = CANTEEN_STATIC;
  }

  const undergroundPayload = await fetchJson(UNDERGROUND);

  const entries = [];
  const skipped = [];
  const seen = new Set();

  const push = (entry) => {
    const key = `${entry.poiId}\u0000${entry.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  };

  const canteens = Array.isArray(canteenPayload?.canteens) ? canteenPayload.canteens : [];
  for (const canteen of canteens) {
    for (const outlet of Array.isArray(canteen?.outlets) ? canteen.outlets : []) {
      for (const stall of Array.isArray(outlet?.stalls) ? outlet.stalls : []) {
        const photos = Array.isArray(stall?.photos) ? stall.photos : [];
        const menuPhotos = photos.filter((photo) => {
          if (typeof photo !== 'string') return false;
          if (MENU_PATH.test(photo.trim())) return true;
          skipped.push(`菜单照片路径不在白名单：${String(photo).slice(0, 120)}`);
          return false;
        });

        menuPhotos.forEach((photo, index) => {
          const url = absolutePhotoPath(photo);
          if (url === null) {
            skipped.push(`无法归一到 ${ORIGIN}：${String(photo).slice(0, 120)}`);
            return;
          }
          const title = typeof stall?.zh === 'string' && stall.zh.trim() !== '' ? stall.zh : stall.id;
          push({
            poiId: `niyiwei-stall-${stall.id}`,
            title: `${title} · 菜单 ${index + 1}/${menuPhotos.length}`,
            url,
            credit: CREDIT,
            sourceUrl: url,
          });
        });
      }
    }
  }

  const sources = Array.isArray(undergroundPayload?.sources) ? undergroundPayload.sources : [];
  for (const source of sources) {
    const image = typeof source?.image === 'string' ? source.image.trim() : '';
    if (!GARAGE_PATH.test(image)) {
      skipped.push(`车库照片路径不在白名单：${image.slice(0, 120) || '(空)'}`);
      continue;
    }
    const url = absolutePhotoPath(image);
    if (url === null) {
      skipped.push(`无法归一到 ${ORIGIN}：${image.slice(0, 120)}`);
      continue;
    }
    push({
      poiId: 'niyiwei-parking-garage-b1',
      title: typeof source?.title === 'string' && source.title.trim() !== '' ? source.title : source.id,
      url,
      credit: CREDIT,
      sourceUrl: url,
    });
  }

  entries.sort((a, b) => (a.poiId === b.poiId ? compare(a.url, b.url) : compare(a.poiId, b.poiId)));

  for (const entry of entries) {
    if (typeof entry.credit !== 'string' || entry.credit.trim() === '') {
      throw new Error(`照片缺署名，拒绝写入：${entry.url}`);
    }
  }

  return { entries, skipped, canteenSource };
}

function compare(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/* ------------------------------------------------------------------ *
 * 生成物
 * ------------------------------------------------------------------ */

function quote(value) {
  // 与仓库现有 TS 风格一致：单引号、无反斜杠多余转义
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function renderManifest({ entries, enabled, revoked }) {
  const lines = [];
  lines.push('/**');
  lines.push(' * 校园 POI 照片清单 · **上科大一图通（map.niyiwei.com）授权借用**');
  lines.push(' *');
  lines.push(' * ⚠️ 本文件由 `tools/import-niyiwei-photos.mjs` 生成，**不要手改**。');
  lines.push(' *');
  lines.push(' * ## 授权与可撤回性');
  lines.push(' *');
  lines.push(' * 项目负责人唐志昊已**口头**获得对方参赛组同意，允许合并其地下车库照片与');
  lines.push(' * 食堂菜单照片；**没有书面文件**。因此这里按「可撤回的借用」实现：');
  lines.push(' *');
  lines.push(' *   · 每条照片都带 `credit`（来源方署名）与 `sourceUrl`；');
  lines.push(' *   · 开关 `NIYIWEI_PHOTOS_ENABLED` 为 `false` 时，`activeNiyiweiPhotos()` 返回空；');
  lines.push(' *   · 一条命令下架（不需要网络）：');
  lines.push(' *       `node tools/import-niyiwei-photos.mjs --revoke`');
  lines.push(' *   · 恢复：`node tools/import-niyiwei-photos.mjs --restore`。');
  lines.push(' *');
  lines.push(' * ## 体积');
  lines.push(' *');
  lines.push(' * 照片**不打包**，只用远程 URL。实测 54 张原图共约 31.41 MiB，而微信主包上限');
  lines.push(' * 2 MiB —— 打进包会直接上传失败。部署时需把 `map.niyiwei.com` 加入小程序');
  lines.push(' * 后台的「downloadFile 合法域名」，否则真机不显示（远程图仍需要域名白名单）。');
  lines.push(' *');
  lines.push(' * ## 只借用照片');
  lines.push(' *');
  lines.push(' * 清单只含照片地址与来源方署名，不含对方站点的菜品、价格、评论或任何用户数据。');
  lines.push(' */');
  lines.push('');
  lines.push(`export const NIYIWEI_PHOTO_ORIGIN = ${quote(ORIGIN)}`);
  lines.push('');
  lines.push('/** 来源方署名（著作权归对方拍摄者；对方未逐张标注姓名，这里署名到参赛组粒度） */');
  lines.push(`export const NIYIWEI_PHOTO_CREDIT = ${quote(CREDIT)}`);
  lines.push('');
  lines.push('/** 授权元数据：**口头**授权，无可归档的书面凭证 */');
  lines.push('export const NIYIWEI_PHOTO_AUTHORIZATION = {');
  lines.push(`  authorizedBy: ${quote(AUTHORIZED_BY)},`);
  lines.push(`  mode: ${quote(AUTH_MODE)},`);
  lines.push(`  grantedAt: ${quote(AUTH_DATE)},`);
  lines.push('  evidence: null,');
  lines.push('  revocable: true,');
  lines.push('} as const');
  lines.push('');
  lines.push(`export const NIYIWEI_PHOTOS_ENABLED = ${enabled ? 'true' : 'false'}`);
  lines.push('');
  lines.push('/** 一键下架命令（断网可执行） */');
  lines.push(
    `export const NIYIWEI_PHOTOS_REVOKE_COMMAND = ${quote('node tools/import-niyiwei-photos.mjs --revoke')}`,
  );
  lines.push('');
  lines.push('export interface CampusPoiPhoto {');
  lines.push('  /** 稳定 POI id；同一摊位的多张菜单共享一个 id */');
  lines.push('  readonly poiId: string;');
  lines.push('  /** 展示标题（含「菜单 n/m」序号） */');
  lines.push('  readonly title: string;');
  lines.push('  /** 远程图片 URL（不打包） */');
  lines.push('  readonly url: string;');
  lines.push('  /** 来源方署名 —— 非空是硬要求 */');
  lines.push('  readonly credit: string;');
  lines.push('  /** 原始出处（与 url 相同；保留字段以便日后换成页面地址） */');
  lines.push('  readonly sourceUrl: string;');
  lines.push('}');
  lines.push('');
  if (revoked) {
    lines.push('/** 已于 `--revoke` 时清空；恢复用 `--restore` */');
  }
  lines.push('export const NIYIWEI_PHOTOS: readonly CampusPoiPhoto[] = [');
  for (const entry of entries) {
    lines.push('  {');
    lines.push(`    poiId: ${quote(entry.poiId)},`);
    lines.push(`    title: ${quote(entry.title)},`);
    lines.push(`    url: ${quote(entry.url)},`);
    lines.push(`    credit: ${quote(entry.credit)},`);
    lines.push(`    sourceUrl: ${quote(entry.sourceUrl)},`);
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');
  lines.push('/** 当前生效的照片：撤回后恒为空数组（调用方无需分支） */');
  lines.push('export function activeNiyiweiPhotos(): readonly CampusPoiPhoto[] {');
  lines.push('  return NIYIWEI_PHOTOS_ENABLED ? NIYIWEI_PHOTOS : [];');
  lines.push('}');
  lines.push('');
  lines.push('/** 某个 POI 的照片（撤回后为空） */');
  lines.push('export function niyiweiPhotosForPoi(poiId: string): readonly CampusPoiPhoto[] {');
  lines.push('  return activeNiyiweiPhotos().filter((photo) => photo.poiId === poiId);');
  lines.push('}');
  lines.push('');
  lines.push('/** 自检：返回问题列表（空数组 = 通过）。每条照片必须有非空署名。 */');
  lines.push('export function validateNiyiweiPhotos(): string[] {');
  lines.push('  const issues: string[] = [];');
  lines.push('  for (const photo of NIYIWEI_PHOTOS) {');
  lines.push("    if (photo.credit.trim() === '') issues.push(`${photo.url} 缺署名`);");
  lines.push(
    "    if (!photo.url.startsWith(NIYIWEI_PHOTO_ORIGIN + '/')) issues.push(`${photo.url} 不在授权域名`);",
  );
  lines.push('  }');
  lines.push('  return issues;');
  lines.push('}');
  lines.push('');
  return `${lines.join('\n')}`;
}

async function writeIfChanged(file, content) {
  let previous = null;
  try {
    previous = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (previous === content) return false;
  await writeFile(file, content, 'utf8');
  return true;
}

/* ------------------------------------------------------------------ *
 * 校验 / 下载
 * ------------------------------------------------------------------ */

async function checkPhotos(entries) {
  let total = 0;
  const failures = [];
  const concurrency = 6;

  for (let start = 0; start < entries.length; start += concurrency) {
    const batch = entries.slice(start, start + concurrency);
    const results = await Promise.all(
      batch.map(async (entry) => {
        try {
          const response = await fetch(entry.url, {
            method: 'HEAD',
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(20_000),
          });
          const size = Number(response.headers.get('content-length') ?? 0);
          return { entry, status: response.status, size: Number.isFinite(size) ? size : 0 };
        } catch (error) {
          return { entry, status: 0, size: 0, error: error.message };
        }
      }),
    );
    for (const result of results) {
      if (result.status === 200) total += result.size;
      else failures.push(result);
    }
  }

  console.log(
    `探测：${entries.length - failures.length}/${entries.length} 张可访问，共 ${(total / 1024 / 1024).toFixed(2)} MiB`,
  );
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`  ✗ ${failure.entry.url} → ${failure.status || failure.error}`);
    }
    throw new Error(`${failures.length} 张照片不可访问`);
  }
  return total;
}

async function downloadPhotos(entries, outDir) {
  await mkdir(outDir, { recursive: true });
  let downloaded = 0;
  let skipped = 0;
  let bytes = 0;
  const concurrency = 4;

  for (let start = 0; start < entries.length; start += concurrency) {
    const batch = entries.slice(start, start + concurrency);
    const results = await Promise.all(
      batch.map(async (entry) => {
        const response = await fetch(entry.url, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw new Error(`${entry.url} → HTTP ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        const digest = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
        const extension = path.extname(new URL(entry.url).pathname).toLowerCase() || '.jpg';
        const file = path.join(outDir, `${digest}${extension}`);

        try {
          await writeFile(file, buffer, { flag: 'wx' });
          return { created: true, size: buffer.length, file };
        } catch (error) {
          if (error.code === 'EEXIST') return { created: false, size: 0, file };
          throw error;
        }
      }),
    );
    for (const result of results) {
      if (result.created) {
        downloaded += 1;
        bytes += result.size;
      } else {
        skipped += 1;
      }
    }
  }

  console.log(
    `下载：新增 ${downloaded} 张（${(bytes / 1024 / 1024).toFixed(2)} MiB），已存在跳过 ${skipped} 张 → ${outDir}`,
  );
  console.log('提示：这些文件不参与打包（无 import、无 copy 规则），仅作离线归档。');
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (options.mode === 'revoke') {
    const content = renderManifest({ entries: [], enabled: false, revoked: true });
    const changed = options.dryRun ? true : await writeIfChanged(MANIFEST, content);
    console.log(
      changed
        ? '已下架：清单清空、NIYIWEI_PHOTOS_ENABLED = false（一条命令撤回完成）'
        : '已处于下架状态（无变化）',
    );
    return;
  }

  const { entries, skipped, canteenSource } = await fetchPhotoIndex();
  console.log(`来源：${canteenSource} + ${UNDERGROUND}`);
  console.log(`照片：${entries.length} 张，POI：${new Set(entries.map((e) => e.poiId)).size} 个`);
  if (skipped.length > 0) {
    console.warn(`跳过 ${skipped.length} 条非菜单/非车库路径：`);
    for (const reason of skipped.slice(0, 10)) console.warn(`  · ${reason}`);
    if (skipped.length > 10) console.warn(`  · ……其余 ${skipped.length - 10} 条省略`);
  }

  if (options.mode === 'check') {
    await checkPhotos(entries);
    return;
  }

  if (options.download) {
    await checkPhotos(entries);
    await downloadPhotos(entries, options.out);
  }

  if (options.dryRun) {
    for (const entry of entries) console.log(`${entry.poiId}\t${entry.url}`);
    console.log('（--dry-run：未写入 campusPoiPhotos.ts）');
    return;
  }

  const content = renderManifest({ entries, enabled: true, revoked: false });
  const changed = await writeIfChanged(MANIFEST, content);
  console.log(
    changed
      ? `已写入 ${path.relative(REPO_ROOT, MANIFEST)}（${entries.length} 张，全部带署名）`
      : `清单无变化：${path.relative(REPO_ROOT, MANIFEST)}`,
  );
}

main().catch((error) => {
  console.error(`\n失败：${error.message}`);
  process.exitCode = 1;
});
