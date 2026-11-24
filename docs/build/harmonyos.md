# HarmonyOS（鸿蒙）构建

Workflow：`.github/workflows/mobile-harmonyos.yml`
Runner：**自托管** `[self-hosted, ohos]`（Linux 或 Windows + DevEco 都可以）
产物：`kedaya-<version>-harmonyos-<mode>-unsigned.hap`

**状态**：思路与命令已固定到 Flutter-OH **3.35.7**（与本项目的 Flutter 3.35 基线对齐），
但**本机没有产出 HAP**——原因见第 6 节（网络下载受限）。因此这里写的是“已验证到哪一步”，
不是“鸿蒙已发布”。

---

## 1. 为什么必须是 Flutter-OH

stock Flutter 没有 OHOS engine，`flutter build hap` 只在 **Flutter-OH** 里存在。
2025 年之后 OpenHarmony 侧的 Flutter 仓库搬到了新地址，当前可用的是：

| 项 | 值 |
| --- | --- |
| SDK 仓库 | `https://atomgit.com/openharmony-tpc/flutter_flutter`（GitCode 镜像 `https://gitcode.com/openharmony-sig/flutter_flutter`） |
| 对应本项目基线的分支 | **`oh-3.35.7-release`**（另有 `oh-3.35.7-dev`） |
| 更新的分支（未采用） | `oh-3.41.9-*`、`oh-3.44.9-*`、`oh-3.47.7-*`、`oh-3.50.0-preview` |
| Dart SDK / engine 镜像 | `https://flutter-ohos.obs.cn-south-1.myhuaweicloud.com`（`FLUTTER_STORAGE_BASE_URL`） |
| DevEco | 6.x；HarmonyOS SDK **API 20+**（本机实测是 DevEco 26.0 / SDK API 26.0.0 Beta2） |

> 2026-11-23 用 `git ls-remote --heads` 核对过上述分支存在；Gitee 上的旧仓库
> `openharmony-sig/flutter_flutter` 只到 3.22，**不要再用它**（Dart 3.4 会直接卡住
> `sdk: ">=3.6.2"`）。

---

## 2. 依赖：哪些包需要 OHOS 实现

`apps/mobile/pubspec.yaml` 里的原生插件不是纯 Dart，必须换 OHOS 端口或加 override：

| 依赖 | OHOS 端口 | 说明 |
| --- | --- | --- |
| `shared_preferences` ^2.3.0 | `br_shared_preferences-v2.5.4_ohos`（`flutter_packages`） | 纯 Dart API 不变 |
| `path_provider`（传递依赖） | `br_path_provider-v2.1.5_ohos` | `audioplayers` 等会用到 |
| `image_picker` ^1.1.2 | `br_image_picker-v1.1.2_ohos` | 相册/相机 |
| `flutter_secure_storage` ^9.2.4 | `flutter_secure_storage_ohos` | 上游没有 OHOS 实现，必须硬 fork |
| `audioplayers` ^6.7.1 | `audioplayers_ohos` | 若仓库没有对应版本，先在 OHOS 上降级/禁用音频 |

分支名来自 `https://gitcode.com/openharmony-sig/flutter_packages` 与
`https://github.com/belier-cn/flutter_ohos_packages`（分支 `flutter_3.35`）的
`git ls-remote` 实测。具体 `git:` URL 与 ref 以这些仓库当时的 `pubspec.yaml` 为准，
**不要凭记忆手写**。

写法（`apps/mobile/pubspec_overrides.yaml`，不要污染主 `pubspec.yaml`）：

```yaml
dependency_overrides:
  shared_preferences:
    git:
      url: https://gitcode.com/openharmony-sig/flutter_packages.git
      path: packages/shared_preferences/shared_preferences_ohos
      ref: br_shared_preferences-v2.5.4_ohos
  # path_provider / image_picker / flutter_secure_storage / audioplayers 同理
```

`apps/mobile/lib/platform/platform_info.dart` 已用字符串比较平台名，避免 OHOS fork
新增 `TargetPlatform.ohos` 后穷尽 `switch` 编译失败（历史坑，别改回去）。

---

## 3. 构建机准备

```bash
# 1) Flutter-OH（浅克隆即可，但不要用 zip 下载，缺少 git 元数据会算不出版本）
git clone --depth 1 -b oh-3.35.7-release \
  https://atomgit.com/openharmony-tpc/flutter_flutter.git "$HOME/flutter-ohos"
export PATH="$HOME/flutter-ohos/bin:$PATH"
export FLUTTER_STORAGE_BASE_URL=https://flutter-ohos.obs.cn-south-1.myhuaweicloud.com

flutter --version      # 必须出现 -ohos，channel 为 [user-branch]/ohos
flutter doctor -v      # HarmonyOS toolchain 一节必须识别到 DevEco SDK
```

