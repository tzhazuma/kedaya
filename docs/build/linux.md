# Linux 构建（x64 / ARM64 均原生）

Workflow：`.github/workflows/mobile-build.yml` 的 `linux-x64` job
Runner：`ubuntu-latest`（24.04）
产物：`kedaya-<version>-linux-x64.tar.gz`、`kedaya_<version>_amd64.deb`

质量门禁：同一 workflow 的 `quality` job 也在 `ubuntu-latest` 上跑
`flutter analyze` / `flutter test`（全量 680 例基线）；它与 Linux 构建 job 分开，
但 `release` 会等待它。Linux 构建 job 本身不跑 analyze/test。

---

## 1. 依赖

Flutter Linux 桌面需要 GTK 3 + CMake/Ninja/Clang；本项目插件还额外需要：

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  clang cmake ninja-build pkg-config libgtk-3-dev liblzma-dev \
  libsecret-1-dev libjsoncpp-dev \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
  librsvg2-bin
```

对应关系：

| 依赖 | 来源 |
| --- | --- |
| `libgtk-3-dev` | Flutter Linux embedder、`image_picker_linux`（file_selector） |
| `libsecret-1-dev` + `libjsoncpp-dev` | `flutter_secure_storage_linux` |
| `libgstreamer1.0-dev` + `plugins-base` | `audioplayers_linux` |
| `librsvg2-bin` | 可选：把 `assets/brand/kedaya-mascot.svg` 转成 deb 图标 |

CI 用的是同一份列表；如果新增插件，先看它的 Linux 构建文档再加包。

---

## 2. 构建

```bash
cd apps/mobile
flutter create --platforms=linux \
  --org cn.shanghaitech --project-name kedaya --no-pub .
flutter pub get --enforce-lockfile

flutter build linux --release \
  --dart-define=KEDAYA_FLAVOR=mock \
  --dart-define=KEDAYA_API_BASE_URL=https://api.kedaya.local
```

输出：

```text
build/linux/x64/release/bundle/kedaya
build/linux/x64/release/bundle/data/
build/linux/x64/release/bundle/lib/
```

运行：

```bash
./build/linux/x64/release/bundle/kedaya
```

最小运行库（目标机器没有开发包时）：

```bash
sudo apt-get install -y \
  libgtk-3-0 libsecret-1-0 libgstreamer1.0-0 \
  libgstreamer-plugins-base1.0-0
```

---

## 3. 打包

### 3.1 tar.gz（便携）

CI 把 bundle 复制成带版本号的目录再压缩：

```bash
bundle="build/linux/x64/release/bundle"
mkdir -p build/artifacts
rm -rf "build/artifacts/kedaya-${VERSION}-linux-x64"
cp -a "$bundle" "build/artifacts/kedaya-${VERSION}-linux-x64"
tar -C build/artifacts -czf \
  "build/artifacts/kedaya-${VERSION}-linux-x64.tar.gz" \
  "kedaya-${VERSION}-linux-x64"
```

用户解压后运行 `kedaya-<version>-linux-x64/kedaya`。

### 3.2 deb

脚本：[`linux/package-deb.sh`](linux/package-deb.sh)

```bash
bash docs/build/linux/package-deb.sh \
  0.1.0 \
  apps/mobile/build/linux/x64/release/bundle \
  apps/mobile/build/artifacts \
  amd64
