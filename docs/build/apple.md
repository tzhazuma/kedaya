# macOS / iOS 构建（macOS runner，未签名）

Workflow：`.github/workflows/mobile-build.yml` 的 `macos` 与 `ios` job
Runner：`macos-15`（Apple Silicon / arm64；`macos-14` 已于 2026-11-02 退役）
产物：

- `kedaya-<version>-macos-arm64-unsigned.zip`
- `kedaya-<version>-macos-arm64-unsigned.dmg`
- `kedaya-<version>-ios-unsigned.zip`（里面是 `Runner.app`，**不是 `.ipa`**）

当前 CI **不持有任何 Apple 证书**，产物是未签名/ ad-hoc 签名，不能直接对外分发。
签名与 notarization 的要求在下面写清楚，但没有真实证书，也没有在 CI 跑过。

---

## 1. macOS 构建

### 1.1 前置

- macOS 15+，Xcode 16.x（Flutter 3.35.1 的验证版本）
- CocoaPods（`pod --version`）
- Flutter 3.35.1 stable

CI 的 `macos-15` 镜像默认带 Xcode 16.4 与 CocoaPods（16.0–16.4 都在镜像里）；
workflow 会先选择/断言 Xcode 16.x，再打印 `flutter --version` /
`xcodebuild -version` / `pod --version` 作为日志证据。默认 Xcode 若被镜像升到 26，
会显式切回已安装的 `Xcode_16*.app`，切不回去就失败。

### 1.2 命令

```bash
cd apps/mobile
flutter create --platforms=macos \
  --org cn.shanghaitech --project-name kedaya --no-pub .
flutter pub get --enforce-lockfile

flutter build macos --release \
  --dart-define=KEDAYA_FLAVOR=mock \
  --dart-define=KEDAYA_API_BASE_URL=https://api.kedaya.local
```

输出：

```text
build/macos/Build/Products/Release/kedaya.app
```

### 1.3 未签名打包

```bash
app="build/macos/Build/Products/Release/kedaya.app"

# ad-hoc 签名：Apple Silicon 上至少让本机可以启动，但不是分发签名
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"

# zip
ditto -c -k --keepParent "$app" kedaya-0.1.0-macos-arm64-unsigned.zip

# dmg
hdiutil create -volname "Kedaya" -srcfolder "$app" -ov -format UDZO \
  kedaya-0.1.0-macos-arm64-unsigned.dmg
```

未 notarize 的后果：

- 在**构建它的机器**上通常可以运行；
- 其他机器从浏览器/网盘下载后，Gatekeeper 会提示“无法验证开发者”；
- `spctl --assess --type execute --verbose "$app"` 预期失败；
- 用户只能右键打开或 `xattr -dr com.apple.quarantine`，这不是正式分发方式。

### 1.4 架构限制

`macos-15` 是 arm64，产物是 **arm64 only**。没有做：

- Intel x64 构建需要 Intel Mac，或当前仍提供的 `macos-15-intel` / `macos-26-intel`
  托管镜像；托管镜像矩阵会退役旧版本，使用前先查 `actions/runner-images`，
  不要假设某个 label 一定可用；
- universal2（`lipo` 合并 arm64 + x86_64）也没有做。universal 需要每个插件都有 x86_64 slice，
  不是 `flutter build macos` 一个参数能保证的。

如果必须支持 Intel，建议单独加 `macos-15-intel` job（或自托管 Intel Mac），并用
`lipo -info` 验证最终二进制确实包含两种架构。`macos-13` 已不在当前托管镜像列表里。

---

## 2. iOS 构建（未签名）

### 2.1 命令

```bash
cd apps/mobile
flutter create --platforms=ios \
  --org cn.shanghaitech --project-name kedaya --no-pub .
flutter pub get --enforce-lockfile

flutter build ios --release --no-codesign \
  --dart-define=KEDAYA_FLAVOR=mock \
  --dart-define=KEDAYA_API_BASE_URL=https://api.kedaya.local

ditto -c -k --keepParent build/ios/iphoneos/Runner.app \
  kedaya-0.1.0-ios-unsigned.zip
```

产物是 `Runner.app`，不是 `.ipa`：

- 不能直接安装到普通 iPhone；
- 需要 Apple 开发者证书 + provisioning profile 重签；
- 没有 `ios/` 原生目录入库，`flutter create` 生成的工程是模板默认
  （Bundle ID `cn.shanghaitech.kedaya`、显示名 `kedaya`）。

### 2.2 为什么不用 `flutter build ipa`

`flutter build ipa` 需要可用的签名身份与 `ExportOptions.plist`；没有证书时会失败。
当前目标是“准备代码和构建方法”，所以用 `--no-codesign` 产出可检查的 app bundle。
等证书到位后改成：

```bash
flutter build ipa --release \
  --export-options-plist=ios/ExportOptions.plist
```

`ExportOptions.plist` 至少包含：

```xml
<key>method</key><string>app-store</string> <!-- 或 ad-hoc / development -->
<key>teamID</key><string>${APPLE_TEAM_ID}</string>
<key>signingStyle</key><string>manual</string>
<key>provisioningProfiles</key>
<dict>
  <key>cn.shanghaitech.kedaya</key>
  <string>${IOS_PROVISIONING_PROFILE_NAME}</string>
</dict>
```

---

## 3. 正式签名与 notarization 要求

