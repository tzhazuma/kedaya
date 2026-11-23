# HarmonyOS（鸿蒙）构建

Workflow：`.github/workflows/mobile-harmonyos.yml`
Runner：**自托管** `[self-hosted, linux, ohos]`
产物：`kedaya-<version>-harmonyos-<mode>-unsigned.hap`

**当前没有在 GitHub 托管 runner 上构建鸿蒙。** stock Flutter 没有 OHOS engine；
OHOS fork + DevEco 工具链约数 GB，且 SDK 需要华为账号许可，不适合塞进
`ubuntu-latest`。本目录只提供自托管流水线与命令，不声称已经产出可用 HAP。
该 workflow **不进入 Release**，也不在 `mobile-build.yml` 的 `release.needs` 里；
仓库没有配置自托管 runner，未实跑。

---

## 1. 为什么必须是 OHOS fork

`docs/adr/0003-mobile-framework.md` 已经记录：

- HarmonyOS NEXT 需要 **OHOS fork 的 Flutter SDK**（`flutter_flutter`，channel `ohos`），
  stock Flutter 没有 OHOS engine；
- 构建命令是 `flutter build hap`，产物是 `.hap`；
- TechPie-flutter 已验证这条路，并给出了容器化 CI 方案（工具链约 4.5 GB，
  宿主 runner 装不下，所以用容器/自托管）。

`apps/mobile/README.md` §7 还记录了插件坑：

- `flutter_secure_storage` 上游没有 OHOS 实现，必须换 `flutter_secure_storage_ohos`
  （硬 fork，不是联邦插件）；
- `shared_preferences`、`url_launcher` 等也需要 OHOS fork 的对应实现；
- `lib/platform/platform_info.dart` 用字符串比较平台名，避免对 OHOS fork 新增的
  `TargetPlatform.ohos` 做穷尽 `switch` 编译失败。

这些是 **pubspec/依赖层**的改动，不在本 workflow 的改动范围；当前
`apps/mobile/pubspec.yaml` 还没有 OHOS 替换，所以构建可能失败，workflow 会给出警告。

---

## 2. 自托管构建机要求

### 2.1 软件

| 项 | 要求 |
| --- | --- |
| OS | Linux x64（或团队实际使用的 OHOS 构建容器） |
| Flutter | OHOS fork：`openharmony-sig/flutter_flutter`，`ohos` channel；`flutter --version` 输出含 `ohos` |
| HarmonyOS SDK | DevEco Studio 或 command-line tools；`DEVECO_SDK_HOME` 指向 SDK |
| 构建工具 | `hvigorw` / `hvigor`、`ohpm` 在 PATH |
| 签名 | `ohos/build-profile.json5` 的 `signingConfigs`，以及 `.p12` / `.cer` / `.p7b` |
| Runner | GitHub Actions self-hosted runner，labels：`self-hosted`、`linux`、`ohos` |

### 2.2 安装 OHOS Flutter（示例，版本以团队验证为准）

```bash
git clone -b ohos https://gitee.com/openharmony-sig/flutter_flutter.git "$HOME/flutter-ohos"
export PATH="$HOME/flutter-ohos/bin:$PATH"
flutter --version          # 必须包含 ohos
flutter doctor -v
```

> 不同的 OHOS fork 分支对应不同的 Flutter 基线。`apps/mobile` 的代码按 Flutter 3.35.1
> 书写，但 OHOS fork 不一定跟到 3.35.1；如果 fork 的 Dart/Flutter API 更旧，
> 需要移动端负责人单独适配，不能靠 workflow 修。

### 2.3 签名配置

DevEco 的签名通常在 `ohos/build-profile.json5`：

```json5
{
  "app": {
    "signingConfigs": [
      {
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
      }
    ]
  }
}
```

CI 的做法应该是：

- 把 `.p12` / `.cer` / `.p7b` 以 base64 放进 secrets，构建前解码到 `ohos/signing/`；
- 用 `hvigor` 的密码参数或临时替换 `build-profile.json5` 注入密码；
- 构建后删除签名材料；
- **绝不**把证书/密码提交到仓库或上传 artifact。

当前 workflow **没有**实现这些注入；它只构建未签名 HAP（如果 fork 允许），
并在文档里标明未签名包通常无法安装。

---

## 3. 构建命令

在自托管机器上：

```bash
cd apps/mobile

# 1) 生成/补齐 ohos/ 原生工程（OHOS fork 的 flutter create 支持 --platforms=ohos）
flutter create --platforms=ohos \
  --org cn.shanghaitech --project-name kedaya --no-pub .

# 2) 依赖（OHOS 插件替换可能需要 pubspec_overrides.yaml）
flutter pub get

# 3) 构建
flutter build hap --release \
  --dart-define=KEDAYA_FLAVOR=mock \
  --dart-define=KEDAYA_API_BASE_URL=https://api.kedaya.local
```

产物通常在：

```text
build/ohos/.../*.hap
ohos/entry/build/default/outputs/default/*.hap
```

workflow 用 `find build/ohos ohos -name '*.hap'` 找第一个并复制成
`build/artifacts/kedaya-<version>-harmonyos-<mode>-unsigned.hap`。

安装/调试（需要 `hdc`）：

```bash
hdc install -r kedaya-0.1.0-harmonyos-release-unsigned.hap
```

未签名/签名不匹配时 `hdc install` 会拒绝；这不是 workflow 能绕过的。

---

## 4. Workflow 的预检与诚实失败

`mobile-harmonyos.yml` 在构建前会：

1. `command -v flutter`，不存在就 `::error::` 退出；
2. `flutter --version | grep -qi ohos`，不是 OHOS fork 就退出；
3. 检查 `DEVECO_SDK_HOME`、`hvigorw`/`hvigor`、`ohpm`，缺失给 `::warning::`；
4. 检查 `pubspec.yaml` / `pubspec_overrides.yaml` 是否有
   `flutter_secure_storage_ohos`，缺失给 warning（不阻塞，便于先看真实构建错误）；
5. `flutter build hap`，失败就是失败，不会伪造一个空 HAP；
6. 找不到 `.hap` 时列出 `build/` 目录并退出。

这样做的目的：**宁可 CI 红，也不把“未签名的空壳”说成鸿蒙构建成功**。

---

## 5. 当前未解决

| 项 | 状态 |
| --- | --- |
| OHOS fork 的具体版本/容器镜像 | 未固定；由构建团队提供 |
| `flutter_secure_storage_ohos` 等插件替换 | `pubspec.yaml` 未接；需要移动端负责人改依赖 |
| 签名证书/Profile | 仓库没有；workflow 不注入 |
| 自托管 runner | 仓库未配置；label 需要团队创建 |
| 真机/模拟器验证 | 未做 |
| GitHub 托管 runner | **不可用**（工具链/许可限制） |
| HAP 上传/应用市场 | 未做 |

在以上项完成前，鸿蒙只能算“有构建路径和预检”，**不能**算“已支持鸿蒙发布”。
