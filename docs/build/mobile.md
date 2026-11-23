# 移动端构建公共说明

本文件是各平台文档的公共部分：工具链版本、`--dart-define`、版本号、CI 流程与复现命令。
平台专属的安装器/签名/打包见 [Android](android.md)、[Windows](windows.md)、
[Linux](linux.md)、[macOS / iOS](apple.md)、[HarmonyOS](harmonyos.md)。

---

## 1. 工具链固定点

| 项 | 值 | 依据 |
| --- | --- | --- |
| Flutter | **3.35.1 stable** | `apps/mobile/.metadata` revision `20f82749394e68bcfbbeee96bad384abaae09c13`；`apps/mobile/README.md` 记录本机验证版本 |
| Dart | 3.9.0（随 Flutter 3.35.1） | 同上 |
| Dart SDK 约束 | `>=3.6.2 <4.0.0` | `apps/mobile/pubspec.yaml` |
| Java（Android） | Temurin **17** | AGP 8.9.1 / Gradle 8.12；Flutter 3.35 要求 JDK 17+ |
| Android Gradle Plugin | 8.9.1 | `apps/mobile/android/settings.gradle.kts` |
| Gradle | 8.12 | `apps/mobile/android/gradle/wrapper/gradle-wrapper.properties` |

### 1.1 CI runner 固定点（2026-11-22 核对）

| Job | Runner | 依据 |
| --- | --- | --- |
| `quality` / `android` / `linux-x64` | `ubuntu-latest`（24.04） | GitHub 当前 `latest` |
| `windows-x64` | **`windows-2022`** | `windows-latest` 现在等于 `windows-2025-vs2026`（VS 2026 / major 18）；Flutter 3.35.1 只把 major 17 映射为 VS 2022 生成器 |
| `macos` / `ios` | **`macos-15`** | `macos-14` 已于 2026-11-02 退役；`macos-15` 默认 Xcode 16.4（16.0–16.4 均在镜像里） |
| `windows-arm64`（实验） | `windows-11-vs2026-arm` | 仅手动、实验、不发布；见 [windows.md](windows.md) |
| `harmonyos` | `self-hosted, linux, ohos` | 自托管；未验证；见 [harmonyos.md](harmonyos.md) |

