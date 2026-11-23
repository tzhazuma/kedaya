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

## 6. 本机实测到哪一步（2026-11-23）

| 步骤 | 结果 |
| --- | --- |
| DevEco Studio 安装 | ✅ `C:\Program Files\Huawei\DevEco Studio`，SDK `default/openharmony` API **26.0.0 Beta2** |
| `hvigorw` / `ohpm` / `node` | ✅ 都在 `tools/` 下 |
| Flutter-OH 分支存在性 | ✅ `oh-3.35.7-release` 等分支已用 `git ls-remote` 核对 |
| 克隆 Flutter-OH | ❌ 本机到 GitCode/AtomGit 的带宽只有数 MB/分钟，数百 MB 的 SDK 与 Dart SDK 无法在合理时间内拉完 |
| `flutter --version`（Flutter-OH） | ⛔ 未完成，卡在 Dart SDK 下载 |
| `flutter create --platforms=ohos` | ⛔ 未执行（依赖上一步） |
| `flutter build hap` | ⛔ 未执行 |
| HAP 产物 | ⛔ **没有** |

所以本目录**不声称**已经产出可安装的鸿蒙包。要落地，需要满足其一：

- 在能正常访问 AtomGit / 华为 OBS 镜像的机器上按第 3–4 节执行；
- 或把 Flutter-OH 与 DevEco 预装进自托管 runner 镜像，再触发 workflow；
- 或由你在本机 DevEco 里打开生成的 `ohos/` 工程手动签名运行。

---

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
