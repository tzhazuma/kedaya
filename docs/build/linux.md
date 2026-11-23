# Linux 构建（x64 原生 / ARM64 交叉编译）

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

## 4. Linux ARM64：x64 主机交叉编译（3.35 起支持）

官方仍然**不发布 Linux ARM64 的 Flutter SDK**：`releases_linux.json` 里只有
`stable/linux/flutter_linux_3.35.1-stable.tar.xz`（`dart_sdk_arch: x64`）。但有两条
官方产物让交叉编译成立：

1. `packages/flutter_tools/lib/src/linux/build_linux.dart` 明确写着
   “Support cross-building for arm64 targets on x64 hosts”，`flutter build linux`
   接受 `--target-platform=linux-arm64` 与 `--target-sysroot`；
2. 引擎仓库里有 `linux-arm64-release/linux-arm64-flutter-gtk.zip`（arm64 的
   `libflutter_linux_gtk.so`）和 `linux-arm64/artifacts.zip`（arm64 的
   `gen_snapshot`、`flutter_tester` 等）。

第 2 条同时是坑：AOT 阶段要**执行** `gen_snapshot`，而它是 arm64 二进制，在 x64
runner 上会 `Exec format error`。所以 job 里装 `qemu-user-static`，并断言
`/proc/sys/fs/binfmt_misc/qemu-aarch64` 已注册（没有就直接失败，不产出假包）。

### 4.1 CI 做法（`mobile-build.yml` 的 `linux-arm64` job）

```text
ubuntu-24.04
├── dpkg --add-architecture arm64
├── 源拆两段：archive=amd64，ports=arm64（都写 Architectures:，否则 apt hash 不匹配）
├── clang/cmake/ninja + gcc-aarch64-linux-gnu + libc6-dev-arm64-cross
├── libgtk-3-dev:arm64 / libsecret-1-dev:arm64 / libjsoncpp-dev:arm64 / gstreamer:arm64
├── qemu-user-static + binfmt-support
├── PKG_CONFIG_LIBDIR=/usr/lib/aarch64-linux-gnu/pkgconfig（只读 arm64 的 .pc）
└── flutter build linux --release --target-platform=linux-arm64 --target-sysroot=/
```

产物路径是 `build/linux/arm64/release/bundle`。打包前会 `file` 校验 ELF 必须是
`ARM aarch64`，然后：

```bash
bash docs/build/linux/package-deb.sh   "$VERSION" apps/mobile/build/linux/arm64/release/bundle apps/mobile/build/artifacts arm64
# -> kedaya_0.1.0_arm64.deb 与 kedaya-0.1.0-linux-arm64.tar.gz
```

`package-deb.sh` 早就接受第二个架构参数（`amd64|arm64`），本次只是把它接进 CI。

### 4.2 本机复现（Linux x64 宿主）

```bash
sudo dpkg --add-architecture arm64
# 按 4.1 配好 amd64/arm64 分离的 apt 源
sudo apt install qemu-user-static binfmt-support gcc-aarch64-linux-gnu   libgtk-3-dev:arm64 libsecret-1-dev:arm64 libjsoncpp-dev:arm64
export PKG_CONFIG_LIBDIR=/usr/lib/aarch64-linux-gnu/pkgconfig:/usr/share/pkgconfig
cd apps/mobile
flutter build linux --release --target-platform=linux-arm64 --target-sysroot=/
```

**状态**：workflow 已写入并过了契约测试；首次 CI 实跑尚未完成，因此“产物可运行”
仍待 `linux-arm64` job 绿灯后再确认。若 GTK 的 multiarch 头文件解析失败，下一步是
用 `debootstrap` 生成独立的 arm64 sysroot，而不是放宽架构校验。

## 5. 已知限制

- 没有提交 `linux/` 原生目录；窗口标题、图标、桌面文件都是 `flutter create` 模板/脚本生成。
- 只验证构建路径，没有在真实桌面（X11/Wayland、NVIDIA/AMD/Intel）上跑过。
- 没有 AppImage / Flatpak / Snap；当前只发 tar.gz 与 deb。
- 没有签名/仓库元数据（`Release`/`InRelease`），不能直接当 apt 源。
- 音频依赖 GStreamer 插件；目标机缺 `gstreamer1.0-plugins-good` 等运行时插件时，
  `audioplayers` 可能无法播放。
- `flutter_secure_storage_linux` 依赖 Secret Service（GNOME Keyring/KWallet）；
  无 keyring 的裸机/容器里会失败，需要降级或提示用户。
