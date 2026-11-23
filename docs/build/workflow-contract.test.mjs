// 移动端 workflow / 构建文档的契约测试。
//
// 目的：把“runner 必须当前可用、发布只依赖真实支持的平台、release notes 只列
// 实际产物、原生目录不被覆盖、质量门禁存在”这些容易在 YAML 里回退的约定
// 固化成可执行断言。
//
// 运行：node --test docs/build/workflow-contract.test.mjs
//
// 注意：本测试只解析 YAML 与文档文本，不执行 GitHub Actions，也不验证
// runner 镜像里某个软件版本此刻是否仍然存在；镜像可用性由文档中的
// actions/runner-images 链接与人工核对负责。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const readWorkflow = (name) =>
  parse(readFileSync(join(repoRoot, '.github', 'workflows', name), 'utf8'));

const readDoc = (name) => readFileSync(join(repoRoot, 'docs', 'build', name), 'utf8');

const build = readWorkflow('mobile-build.yml');
const windowsArm64 = readWorkflow('mobile-windows-arm64.yml');
const harmony = readWorkflow('mobile-harmonyos.yml');

const runBlocks = (job) =>
  (job.steps ?? [])
    .filter((step) => typeof step.run === 'string')
    .map((step) => step.run)
    .join('\n');

test('mobile-build 只允许手动或 mobile-v* tag 触发', () => {
  assert.deepEqual(Object.keys(build.on).sort(), ['push', 'workflow_dispatch']);
  assert.deepEqual(build.on.push, { tags: ['mobile-v*'] });
  assert.equal(build.on.push.branches, undefined);
  assert.equal(build.on.workflow_dispatch.inputs.publish_release.default, false);
  assert.equal(build.on.workflow_dispatch.inputs.prerelease.default, true);
});

test('macOS/iOS 使用 macos-15：macos-14 已于 2026-11-02 退役', () => {
  assert.equal(build.jobs.macos['runs-on'], 'macos-15');
  assert.equal(build.jobs.ios['runs-on'], 'macos-15');

  const runners = Object.values(build.jobs).map((job) => job['runs-on']);
  assert.ok(!runners.includes('macos-14'), '不得继续使用已退役的 macos-14');
});

test('Windows x64 pin windows-2022：windows-latest 现在是 VS 2026 镜像', () => {
  assert.equal(build.jobs['windows-x64']['runs-on'], 'windows-2022');

  const runners = Object.values(build.jobs).map((job) => job['runs-on']);
  assert.ok(!runners.includes('windows-latest'), '不得假设 windows-latest 仍是 VS 2022');
});

test('新增 Flutter analyze/test 质量门禁，并进入 release needs', () => {
  const quality = build.jobs.quality;
  assert.ok(quality, '必须新增 quality job');
  assert.equal(quality['runs-on'], 'ubuntu-latest');

  const runs = runBlocks(quality);
  assert.match(runs, /flutter analyze/);
  assert.match(runs, /flutter test/);
  assert.ok(build.jobs.release.needs.includes('quality'), 'release 必须等待质量门禁');
});

test('release 只依赖受支持平台，不被未实现平台阻断', () => {
  const needs = build.jobs.release.needs;
  for (const required of ['android', 'windows-x64', 'linux-x64', 'macos', 'ios', 'quality']) {
    assert.ok(needs.includes(required), `release 应依赖 ${required}`);
  }
  for (const unsupported of ['windows-arm64', 'harmonyos', 'linux-arm64']) {
    assert.ok(!needs.includes(unsupported), `release 不应依赖未支持的 ${unsupported}`);
  }

  assert.match(build.jobs.release.if, /startsWith\(github\.ref, 'refs\/tags\/mobile-v'\)/);
  assert.match(build.jobs.release.if, /inputs\.publish_release == true/);
});