Windows（本机 DevEco 场景）：

```powershell
# 建议放在非中文、无空格路径
git clone --depth 1 -b oh-3.35.7-release https://atomgit.com/openharmony-tpc/flutter_flutter.git D:\flutter_oh
$env:Path = "D:\flutter_oh\bin;" + $env:Path
$env:FLUTTER_STORAGE_BASE_URL = "https://flutter-ohos.obs.cn-south-1.myhuaweicloud.com"
$env:DEVECO_SDK_HOME = "C:\Program Files\Huawei\DevEco Studio\sdk"
flutter doctor -v
```

DevEco 自带的 `hvigorw` / `ohpm` 在
`C:\Program Files\Huawei\DevEco Studio\tools\{hvigor,ohpm}\bin`，需要加进 PATH。

---

## 4. 构建与签名

```bash
cd apps/mobile
flutter create --platforms=ohos --org cn.shanghaitech --project-name kedaya --no-pub .
flutter pub get                       # 有 pubspec_overrides.yaml 时不要加 --enforce-lockfile
flutter build hap --release \
  --dart-define=KEDAYA_FLAVOR=mock \
  --dart-define=KEDAYA_API_BASE_URL=https://api.kedaya.local
```

产物：

```text
ohos/entry/build/default/outputs/default/entry-default-signed.hap     # 配了签名
ohos/entry/build/default/outputs/default/entry-default-unsigned.hap   # 没配签名
```

workflow 用 `find build/ohos ohos -name '*.hap'` 找第一个，复制成
`kedaya-<version>-harmonyos-<mode>-unsigned.hap`。

签名在 `ohos/build-profile.json5` 的 `signingConfigs`：

```json5
{
  "app": {
    "signingConfigs": [{
      "name": "default",
      "type": "HarmonyOS",
      "material": {
        "certpath": "signing/kedaya.cer",
        "storePassword": "<encrypted>",
        "keyAlias": "kedaya",
        "keyPassword": "<encrypted>",
        "profile": "signing/kedaya.p7b",
        "signAlg": "SHA256withECDSA",
        "storeFile": "signing/kedaya.p12"
      }
    }]
  }
}
```

CI 的做法：`.p12/.cer/.p7b` 以 base64 放 secrets，构建前解码到 `ohos/signing/`，
构建后删除；**任何情况下都不把证书/密码提交进仓库或上传 artifact**。
当前 workflow **没有**实现注入，因此产出的是未签名 HAP，通常 `hdc install` 会拒绝。

---

## 5. Workflow 的预检与诚实失败

`mobile-harmonyos.yml` 现在会：

1. `command -v flutter`，不存在就 `::error::`；
2. `flutter --version | grep -qi ohos`，不是 Flutter-OH 就退出；
3. 打印 `FLUTTER_STORAGE_BASE_URL`、`DEVECO_SDK_HOME`、`hvigorw`、`ohpm` 探测结果；
4. 跑一次 `flutter doctor -v`（只做诊断，不因黄叹号失败）；
5. 检查 `pubspec_overrides.yaml` 里是否有 `flutter_secure_storage_ohos`，缺失给 warning；
6. `flutter build hap`，失败就是失败，不伪造空 HAP；
7. 找不到 `.hap` 时列出 `build/` 并退出。

---

## 6. 本机实测记录（2026-11-24）

| 步骤 | 结果 |
| --- | --- |
| DevEco Studio 安装 | ✅ `C:\Program Files\Huawei\DevEco Studio`，SDK `default/openharmony` API **26.0.0 Beta2**，自带 `jbr`(JDK 25) / `hvigorw` / `ohpm` / `node` |
| Flutter-OH 分支 | ✅ `oh-3.35.7-release` / `oh-3.35.7-dev`（GitCode / AtomGit，实际拉到的是 dev 的 3.35.7 引擎） |
| `flutter --version` | ✅ 3.35.7 / Dart 3.9.2（见下面第 1 个坑） |
| `flutter create --platforms=ohos` | ✅ 生成 `ohos/`（已提交进仓库） |
| `flutter pub get` | ✅ 通过 |
| `flutter build hap --release` | ✅ hvigor 产出 **`entry-default-unsigned.hap`（24 MB）** |
| HAP 内容 | `libs/arm64-v8a/libflutter.so` 16 MB + `libapp.so` 8.3 MB + `ets/modules.abc` + 三个插件的 har |
| 签名 | ❌ 未签名。Flutter 工具报“请配置调试签名”，HAP 是 unsigned |
| 插件注册 | ⚠️ 已接入 3 个（见 §6.2），`image_picker` / `audioplayers` 仍缺 |
| 真机安装 | ❌ 未做（需要 AGC 调试证书 / 签名 HAP） |

