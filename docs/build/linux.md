# Linux 构建（x64 正式 / ARM64 未实现）

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

## 4. Linux ARM64：现在为什么没有产物

这不是“忘了做”，而是工具链不支持：

1. Flutter 3.35.1 的 `build linux` 允许的目标只有 `linux-arm64` / `linux-x64`，
   但明确拒绝从 x64 宿主交叉编译到 ARM64：

   ```text
   Cross-build from Linux x64 host to linux-arm64 target is not currently supported.
   ```

2. 官方 Flutter Linux SDK 归档只有 x64：
   `stable/linux/flutter_linux_3.35.1-stable.tar.xz`，没有 `linux-arm64` 版本。
   在 `ubuntu-24.04-arm` 上装 x64 SDK 只能走仿真，`hostPlatform` 仍是 `linux_x64`，
   于是又回到上面的交叉编译拒绝。

3. GitHub 确实有 `ubuntu-24.04-arm` runner，但没有可用的官方 ARM64 Flutter SDK，
   所以 workflow 不会生成一个假的 “linux-arm64” 包。

### 4.1 将来可行的路径（需要 ARM64 宿主的 Flutter SDK）

如果拿到 ARM64 Flutter SDK（官方后续提供，或社区构建/自行编译 engine），
在 **ARM64 Linux 主机**上：

```bash
flutter --version          # 必须是 linux-arm64 宿主
cd apps/mobile
flutter create --platforms=linux --org cn.shanghaitech --project-name kedaya --no-pub .
flutter pub get --enforce-lockfile
flutter build linux --release \
  --dart-define=KEDAYA_FLAVOR=mock \
  --dart-define=KEDAYA_API_BASE_URL=https://api.kedaya.local
# 输出 build/linux/arm64/release/bundle
```

`package-deb.sh` 已支持第二个架构参数：

```bash
bash docs/build/linux/package-deb.sh \
  0.1.0 \
  apps/mobile/build/linux/arm64/release/bundle \
  apps/mobile/build/artifacts \
  arm64
# -> kedaya_0.1.0_arm64.deb
```

在官方 SDK 到位前，**不要**在 CI 里用 `--target-platform linux-arm64` 或
`dpkg --add-architecture` 拼一个跑不起来的包。

---

## 5. 已知限制

- 没有提交 `linux/` 原生目录；窗口标题、图标、桌面文件都是 `flutter create` 模板/脚本生成。
- 只验证构建路径，没有在真实桌面（X11/Wayland、NVIDIA/AMD/Intel）上跑过。
- 没有 AppImage / Flatpak / Snap；当前只发 tar.gz 与 deb。
- 没有签名/仓库元数据（`Release`/`InRelease`），不能直接当 apt 源。
- 音频依赖 GStreamer 插件；目标机缺 `gstreamer1.0-plugins-good` 等运行时插件时，
  `audioplayers` 可能无法播放。
- `flutter_secure_storage_linux` 依赖 Secret Service（GNOME Keyring/KWallet）；
  无 keyring 的裸机/容器里会失败，需要降级或提示用户。