test('release notes 从实际 dist 产物生成，不静态罗列未构建平台', () => {
  const step = build.jobs.release.steps.find(
    (candidate) => typeof candidate.run === 'string' && candidate.run.includes('release-notes.md'),
  );
  assert.ok(step, '必须找到生成 release-notes.md 的步骤');

  assert.match(step.run, /### Artifacts/);
  assert.match(step.run, /find dist -maxdepth 1 -type f/);
  assert.match(step.run, /SHA256SUMS\.txt/);

  // 签名说明按实际产物条件输出，而不是无条件写死四平台。
  assert.match(step.run, /dist\/\*\.apk/);
  assert.match(step.run, /dist\/\*\.exe/);
  assert.match(step.run, /dist\/\*\.dmg/);
  assert.match(step.run, /dist\/\*ios\*\.zip/);
  assert.match(step.run, /if \[ \$\{#ios_zips\[@\]\} -gt 0 \]/);
  assert.match(step.run, /if \[ \$\{#apks\[@\]\} -gt 0 \]/);
});

test('workflow 不读取 secrets，权限保持最小', () => {
  for (const name of ['mobile-build.yml', 'mobile-windows-arm64.yml', 'mobile-harmonyos.yml']) {
    const text = readFileSync(join(repoRoot, '.github', 'workflows', name), 'utf8');
    assert.doesNotMatch(text, /\bsecrets\./, `${name} 不得读取 secrets`);
  }

  assert.equal(build.permissions.contents, 'read');
  assert.equal(build.jobs.release.permissions.contents, 'write');
  assert.equal(windowsArm64.permissions.contents, 'read');
  assert.equal(harmony.permissions.contents, 'read');
});

test('原生目录只在缺失时生成，不覆盖已提交工程', () => {
  const steps = Object.values(build.jobs).flatMap((job) => job.steps ?? []);
  const creates = steps.filter(
    (step) => typeof step.run === 'string' && /flutter create --platforms/.test(step.run),
  );

  assert.ok(creates.length >= 5, '每个平台都应有条件生成原生脚手架的步骤');
  for (const step of creates) {
    assert.match(
      step.run,
      /! -d |Test-Path/,
      `flutter create 必须有目录存在性守卫：${step.name}`,
    );
  }
});

test('Windows ARM64 是实验能力：手动、不发布、强制 ARM64 宿主与目标', () => {
  assert.deepEqual(Object.keys(windowsArm64.on), ['workflow_dispatch']);
  assert.equal(windowsArm64.env.FLUTTER_VERSION, '3.50.1');
  assert.equal(windowsArm64.env.FLUTTER_HOST_ARCH, 'arm64');

  const job = windowsArm64.jobs['windows-arm64'];
  assert.equal(job['runs-on'], 'windows-11-vs2026-arm');

  const runs = runBlocks(job);
  assert.match(runs, /OSArchitecture/);
  assert.match(runs, /0xAA64/);
  assert.doesNotMatch(runs, /--target-platform/, 'flutter build windows 没有 --target-platform 选项');
  assert.equal(windowsArm64.jobs.release, undefined, 'ARM64 实验产物不进入 release');
});

test('HarmonyOS 保持自托管、仅手动、未验证', () => {
  assert.deepEqual(Object.keys(harmony.on), ['workflow_dispatch']);
  assert.deepEqual(harmony.jobs.harmonyos['runs-on'], ['self-hosted', 'linux', 'ohos']);
  assert.equal(harmony.jobs.release, undefined);
});

test('docs/build 反映新 runner、质量门禁与诚实状态', () => {
  const readme = readDoc('README.md');
  assert.match(readme, /macos-15/);
  assert.match(readme, /windows-2022/);
  assert.match(readme, /flutter analyze/);
  assert.match(readme, /flutter test/);
  assert.match(readme, /Linux ARM64/);
  assert.match(readme, /未实现/);
  assert.match(readme, /Windows ARM64/);
  assert.match(readme, /实验/);
  assert.match(readme, /680/);

  const apple = readDoc('apple.md');
  assert.match(apple, /macos-15/);
  assert.doesNotMatch(apple, /Runner：`macos-14`/);

  const windows = readDoc('windows.md');
  assert.match(windows, /windows-2022/);
  assert.match(windows, /FLUTTER_HOST_ARCH/);
  assert.match(windows, /没有.*--target-platform|不是.*--target-platform/);
  assert.match(windows, /实验/);

  const mobile = readDoc('mobile.md');
  assert.match(mobile, /flutter analyze/);
  assert.match(mobile, /flutter test/);
  assert.match(mobile, /680/);
});


test('macOS/iOS 先捕获完整 xcodebuild 输出，避免 grep -q 造成 Broken pipe', () => {
  for (const job of [build.jobs.macos, build.jobs.ios]) {
    const source = runBlocks(job);
    assert.doesNotMatch(source, /xcodebuild -version \| grep -q/);
    assert.match(source, /xcode_version="\$\(xcodebuild -version\)"/);
  }
});

test('Linux Clang 不把旧 nlohmann/json 的 literal operator 警告升级为错误', () => {
  const cmake = readFileSync(join(repoRoot, 'apps/mobile/linux/CMakeLists.txt'), 'utf8');
  assert.match(cmake, /-Wno-error=deprecated-literal-operator/);
});
