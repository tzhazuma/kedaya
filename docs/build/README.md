# 跨平台构建（Flutter 原生端）

> **范围声明**：根 `AGENTS.md` 把当前交付范围限定为**微信小程序、Web、NestJS API**。
> `apps/mobile` 的 Android / Windows / Linux / macOS / iOS / HarmonyOS 构建属于发布准备与预研，
> 不代表已经交付或在真机验证过。本目录只描述构建配置与打包方式，不修改业务代码。

> **提交注意**：根 `.gitignore` 的 `build/` 规则会匹配任意层级的 `build` 目录，
> 因此 `docs/build/` 默认被忽略。提交本目录时必须 `git add -f docs/build`
> （或由 Lead 在根 `.gitignore` 加 `!docs/build/`）。本次改动没有修改 `.gitignore`。

> **runner 核对日期：2026-11-22**。下表里的 runner 来自
> [actions/runner-images README](https://github.com/actions/runner-images#available-images)
> 与对应镜像 Readme，不是“以前能跑”的假设。GitHub Actions 已于 **2026-11-24** 实跑，
并创建 `mobile-v0.1.0`（见第 6 节）。

本目录回答三个问题：**能构建什么、产物是什么签名状态、哪些目标现在做不到**。
所有“未验证”的地方都明确写出，不把未跑过的 CI 说成已通过。

---

## 1. 支持矩阵

| 目标 | Workflow / job | Runner | 产物 | 当前状态 |
| --- | --- | --- | --- | --- |
| 质量门禁 | `mobile-build.yml` / `quality` | `ubuntu-latest` | 无（只跑检查） | **2026-11-24 实跑通过**（analyze + test 全绿） |
| Android APK | `mobile-build.yml` / `android` | `ubuntu-latest` | universal APK（release 构建，**debug 签名**） | 实跑通过，产物在 `mobile-v0.1.0` |
| Windows x64 | `mobile-build.yml` / `windows-x64` | **`windows-2022`** | 便携 zip + Inno Setup 安装器 | 实跑通过，zip/exe 在 `mobile-v0.1.0`；未做 Authenticode |
| Linux x64 | `mobile-build.yml` / `linux-x64` | `ubuntu-latest`（24.04） | tar.gz + `.deb` | 实跑通过，产物在 `mobile-v0.1.0` |
| macOS arm64 | `mobile-build.yml` / `macos` | **`macos-15`** | ad-hoc 签名 zip/dmg，**未 notarize** | 实跑通过，产物在 `mobile-v0.1.0` |
| iOS | `mobile-build.yml` / `ios` | **`macos-15`** | 未签名 `Runner.app` zip（不是 `.ipa`） | 实跑通过，产物在 `mobile-v0.1.0` |
| Windows ARM64 | `mobile-windows-arm64.yml` | `windows-11-vs2026-arm` | 便携 zip（实验性） | **实验**；仅手动、不进入 Release；已单独实跑过（PE32+ ARM64），不随 Release 产出 |
| Linux ARM64 | `mobile-build.yml` / `linux-arm64` | **`ubuntu-24.04-arm`**（原生 arm64） | tar.gz + `_arm64.deb` | **2026-11-24 实跑通过**，`file` 断言 aarch64，产物在 `mobile-v0.1.0` |
| HarmonyOS | `mobile-harmonyos.yml` | 自托管 `self-hosted, ohos`（Linux / Windows+DevEco） | `.hap`（签名取决于构建机） | **2026-11-24 本机产出未签名 HAP（24 MB, arm64-v8a）**；插件未登记、未签名 |
| 微信小程序 | 现有 `.github/workflows/ci.yml` | `ubuntu-latest` | `apps/miniapp/dist`（当前不上传 artifact） | **已存在**；本目录不重复实现 |

### 1.1 为什么是这些 runner

- **macOS**：`macos-14` 的全部镜像已于 **2026-11-02** 从 GitHub Actions 退役
  （[runner-images#15226](https://github.com/actions/runner-images/issues/15226)）。
  当前 arm64 托管镜像是 `macos-15` 与 `macos-26`；本项目选 `macos-15`，因为它默认带
  **Xcode 16.4**（16.0–16.4 都在镜像里），与 Flutter **3.35.1** 的 Xcode 16 基线一致。
  workflow 还会在默认 Xcode 不是 16.x 时显式切回已安装的 16.x，切不回去就失败。
- **Windows x64**：`windows-latest` 现在等价于 **`windows-2025-vs2026`**，带
  **Visual Studio 2026（major 18）**。Flutter 3.35.1 的 `visual_studio.dart` 只把
  major 17 映射为 `Visual Studio 17 2022`，其他 major 回退到 VS 2019 生成器，
  所以 3.35.1 在 VS 2026 上会失败。因此 x64 job **显式 pin `windows-2022`**，
  并在构建前用 `vswhere` 断言 major 是 17。要迁到 `windows-latest`，必须先升级
  Flutter 并完整适配 VS 2026，不能只改 runner 名字。
- **Windows ARM64**：官方 Windows 发布清单只有 **x64 Flutter SDK**（3.50.1 也是），
  没有 ARM64 SDK；`subosito/flutter-action` 装的是 x64 SDK，在 ARM64 Windows 上
  以 x64 仿真运行。3.50.1 支持 `FLUTTER_HOST_ARCH=arm64` 覆盖 hostPlatform，
  且 windows-arm64 engine 产物存在；但 `flutter build windows` **没有**
  `--target-platform` 选项。该路径未在 GitHub runner 实跑，只能算实验，
  不进入 Release。详见 [windows.md](windows.md)。
- **Linux ARM64**：官方仍不发布 Linux ARM64 的 Flutter **SDK 归档**，但
  `bin/internal/update_dart_sdk.sh` 会按 `uname -m=aarch64` 拉
  `dart-sdk-linux-arm64.zip`（该产物存在）。因此 job 跑在 **`ubuntu-24.04-arm`**
  上：解包官方 SDK → 删 `bin/cache` → 首次 `flutter` 自举成 arm64 工具链 →
  `flutter build linux --release`（默认目标就是 `linux-arm64`）。
  不再需要 multiarch、交叉 sysroot 或 qemu。详见 [linux.md](linux.md) 第 4 节。
- **HarmonyOS**：stock Flutter 没有 OHOS engine，必须 Flutter-OH（`oh-3.35.7-release`）
  + DevEco + 签名材料。SDK/engine 走华为 OBS 镜像 `FLUTTER_STORAGE_BASE_URL`。
  仓库没有自托管 runner，插件 OHOS 端口也还没落 `pubspec_overrides.yaml`，
  详见 [harmonyos.md](harmonyos.md)。

平台细节：

- [Android](android.md) · [Windows](windows.md) · [Linux](linux.md) ·
  [macOS / iOS](apple.md) · [HarmonyOS](harmonyos.md)
- 公共参数、版本号与产物命名：[mobile.md](mobile.md)

---

## 2. 触发方式（不会随 main 的每次 push 构建）

| Workflow | 触发 | Release |
| --- | --- | --- |
| `mobile-build.yml` | `workflow_dispatch`（可勾选目标）；push tag `mobile-v*` | 仅 tag 推送，或手动勾选 `publish_release=true` |
| `mobile-windows-arm64.yml` | 仅 `workflow_dispatch` | 不发布，只上传 7 天 artifact |
| `mobile-harmonyos.yml` | 仅 `workflow_dispatch`，且必须有自托管 runner | 不发布 |

`mobile-build.yml` 的手动开关默认：Android / Windows x64 / Linux x64 / macOS / iOS 全开，
`publish_release=false`、`prerelease=true`。macOS/iOS 会占用 macOS runner，按需取消。

Release 的 tag 约定是 **`mobile-v*`**（例如 `mobile-v0.1.0`），避免和 Web/API 的发版 tag 混在一起。
手动发布必须在 `release_tag` 里填 tag；不会自动拿分支名当 tag。

**Release 的依赖**：`quality` + 六个受支持构建 job（含 Linux ARM64）。Windows ARM64、HarmonyOS
都不在 `needs` 里，不会因为“实验/待接入”的平台阻断发布。某个构建 job 因输入未勾选
而 `skipped` 时不会阻断 Release；真正失败或被取消才会阻断。

---

## 3. 产物命名

| 平台 | 文件名 |
| --- | --- |
| Android | `kedaya-<version>-android-universal-debug-signed.apk` |
| Windows x64 | `kedaya-<version>-windows-x64-portable.zip`、`kedaya-<version>-windows-x64-setup.exe` |
| Linux x64 | `kedaya-<version>-linux-x64.tar.gz`、`kedaya_<version>_amd64.deb` |
| macOS arm64 | `kedaya-<version>-macos-arm64-unsigned.zip` / `.dmg` |
| iOS | `kedaya-<version>-ios-unsigned.zip` |
| Windows ARM64 | `kedaya-<version>-windows-arm64-portable-experimental.zip`（实验，不发布） |
| HarmonyOS | `kedaya-<version>-harmonyos-<mode>-unsigned.hap`（自托管，不发布） |

`<version>` 默认取 `apps/mobile/pubspec.yaml` 的 `version`（去掉 `+build`）；
tag 触发时取 tag 去掉 `mobile-v` 前缀。Release 资产额外包含 `SHA256SUMS.txt`。

**Release notes 只列本次实际下载到的 `dist/` 文件**：workflow 用 `find dist` 生成
`### Artifacts`，签名说明也按 `dist/*.apk`、`dist/*.exe`、`dist/*.dmg`、`dist/*ios*.zip`
是否存在条件输出。没有构建的平台不会出现在 notes 里。

---

## 4. 签名状态（先读再安装）

| 产物 | 现状 | 后果 |
| --- | --- | --- |
| Android APK | `apps/mobile/android/app/build.gradle.kts` 的 `release` 仍指向 `signingConfigs.debug` | 只能内测/侧载，**不能上架 Play**；升级安装可能与正式签名冲突 |
| Windows | 未做 Authenticode | SmartScreen 提示“未知发布者”；企业环境可能被拦截 |
| macOS | `codesign --sign -`（ad-hoc），未 notarize | 本机可运行；其他机器 Gatekeeper 拦截 |
| iOS | `--no-codesign` | 不是 `.ipa`，不能直接装到非越狱设备；需自行用证书重签 |
| HarmonyOS | workflow 不注入证书 | 未签名 HAP 通常无法安装 |

签名材料**不进仓库、不进 artifact、不在日志打印**。生产签名需要的环境变量与命令见各平台文档；
当前三个 mobile workflow **都不读取 `secrets.*`**（有契约测试守门）。

---

## 5. 质量门禁

`mobile-build.yml` 的 `quality` job 在 `ubuntu-latest` 上跑：

```bash
cd apps/mobile
flutter pub get --enforce-lockfile
flutter analyze
flutter test
```

- **analyze**：2026-10-19 的基线是 0 issue（`apps/mobile/README.md`）。
- **test**：README 记录全量 **680 例**（2026-10-19，679 通过 / 1 失败）。当时失败的是
  `test/presentation/kedaya_tokens_mirror_test.dart` 的 token 镜像 hash 断言。
  本次静态核对到镜像头 `source-blob-sha1` 已等于
  `git hash-object packages/design-tokens/tokens.json`（`03b0b267…`），
  `color` / `colorDark` 也都是 16 项；该失败**看起来已被并行修复**，但本机没有 Flutter，
  **没有重新执行** `flutter test`，以 CI 第一次运行为准。
- activities 相关有 7 个测试文件；静态 grep 到 129 个 `test`/`testWidgets` 声明
  （实际执行数以 `flutter test` 为准）。
- 当前仓库共 58 个 `*_test.dart` 文件（2026-11-22 静态计数；`apps/mobile/README.md`
  里的“46 个文件”是 2026-10 的旧数字，若 README 已更新以 README 为准）。

**门禁是阻断式的**：`quality` 失败时 `release` 不会运行。若基线测试本身有问题，
应先修测试或在 PR 里明确记录，不能靠跳过门禁发布。

---

## 6. 验证边界（如实说明）

这台开发机是 **Windows**：Git Bash + WSL（`gh` 在 WSL 的 zsh 里），**PATH 中没有 Flutter**。
所以“能不能构建”以 GitHub Actions 的实际结果为准：

**2026-11-24 实跑（run 45318778786）**

| job | 结果 |
| --- | --- |
| quality（analyze + test） | ✅ |
| android | ✅ |
| windows-x64（zip + Inno Setup exe） | ✅ |
| linux-x64（tar.gz + deb） | ✅ |
| linux-arm64（原生 arm64 runner） | ✅ `file` 断言 aarch64 |
| macos（zip + dmg，ad-hoc） | ✅ |
| ios（未签名 Runner.app zip） | ✅ |
| release | ✅ 创建 `mobile-v0.1.0`（prerelease），11 个资产 + `SHA256SUMS.txt` |

仍然**没有**做的：

- 本机 `flutter build *`（没有 Flutter SDK；Windows SDK 下载两次被网络截断）；
- 真实签名：Android 仍是 debug key、Windows 未 Authenticode、macOS 未 notarize、
  iOS 未签名、HAP 未签名；
- 真机安装与运行验证（Android/iOS/Windows/Linux/macOS 都没有实机冒烟记录）；
- HarmonyOS 签名与插件：本机已产出 unsigned HAP，但 `GeneratedPluginRegistrant` 为空、
  也没有 AGC 调试证书，见 [harmonyos.md](harmonyos.md) 第 6 节。

## 7. 相关文档

- 小程序构建与发布：`../../.github/workflows/ci.yml` 的 `miniapp` job、[`../deploy.md`](../deploy.md)
- 本地开发：`../local-development.md`
- Flutter 端能力与已知测试失败：`../../apps/mobile/README.md`
- 工程约束：`../../AGENTS.md`

---

## 8. 静态验证记录（2026-11-22）

在本机 Windows 上实际执行过的检查：

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| Workflow 契约测试 | `node --test docs/build/workflow-contract.test.mjs` | 18/18 通过（2026-11-24 复跑） |
| YAML 解析 | `npx prettier@3.9.10 --parser yaml <file>` | 3 个 workflow 全部通过 |
| Actions 静态检查 | `actionlint` v1.7.7（忽略两个真实 runner label 误报，见下） | 退出码 0 |
| Bash `run` 块语法 | 提取 35 个 Bash `run` 块后逐个 `bash -n` | 全部通过 |
| PowerShell `run` 块语法 | 提取 15 个 PowerShell `run` 块后逐个用 `[Parser]::ParseFile` | 全部通过 |
| deb 脚本 | `bash -n docs/build/linux/package-deb.sh`；再用 mock `dpkg-deb` 跑 amd64/arm64 | 通过；control/filename 正确，真实 `dpkg-deb` 未跑 |

两点说明：

- `actionlint` 1.7.7 内置的 runner 列表还不认识 `windows-11-vs2026-arm`（GitHub 托管
  ARM64 Windows + VS 2026）和自托管 label `ohos`。只对这两条用 `-ignore`，没有忽略其他告警：
  ```bash
  actionlint \
    -ignore 'label "windows-11-vs2026-arm" is unknown' \
    -ignore 'label "ohos" is unknown' \
    .github/workflows/mobile-build.yml \
    .github/workflows/mobile-windows-arm64.yml \
    .github/workflows/mobile-harmonyos.yml
  ```
- 没有在本机执行：`flutter pub get`、`flutter build *`、`flutter analyze`、`flutter test`、
  Inno Setup 编译、`dpkg-deb`。这些由 GitHub Actions 在 2026-11-24 实跑覆盖（第 6 节）；
  本机仍不能复现，不要把本机环境当成已验证。

---

## 9. Workflow 契约测试

[`workflow-contract.test.mjs`](workflow-contract.test.mjs) 用 Node 内置 test runner + `yaml`
解析三个 mobile workflow，守以下约定：

- `mobile-build.yml` 只允许 `workflow_dispatch` 与 `mobile-v*` tag，不允许 branch push；
- macOS/iOS 必须是 `macos-15`，Windows x64 必须是 `windows-2022`；
- 必须有 `quality` job，且 `release` 依赖它；
- `release` 不依赖 Windows ARM64 / HarmonyOS（Linux ARM64 已进入 `needs`）；
- release notes 从 `dist/` 实际文件生成，签名说明按产物条件输出；
- 三个 workflow 都不读取 `secrets.*`；
- `flutter create` 只在目标目录缺失时执行；
- Windows ARM64 必须手动、设置 `FLUTTER_HOST_ARCH=arm64`、不传 `--target-platform`、不发布；
- HarmonyOS 必须自托管、仅手动、不发布；
- `docs/build` 必须反映上述 runner、质量门禁和诚实状态。

运行（需要仓库根目录已有 `npm ci` 安装的 `yaml` 依赖）：

```bash
node --test docs/build/workflow-contract.test.mjs
```

这个测试只解析 YAML/文档文本，**不验证** runner 镜像里某个软件版本此刻是否仍然存在，
也不执行 GitHub Actions；镜像可用性仍需按第 1.1 节的链接人工核对。它目前是本地/
PR 前检查，没有塞进 `quality` job（那会为了一个 `yaml` 依赖在 CI 里额外跑 `npm ci`）。
