#!/usr/bin/env node
/**
 * 下载朗读模型 `vits-piper-zh_CN-xiao_ya-medium`（约 58 MB 压缩 / 60 MB ONNX）。
 *
 * ## 为什么不把模型提交进仓库
 *
 * 60 MB 的二进制进 git 会：
 * 1. 让每次 clone 都多拉 60 MB（历史里还会一直留着）
 * 2. 超过 GitHub 建议的单文件大小
 * 3. 与「代码仓库」的职责不符 —— 模型是**部署产物**，不是源码
 *
 * 所以：仓库只放这个下载脚本，模型由部署时拉取。
 *
 * ## 用法
 *
 * ```bash
 * node tools/fetch-tts-model.mjs            # 下载到 services/api/models/
 * node tools/fetch-tts-model.mjs --check    # 只检查是否已就位（CI 用）
 * node tools/fetch-tts-model.mjs --force    # 重新下载
 * ```
 *
 * 退出码：0 = 就位；1 = 失败/缺失。
 */
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const MODELS_DIR = join(REPO_ROOT, 'services', 'api', 'models');
const MODEL_NAME = 'vits-piper-zh_CN-xiao_ya-medium';
const TARGET = join(MODELS_DIR, MODEL_NAME);

const URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-zh_CN-xiao_ya-medium.tar.bz2';

/** 少任何一个都算没装 */
const REQUIRED = ['zh_CN-xiao_ya-medium.onnx', 'tokens.txt', 'lexicon.txt'];

/** 可选但建议有：没有它们数字/日期会读错 */
const OPTIONAL = ['phone.fst', 'date.fst', 'number.fst'];

const args = new Set(process.argv.slice(2));

function installed() {
  return REQUIRED.every((f) => existsSync(join(TARGET, f)));
}

function report() {
  if (!installed()) {
    console.log(`  ❌ 模型未就位: ${TARGET}`);
    return false;
  }
  const onnx = join(TARGET, 'zh_CN-xiao_ya-medium.onnx');
  const mb = (statSync(onnx).size / 1024 / 1024).toFixed(1);
  console.log(`  ✅ 模型已就位: ${TARGET}`);
  console.log(`     onnx ${mb} MB`);
  const missingFst = OPTIONAL.filter((f) => !existsSync(join(TARGET, f)));
  if (missingFst.length > 0) {
    console.log(`     ⚠️ 缺少 rule FST: ${missingFst.join(', ')}（数字/日期会读错）`);
  } else {
    console.log(`     rule FST ${OPTIONAL.length} 个齐全`);
  }
  return true;
}

if (args.has('--check')) {
  process.exit(report() ? 0 : 1);
}

if (installed() && !args.has('--force')) {
  console.log('模型已存在，跳过下载（要重新下载用 --force）');
  report();
  process.exit(0);
}

if (args.has('--force') && existsSync(TARGET)) {
  console.log('--force：删除已有模型目录');
  rmSync(TARGET, { recursive: true, force: true });
}

mkdirSync(MODELS_DIR, { recursive: true });
const tarball = join(MODELS_DIR, `${MODEL_NAME}.tar.bz2`);

console.log(`下载模型（约 58 MB）…`);
console.log(`  ${URL}`);

const res = await fetch(URL, { redirect: 'follow' });
if (!res.ok) {
  console.error(`  ❌ 下载失败: HTTP ${res.status} ${res.statusText}`);
  process.exit(1);
}

const total = Number(res.headers.get('content-length') ?? 0);
let received = 0;
let lastPct = -1;

await pipeline(
  Readable.fromWeb(res.body),
  async function* (source) {
    for await (const chunk of source) {
      received += chunk.length;
      if (total > 0) {
        const pct = Math.floor((received / total) * 100);
        // 每 10% 报一次，避免刷屏
        if (pct >= lastPct + 10) {
          lastPct = pct;
          console.log(`  ${pct}%  (${(received / 1024 / 1024).toFixed(1)} MB)`);
        }
      }
      yield chunk;
    }
  },
  createWriteStream(tarball),
);

console.log(`解压…`);
try {
  // tar 在所有目标平台（macOS/Linux/Windows10+）都有
  execFileSync('tar', ['xjf', tarball, '-C', MODELS_DIR], { stdio: 'inherit' });
} catch (error) {
  console.error(`  ❌ 解压失败: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

rmSync(tarball, { force: true });

if (!report()) {
  console.error('  ❌ 解压后仍缺少必需文件，请检查压缩包内容');
  process.exit(1);
}
console.log('\n完成。启动 API 后朗读接口即可用。');