产物已复制到 `kedaya-dist/harmonyos/kedaya-0.1.0-harmonyos-release-unsigned.hap`，
SHA-256 `eab08c67cde4dbb77798785ded40c90e1657d3cd767d0a8dc5accadec08155e5`（25 MB，含三个插件）。

### 6.1 实测踩到的四个坑

1. **浅克隆导致版本号是 `0.0.0-unknown`**
   `git clone --depth 1` 没有 tag，`flutter --version` 会报 `0.0.0-unknown`，
   于是 pub 认为 Flutter 版本不满足 `flutter_secure_storage >=2.0.0`，直接求解失败。
   解决：把 `bin/cache/flutter.version.json` 的 `frameworkVersion` / `flutterVersion`
   改成 `3.35.7`（Dart 已经是 3.9.2）。
2. **不要覆盖 `FLUTTER_STORAGE_BASE_URL`**
   指到华为 OBS 后它会去找 `engine_stamp.json`，那个路径 404；而 Google 上同一个
   engine hash 的 `engine_stamp.json` / `dart-sdk-windows-x64.zip` 是 200。
   OHOS 专属产物由 fork 自己的 `FLUTTER_OHOS_STORAGE_BASE_URL` 负责，默认就是 OBS。
3. **`spawn java ENOENT`**
   hvigor 需要 `java`。DevEco 自带 JBR：
   `JAVA_HOME=C:\Program Files\Huawei\DevEco Studio\jbr`，
   并把 `jbrin` 加进 `PATH`。
4. **签名**
   Flutter 工具在 hvigor 之后才检查签名并报错，但 **unsigned HAP 已经生成**。
   要安装仍需：DevEco 打开 `ohos/` → File → Project Structure → Signing Configs →
   勾选 Automatically generate signature（需登录华为账号），或配置 §4 的证书三件套。

### 6.2 插件登记：已接 3 个，仍缺 2 个

`pubspec.yaml` 增加了三个 OHOS 联邦实现（pub.dev 上的稳定版本，非 git）：

```yaml
shared_preferences_ohos: ^2.2.0
path_provider_ohos: ^2.2.1
flutter_secure_storage_ohos: ^1.0.0
```

重新构建后 `GeneratedPluginRegistrant.ets`（该文件被 `ohos/entry/.gitignore` 忽略，
每次构建由工具生成）变成：

```ts
flutterEngine.getPlugins()?.add(new SharedPreferencesPlugin());
flutterEngine.getPlugins()?.add(new PathProviderPlugin());
flutterEngine.getPlugins()?.add(new FlutterSecureStorageOhosPlugin());
```

也就是说：**安全存储、本地缓存、路径**在鸿蒙上已可用。

仍缺：

| 依赖 | 影响 | 处理 |
| --- | --- | --- |
| `image_picker` | 野生动物拍照上报、头像选图不可用 | 只有 `flutter_packages` 的 `br_image_picker-v1.1.2_ohos` 分支，没有 pub.dev 版本；用 git 依赖会把整个仓库克隆进 CI，暂不接 |
| `audioplayers` | TTS「朗读」按钮不可用 | 没找到稳定 OHOS 端口；鸿蒙上应在 UI 层隐藏该按钮 |

`flutter pub get` 只多了 3 个纯 Dart 包，其他平台构建不受影响；但没有在 Android/iOS/桌面
重新跑一遍全量测试，以 CI 结果为准。

## 7. 未解决项

| 项 | 状态 |
| --- | --- |
| Flutter-OH 具体版本固定 | 已固定 `oh-3.35.7-release`（需要随上游更新时再评估） |
| `flutter_secure_storage_ohos` / `audioplayers_ohos` 的 ref | 需要按仓库当前分支落 `pubspec_overrides.yaml` |
| 签名证书/Profile | 仓库没有；workflow 不注入 |
| 自托管 runner | 仓库未配置；label 只需 `self-hosted` + `ohos` |
| 真机/模拟器验证 | 未做 |
| GitHub 托管 runner | **不可用**（工具链数 GB + 华为账号许可） |
| 上架 AppGallery | 未做 |