> 以下是**要求与命令形状**，不是当前 CI 已实现的步骤。没有真实证书，未执行。

### 3.1 账号与材料

| 项 | macOS | iOS |
| --- | --- | --- |
| Apple Developer Program | 需要 | 需要 |
| 证书 | **Developer ID Application**（站外分发）或 Apple Distribution（App Store） | **Apple Distribution**（App Store/Ad Hoc）或 Development |
| Provisioning Profile | 通常不需要（Developer ID + notarization） | 需要，且 Bundle ID 必须已注册 |
| Notarization | 需要（`notarytool`） | App Store 上传由 Transporter/altool 处理，不走 notarization |
| 其他 | Team ID | Team ID、App Store Connect API Key |

### 3.2 CI secrets（当前 workflow 不读取）

| Secret | 说明 |
| --- | --- |
| `APPLE_TEAM_ID` | 10 位 Team ID |
| `APPLE_CERT_P12_BASE64` | Developer ID/Apple Distribution 证书 `.p12` 的 base64 |
| `APPLE_CERT_PASSWORD` | `.p12` 密码 |
| `APPLE_KEYCHAIN_PASSWORD` | CI 临时 keychain 密码（随机值即可） |
| `APPLE_ID` | notarization 用的 Apple ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple ID 的 app-specific password |
| `APPLE_API_KEY_ID` | 可选：App Store Connect API Key ID |
| `APPLE_API_ISSUER_ID` | 可选：API Key issuer |
| `APPLE_API_KEY_P8_BASE64` | 可选：`.p8` 私钥的 base64 |
| `IOS_PROVISIONING_PROFILE_BASE64` | iOS `.mobileprovision` 的 base64 |
| `IOS_PROVISIONING_PROFILE_NAME` | profile 名称（写进 ExportOptions） |

原则：证书/密码只进 runner 的临时 keychain 或 `~/Library/MobileDevice/Provisioning Profiles`，
构建后删除；绝不 `echo`、绝不进 artifact。

### 3.3 macOS 签名 + notarize 命令形状

```bash
# 1) 临时 keychain
security create-keychain -p "$APPLE_KEYCHAIN_PASSWORD" build.keychain
security default-keychain -s build.keychain
security unlock-keychain -p "$APPLE_KEYCHAIN_PASSWORD" build.keychain

# 2) 导入证书
echo "$APPLE_CERT_P12_BASE64" | base64 -d > cert.p12
security import cert.p12 -k build.keychain -P "$APPLE_CERT_PASSWORD" \
  -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -s \
  -k "$APPLE_KEYCHAIN_PASSWORD" build.keychain

# 3) hardened runtime 签名
codesign --force --deep --options runtime --timestamp \
  --sign "Developer ID Application: <Name> ($APPLE_TEAM_ID)" \
  "build/macos/Build/Products/Release/kedaya.app"

# 4) 打 dmg 后 notarize
xcrun notarytool submit kedaya-0.1.0-macos-arm64.dmg \
  --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" --wait

# 5) staple + 验证
xcrun stapler staple kedaya-0.1.0-macos-arm64.dmg
spctl --assess --type open --context context:primary-signature -v \
  kedaya-0.1.0-macos-arm64.dmg
```

也可以用 App Store Connect API Key：

```bash
xcrun notarytool submit ... \
  --key AuthKey_${APPLE_API_KEY_ID}.p8 \
  --key-id "$APPLE_API_KEY_ID" \
  --issuer "$APPLE_API_ISSUER_ID" --wait
```

### 3.4 iOS 签名命令形状

```bash
mkdir -p ~/Library/MobileDevice/Provisioning\ Profiles
echo "$IOS_PROVISIONING_PROFILE_BASE64" | base64 -d \
  > ~/Library/MobileDevice/Provisioning\ Profiles/kedaya.mobileprovision

flutter build ipa --release \
  --export-options-plist=ios/ExportOptions.plist
```

上传到 App Store Connect 可以用 Xcode Organizer、Transporter，或
`xcrun altool --upload-app -f build/ios/ipa/*.ipa -t ios --apiKey ... --apiIssuer ...`。
CI 里优先用 App Store Connect API Key，避免 Apple ID + 双重认证。

### 3.5 macOS 网络权限（提交原生目录时必须检查）

Flutter 的 macOS 模板默认在 `Release.entitlements` 里开启 App Sandbox，但不一定包含
`com.apple.security.network.client`；Debug 配置通常有，Release 没有。若 release 包
所有网络请求都失败，先检查：

```xml
<key>com.apple.security.network.client</key>
<true/>
```

这条属于 `macos/Runner/Release.entitlements`（当前未入库），不是 workflow 能修的。

---

## 4. 已知限制

- `macos-14` 已于 2026-11-02 退役；当前用 `macos-15`。镜像默认 Xcode 16.4，
  workflow 会断言/切换到 16.x；Flutter 3.35.1 对 Xcode 26 的兼容性未验证。
- 没有 `macos/` / `ios/` 原生目录；应用名、图标、URL Scheme、推送 entitlement、
  Privacy Manifest 都是模板默认。
- iOS 没有 `Info.plist` 的 ATS 例外；API 必须是 HTTPS。
- 没有做 App Store 截图/隐私标签/审核材料；本目录只覆盖构建。
- macOS 只出 arm64，Intel 与 universal2 未实现。
- 所有 Apple 产物未签名/未 notarize，**不能**当作可分发正式版。