# -> apps/mobile/build/artifacts/kedaya_0.1.0_amd64.deb
```

脚本做的事：

- 把 bundle 安装到 `/usr/lib/kedaya/`；
- 生成 `/usr/bin/kedaya` wrapper；
- 生成 `/usr/share/applications/kedaya.desktop`；
- 有 `rsvg-convert` 时把品牌 SVG 转成 256×256 图标；
- `DEBIAN/control`：`Package: kedaya`、`Architecture: $ARCH`、
  `Depends: libgtk-3-0 | libgtk-3-0t64, libsecret-1-0 | libsecret-1-0t64, libgstreamer1.0-0, ...`；
- `dpkg-deb --build --root-owner-group`。

安装/卸载：

```bash
sudo apt install ./kedaya_0.1.0_amd64.deb
sudo apt remove kedaya
```

**本机（Windows）没有 `dpkg-deb`，脚本只做了 `bash -n`，未实际构建过 `.deb`。**

---

## 4. Linux ARM64：原生 arm64 runner

官方仍然**不发布 Linux ARM64 的 Flutter SDK 归档**（`releases_linux.json` 里只有
`flutter_linux_3.35.1-stable.tar.xz`，`dart_sdk_arch: x64`），但 Flutter 的引导脚本
本身就支持 arm64 宿主：

- `bin/internal/update_dart_sdk.sh` 用 `uname -m` 判断架构，`aarch64` → `ARCH=arm64`，
  下载 `dart-sdk-linux-arm64.zip`（该文件在 `flutter_infra_release/flutter/<engine>/`
  下确实存在，HTTP 200 实测）；
- `packages/flutter_tools/lib/src/commands/build_linux.dart` 在
  `hostPlatform == linux_arm64` 时把 `--target-platform` 默认值设为 `linux-arm64`，
  并且 `needCrossBuild` 为 false，不需要 sysroot。

所以做法是：在 **`ubuntu-24.04-arm`** 托管 runner 上解包官方 x64 归档，删掉
`bin/cache`（里面是 x64 的 Dart SDK 与主机工具），让首次 `flutter` 运行按 aarch64
重新自举，然后正常 `flutter build linux --release`。

### 4.1 CI 做法（`mobile-build.yml` 的 `linux-arm64` job）

```text
ubuntu-24.04-arm                       # GitHub 公共仓库的 arm64 托管 runner（2025 GA）
├── curl 官方 flutter_linux_3.35.1-stable.tar.xz
├── tar 解包到 $HOME/flutter
├── rm -rf $HOME/flutter/bin/cache      # 关键：清掉 x64 Dart SDK
├── apt install clang cmake ninja libgtk-3-dev libsecret-1-dev ...
├── 断言 uname -m = aarch64
├── 断言 bin/cache/dart-sdk/bin/dart 是 ARM aarch64
└── flutter build linux --release       # 默认 linux-arm64，无需 --target-sysroot
```

产物在 `build/linux/arm64/release/bundle`；打包前 `file` 校验 ELF 必须是
`ARM aarch64`，然后 `package-deb.sh ... arm64` 出 `kedaya_<version>_arm64.deb`。

### 4.2 为什么不用交叉编译

3.35 的 `build_linux.dart` 确实支持 x64 主机交叉编译 arm64 目标，但实测有两个坑：

1. AOT 的 `gen_snapshot` 来自 `linux-arm64/artifacts.zip`，是 arm64 二进制，
   x64 主机必须装 `qemu-user-static` + binfmt 才能执行；
2. 交叉编译需要 arm64 的 GTK/libsecret 等开发包，只能走 Ubuntu ports 的
   `:arm64` multiarch，`apt` 在 GitHub runner 上多次因为镜像超时失败。

原生 arm64 runner 把这两件事都消掉了。交叉编译方案保留在历史记录里，
只有拿不到 arm64 runner 时才考虑。

**状态**：job 已改为原生 arm64 方案，等待首次 CI 实跑；产物可运行性以该 job 绿灯为准。

## 5. 已知限制

- 没有提交 `linux/` 原生目录；窗口标题、图标、桌面文件都是 `flutter create` 模板/脚本生成。
- 只验证构建路径，没有在真实桌面（X11/Wayland、NVIDIA/AMD/Intel）上跑过。
- 没有 AppImage / Flatpak / Snap；当前只发 tar.gz 与 deb。
- 没有签名/仓库元数据（`Release`/`InRelease`），不能直接当 apt 源。
- 音频依赖 GStreamer 插件；目标机缺 `gstreamer1.0-plugins-good` 等运行时插件时，
  `audioplayers` 可能无法播放。
- `flutter_secure_storage_linux` 依赖 Secret Service（GNOME Keyring/KWallet）；
  无 keyring 的裸机/容器里会失败，需要降级或提示用户。