runner 可用性来自
[actions/runner-images README](https://github.com/actions/runner-images#available-images)；
CI **尚未在 GitHub 实跑**。

**不要**在 `mobile-build.yml` 里随手升级 Flutter：`apps/mobile/README.md` 的 API 面
（Riverpod 2.6、go_router 14、Flutter 3.27 时代的 `CardThemeData` / `RadioListTile` 等）
是按 3.35.1 写的。升级工具链应当单独开 PR 并跑 `flutter analyze` / `flutter test`。

> Windows ARM64 是唯一例外：`mobile-windows-arm64.yml` 用 **3.50.1**，原因见
> [windows.md](windows.md)。它只产出实验性 portable zip，**不进入默认产物与 Release**。
> 官方没有 Windows ARM64 Flutter SDK，workflow 用 x64 SDK + `FLUTTER_HOST_ARCH=arm64`
> 驱动 windows-arm64 目标；`flutter build windows` **没有** `--target-platform` 选项。

---

## 2. 原生工程目录为什么在 CI 里生成

仓库当前只提交了 `apps/mobile/android/`（而且 `gradlew`、`gradle-wrapper.jar` 被 Flutter
模板的 `.gitignore` 忽略，由 Flutter 工具在构建时补齐）。`windows/`、`linux/`、`macos/`、
`ios/`、`ohos/` 都**不存在**。

因此每个 job 在 `flutter pub get` 之前，**只在目标目录缺失时**执行一次：

```bash
if [ ! -d <target> ]; then
  flutter create --platforms=<target> \
    --org cn.shanghaitech \
    --project-name kedaya \
    --no-pub .
fi
```

- `--org cn.shanghaitech` + `--project-name kedaya` → bundle/application id
  `cn.shanghaitech.kedaya`，和现有 Android `applicationId` 一致。
- `--no-pub` 避免和后面的 `flutter pub get --enforce-lockfile` 重复。
- **已有平台目录不会被碰**：例如 `android/` 已经提交（且包含国内 Maven 镜像配置），
  CI 直接用它；将来有人提交 `windows/` 等目录时同理。这样不会覆盖签名、镜像、
  权限或原生代码。
- 生成物只存在于 CI 工作区，不会回写仓库。如果目录缺失但生成失败，job 会直接失败，
  不会悄悄产出一个没有原生工程的“成功”包。

**这不等同于“原生工程已完成”**。窗口标题、图标、权限、签名、深链、原生插件注册等
仍需要各端负责人提交真正的平台目录；当前 CI 只是让构建可重复。

---

## 3. `--dart-define` 与仓库变量

`apps/mobile/lib/app/app_environment.dart` 读取：

| 变量 | 未设置时 | CI 默认 |
| --- | --- | --- |
| `KEDAYA_FLAVOR` | `mock` | `${{ vars.KEDAYA_FLAVOR || 'mock' }}` |
| `KEDAYA_API_BASE_URL` | 按 flavor 取内置占位域名 | `${{ vars.KEDAYA_API_BASE_URL || 'https://api.kedaya.local' }}` |

默认 **mock** 是有意的：`prodBaseUrl` 还是占位域名 `https://api.kedaya.local`，
如果 CI 默认打 `prod`，产物能启动但所有请求都会失败。等 Lead 提供真实 API 域名后，
在仓库 **Settings → Variables** 配置 `KEDAYA_FLAVOR=prod` 与
`KEDAYA_API_BASE_URL=https://<real-host>`，**不需要改 workflow**。

这些是 `vars` 不是 `secrets`：域名会出现在产物里，不应视为秘密。

---

## 4. 版本号与 Release

CI 的版本号规则：

```bash
version="$(awk '/^version:/{print $2; exit}' apps/mobile/pubspec.yaml)"
version="${version%%+*}"                 # 0.1.0+1 -> 0.1.0
# tag 触发时：mobile-v0.1.0 -> 0.1.0
```

所有平台都传 `--build-name="$VERSION" --build-number="$BUILD_NUMBER"`，其中
`BUILD_NUMBER = GITHUB_RUN_NUMBER * 100 + GITHUB_RUN_ATTEMPT`，保证 rerun 也不会
产生重复的构建号。Flutter 3.35.1 的 `addCommonDesktopBuildOptions` 已包含这两个选项
（Windows/Linux/macOS 同样接受）；Android 的 `versionCode` 直接用它。

Release 规则：

- **只**在 push tag `mobile-v*`，或手动 `publish_release=true` 时创建/更新；
- 手动发布必须填 `release_tag`，否则 job 直接失败并给出 `::error::`；
- 默认 `prerelease=true`：当前产物是 debug/未签名状态，不应伪装成正式版；
- Release notes 固定写明签名状态，资产附 `SHA256SUMS.txt`；
- 已存在的 Release 用 `gh release upload --clobber` 覆盖同名资产，不删除其他资产。

---

## 5. CI 每个 job 的实际步骤

### 5.1 quality（`ubuntu-latest`）

1. `actions/checkout@v4`
2. `subosito/flutter-action@v2`，`flutter-version: 3.35.1`，`cache: true`
3. `flutter pub get --enforce-lockfile`
4. `flutter analyze`
5. `flutter test`

这是**阻断式**门禁：`release` 的 `needs` 包含 `quality`，检查红就不发布。
全量测试基线是 **680 例**（`apps/mobile/README.md` 2026-10-19 记录）。
当时失败的 token 镜像 hash 断言本次已静态核对为一致
（`source-blob-sha1` = `git hash-object packages/design-tokens/tokens.json`），
但本机没有 Flutter，**没有重新执行**；以 CI 第一次运行为准。

### 5.2 构建 job

以 Android 为例（其余平台只换 build/package 命令）：

1. `actions/checkout@v4`
2. `actions/setup-java@v4`（仅 Android，Temurin 17）
3. `subosito/flutter-action@v2`，`flutter-version: 3.35.1`，`cache: true`
4. 平台工具链断言：Windows x64 用 `vswhere` 断言 VS major 17；macOS/iOS 选择并断言 Xcode 16.x
5. 计算 `VERSION` 并写入 `$GITHUB_ENV`
6. `flutter create --platforms=... --no-pub .`（仅在目标目录缺失时）
7. `flutter pub get --enforce-lockfile`
8. `flutter build ... --release --dart-define=...`
9. 复制/打包到 `apps/mobile/build/artifacts/`
10. `actions/upload-artifact@v4`（`if-no-files-found: error`）

---

## 6. 本地复现

需要 Flutter 3.35.1 与对应平台工具链。命令都在 `apps/mobile` 下执行：

```bash
cd apps/mobile
flutter --version                 # 应为 3.35.1 / Dart 3.9.0

# 只补齐缺失的平台目录；已有目录（尤其 android/）不要重新生成
for target in android windows linux macos ios; do
  if [ ! -d "$target" ]; then
    flutter create --platforms="$target" \
      --org cn.shanghaitech --project-name kedaya --no-pub .
  fi
done
flutter pub get --enforce-lockfile

# 质量门禁（CI 的 quality job 同款）
flutter analyze
flutter test

# Android（需要 JDK 17 + Android SDK）
flutter build apk --release \
  --build-name=0.1.0 --build-number=1 \
  --dart-define=KEDAYA_FLAVOR=mock \
  --dart-define=KEDAYA_API_BASE_URL=https://api.kedaya.local

# Windows x64（需要 VS 2022 / major 17，“使用 C++ 的桌面开发”；
# VS 2026 不被 Flutter 3.35.1 支持）
flutter build windows --release \
  --dart-define=KEDAYA_FLAVOR=mock \
  --dart-define=KEDAYA_API_BASE_URL=https://api.kedaya.local

# Linux x64（依赖见 linux.md）
flutter build linux --release \
  --dart-define=KEDAYA_FLAVOR=mock \
  --dart-define=KEDAYA_API_BASE_URL=https://api.kedaya.local
```

macOS/iOS 本机需要 **Xcode 16.x**（`xcodebuild -version` 应为 `Xcode 16.`）；
Flutter 3.35.1 未验证 Xcode 26。CI 在 `macos-15` 上会显式选择/断言 Xcode 16.x。

本机没有 Flutter 时，唯一能做的静态检查：

```bash
# YAML 语法 + GitHub Actions 表达式/上下文
actionlint .github/workflows/mobile-build.yml \
           .github/workflows/mobile-windows-arm64.yml \
           .github/workflows/mobile-harmonyos.yml

# 打包脚本语法
bash -n docs/build/linux/package-deb.sh
```

`actionlint` 不验证 runner 是否真的可用、Flutter 版本是否存在、Inno/deb 是否能构建；
这些只能在 CI 或对应平台机器上验证。

---

## 7. 首次运行 CI 的检查清单

1. **Android**：`flutter create` 后 `android/app/build.gradle.kts` 是否仍是原来的
   debug 签名配置（如果不是，说明模板覆盖了文件，需要人工确认）。
2. **Windows**：`vswhere` 断言是否通过（major 必须是 17 / VS 2022）；日志里 `ISCC`
   是否找到 `Inno Setup 6`；`SetupIconFile` 不存在时脚本会跳过图标而不是编译失败。
3. **Linux**：`libsecret-1-dev` / `libjsoncpp-dev` / GStreamer 开发包是否都能安装；
   `dpkg-deb --root-owner-group` 在 `ubuntu-latest`（24.04）可用。
4. **macOS/iOS**：`macos-15` 的默认 Xcode 是否仍是 16.x；workflow 会在不是 16.x 时
   切到已安装的 `Xcode_16*.app`，切不回去会明确失败。Flutter 3.35.1 未验证 Xcode 26。
5. **Release**：tag 是否为 `mobile-v*`；手动发布是否填了 `release_tag`；
   `contents: write` 是否被组织策略允许。

---

## 8. 未解决 / 后续

- **质量门禁首次实跑**：`quality` job 已配置，但本机没有 Flutter，未执行
  `flutter analyze` / `flutter test`；token 镜像 hash 已静态核对一致，仍需 CI 确认
  680 例全绿。
- **Windows ARM64 实验**：没有官方 ARM64 SDK，x64 SDK + `FLUTTER_HOST_ARCH=arm64`
  未在 GitHub runner 实跑；不进入 release，失败时不要把它当正式产物。
- **runner 退役**：`macos-15`、`windows-2022` 也会随 runner-images 退役；升级前先查
  actions/runner-images，再改 workflow。
- Android 正式签名：需要改 `android/app/build.gradle.kts`（不在本次改动范围），
  并用 CI secret 注入 keystore；详见 [android.md](android.md)。
- Windows Authenticode、macOS Developer ID/notarization、iOS 证书：
  当前 workflow 不接收签名材料；详见各平台文档。
- Linux ARM64：官方 SDK 仍缺失，但 3.35 支持 x64 主机交叉编译 arm64；CI 用 qemu 跑 arm64 `gen_snapshot`，见 [linux.md](linux.md) 第 4 节。
- HarmonyOS：OHOS 插件替换与签名未完成，见 [harmonyos.md](harmonyos.md)。
- 原生工程目录（窗口/图标/权限/深链）仍需各端负责人提交，CI 的 `flutter create`
  只是构建兜底。
- 平台通道（`kedaya/location`、`kedaya/unified_identity`、`kedaya/webview`）的原生侧
  尚未实现（见 `apps/mobile/README.md`）；桌面/移动包可以构建，但相关功能会走降级路径，
  这不是构建失败。
