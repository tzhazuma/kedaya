# Android 构建

Workflow：`.github/workflows/mobile-build.yml` 的 `android` job
Runner：`ubuntu-latest`（JDK 17 + Android SDK 由 runner/Flutter 提供）
产物：`kedaya-<version>-android-universal-debug-signed.apk`

质量门禁：同一 workflow 的 `quality` job 在 `ubuntu-latest` 上跑
`flutter analyze` / `flutter test`（全量 680 例基线）；`release` 依赖它。
Android 构建 job 本身不跑 analyze/test。

---

## 1. 现状（重要）

`apps/mobile/android/app/build.gradle.kts` 的 `release` build type 仍是 Flutter 模板默认值：

```kotlin
buildTypes {
    release {
        // TODO: Add your own signing config for the release build.
        // Signing with the debug keys for now, so `flutter run --release` works.
        signingConfig = signingConfigs.getByName("debug")
    }
}
```

所以 `flutter build apk --release` 产出的是**用 debug key 签名的 release APK**：

- 可以侧载、内测、`adb install`；
- **不能**上架 Google Play / 国内应用商店；
- 与将来正式签名的 APK 签名不同，不能覆盖安装（需要先卸载）；
- 不能作为“已签名正式包”对外宣传。

CI 产物文件名里显式带 `debug-signed`，Release notes 也会重复这条。

本地复现时请先定义 `VERSION`（CI 由版本步骤写入 `$GITHUB_ENV`）：

```bash
VERSION=0.1.0
```

---

## 2. CI 命令

```bash
cd apps/mobile

# 只在 android/ 缺失时生成；已有 android/ 时跳过，避免覆盖 Gradle 镜像/签名配置
if [ ! -d android ]; then
  flutter create --platforms=android \
    --org cn.shanghaitech --project-name kedaya --no-pub .
fi

# gradlew / gradle-wrapper.jar 被 android/.gitignore 忽略，
# 由 flutter build 在构建时从 Flutter SDK 注入，不需要手动提交。

flutter pub get --enforce-lockfile

build_number=$(( GITHUB_RUN_NUMBER * 100 + GITHUB_RUN_ATTEMPT ))
flutter build apk --release \
  --build-name="$VERSION" \
  --build-number="$build_number" \
  --dart-define=KEDAYA_FLAVOR="$KEDAYA_FLAVOR" \
  --dart-define=KEDAYA_API_BASE_URL="$KEDAYA_API_BASE_URL"
```

产物：`build/app/outputs/flutter-apk/app-release.apk`，CI 复制为
`build/artifacts/kedaya-<version>-android-universal-debug-signed.apk`。

`universal` 指包含 `arm64-v8a` / `armeabi-v7a` / `x86_64` 的 fat APK。要减小体积可以本地跑：

```bash
flutter build apk --release --split-per-abi
# build/app/outputs/flutter-apk/app-arm64-v8a-release.apk 等
```

CI 没有跑 split，因为内测阶段一个通用包更方便；需要时再加矩阵。

---

## 3. 本机验证

```bash
# 版本 / 签名
$ANDROID_HOME/build-tools/<version>/apksigner verify --print-certs \
  build/app/outputs/flutter-apk/app-release.apk

# 包名、版本号、min/target SDK
$ANDROID_HOME/build-tools/<version>/aapt dump badging \
  build/app/outputs/flutter-apk/app-release.apk | head

# 安装到设备
adb install -r build/app/outputs/flutter-apk/app-release.apk
```

预期包名：`cn.shanghaitech.kedaya`（`applicationId`，不是 Flutter 默认的 `com.example.*`）。

---

## 4. 正式签名（当前未实现，需移动端负责人改 Gradle）

> 这一节是**操作说明**，不是已经生效的配置。`build.gradle.kts` 不在本次改动范围，
> 且签名材料绝不能进仓库。

### 4.1 生成 keystore（只做一次，离线保管）

```bash
keytool -genkeypair -v \
  -keystore kedaya-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias kedaya
```

### 4.2 本地 `android/key.properties`（已被 `.gitignore` 忽略）

```properties
storePassword=<store-password>
keyPassword=<key-password>
keyAlias=kedaya
storeFile=../keystore/kedaya-release.jks
```

### 4.3 在 `android/app/build.gradle.kts` 接上 release signing

大致形状（Kotlin DSL，具体以移动端负责人的实现为准）：

```kotlin
import java.util.Properties
import java.io.FileInputStream

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

android {
    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["storePassword"] as String
        }
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}
```

`storeFile` 的相对路径基准是 `android/app/`（`file()` 在 app module 内解析），
不要照抄成相对仓库根目录。

### 4.4 CI 注入（将来）

需要仓库 secrets（**当前 workflow 没有读取这些**）：

| Secret | 用途 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 kedaya-release.jks` |
| `ANDROID_STORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_PASSWORD` | key 密码 |
| `ANDROID_KEY_ALIAS` | 通常是 `kedaya` |

步骤形状：

```yaml
- name: Decode Android keystore
  run: |
    echo "$ANDROID_KEYSTORE_BASE64" | base64 -d > android/app/kedaya-release.jks
    cat > android/key.properties <<EOF
    storePassword=$ANDROID_STORE_PASSWORD
    keyPassword=$ANDROID_KEY_PASSWORD
    keyAlias=$ANDROID_KEY_ALIAS
    storeFile=kedaya-release.jks
    EOF
  env:
    ANDROID_KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
    ANDROID_STORE_PASSWORD: ${{ secrets.ANDROID_STORE_PASSWORD }}
    ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
    ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
```

注意：

- 不要把 `key.properties` / `.jks` 写进 artifact；
- 不要在 `run:` 里 `echo` 密码；
- 构建后删除临时 keystore（runner 是临时的，但仍建议显式 `rm`）；
- 签名后重新跑 `apksigner verify --print-certs`，确认证书不是 `CN=Android Debug`。

### 4.5 Play / 商店

商店要 AAB：

```bash
flutter build appbundle --release
# build/app/outputs/bundle/release/app-release.aab
```

当前 workflow 只做 APK（任务要求），AAB 需要正式签名后另加 job。

---

## 5. 已知限制

- `minSdk` / `targetSdk` 用 `flutter.minSdkVersion` / `flutter.targetSdkVersion`，
  会随 Flutter 版本变化；如果商店审核要求固定值，需要显式写死并记录理由。
- 没有配置 `android:usesCleartextTraffic`；如果 API 是 HTTP（不是 HTTPS），
  release 包会直接拒绝请求。正式环境必须是 HTTPS。
- 原生工程目录不完整（缺 `gradlew` 等），CI 靠 `flutter create` 补齐；
  这只保证构建，不保证 Android Studio 本地打开即用。
- 未接 `flutter_secure_storage` 的 Android 备份规则；上线前需确认
  `android:allowBackup` 与 Keystore 行为符合安全要求。
