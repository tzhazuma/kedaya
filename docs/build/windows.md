# Windows 构建（x64 正式 / ARM64 实验）

Workflow：

- x64：`.github/workflows/mobile-build.yml` 的 `windows-x64` job
- ARM64：`.github/workflows/mobile-windows-arm64.yml`（仅手动，实验性，不进入 Release）

产物：

- `kedaya-<version>-windows-x64-portable.zip`
- `kedaya-<version>-windows-x64-setup.exe`
- （实验，不发布）`kedaya-<version>-windows-arm64-portable-experimental.zip`

---

## 1. x64 构建

### 1.1 前置

- Windows 10/11 x64

⚠️ **本机（2026-11-25）编不了 Windows**：`flutter build windows` 报
`could not find any instance of Visual Studio`（只探测到 VS 16 2019 生成器，
实际未安装 VS + C++ 桌面工作负载）。要本地出包必须先装
**Visual Studio 2022 + 「使用 C++ 的桌面开发」**。

在那之前，验证 UI 改动的可行路径是：dispatch 只跑 `windows_x64` 的 CI job →
下载 artifact → 解包运行 → 截图。注意用 `gh run download` 而不是内联的
`wsl bash -lc '...'`（PATH 里的 `Program Files (x86)` 会触发 shell 语法错误）。
- **Visual Studio 2022（major 17）**，勾选 **“使用 C++ 的桌面开发”**
  （含 MSVC v143、Windows 10/11 SDK、CMake）
- Flutter 3.35.1 stable

> **CI runner 固定为 `windows-2022`，不是 `windows-latest`。**
> 2026-11 的 `windows-latest` 等于 `windows-2025-vs2026`，带 **Visual Studio 2026
> （major 18）**。Flutter 3.35.1 的 `visual_studio.dart` 只把 major 17 映射为
> `Visual Studio 17 2022`；其他 major 回退到 `Visual Studio 16 2019` 生成器，
> 所以在 VS 2026 上会失败。workflow 在构建前用 `vswhere` 读取
> `installationVersion`，断言 major 是 17；不是就明确失败，不会悄悄用错生成器。
>
> 要迁到 `windows-latest`，必须先升级 Flutter 到认识 VS 2026 的版本
> （3.50.1 起有 `18 => 'Visual Studio 18 2026'`），并完整跑
> `flutter analyze` / `flutter test` / Windows 构建；**不能只改 runner 名字**。

```powershell
flutter doctor -v
# 确认 "Visual Studio - develop Windows apps" 一项是 √
# 并确认 Visual Studio 是 2022（17.x），不是 2026（18.x）
```

### 1.2 命令

```powershell
cd apps/mobile
flutter create --platforms=windows `
  --org cn.shanghaitech --project-name kedaya --no-pub .
flutter pub get --enforce-lockfile

flutter build windows --release `
  "--dart-define=KEDAYA_FLAVOR=mock" `
  "--dart-define=KEDAYA_API_BASE_URL=https://api.kedaya.local"
```

输出目录：

```text
build\windows\x64\runner\Release\kedaya.exe
build\windows\x64\runner\Release\data\
build\windows\x64\runner\Release\*.dll
```

Flutter 3.16 起 Windows 输出路径带目标架构（`x64`）；更早版本是
`build\windows\runner\Release`。CI 用 `Get-ChildItem -Recurse -Filter kedaya.exe` +
`\runner\Release\` 正则匹配，两种路径都能找到。

### 1.3 便携包

把整个 `Release` 目录压缩即可，不需要安装：

```powershell
Compress-Archive -Path .\build\windows\x64\runner\Release\* `
  -DestinationPath .\build\artifacts\kedaya-0.1.0-windows-x64-portable.zip
```

用户解压后双击 `kedaya.exe`。`data\`、DLL 必须和 exe 保持相对位置，不能只发 exe。

### 1.4 Inno Setup 安装器

脚本：[`windows/kedaya.iss`](windows/kedaya.iss)。CI 调用：

```powershell
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" `
  "/DAppVersion=0.1.0" `
  "/DSourceDir=<Release 目录的绝对路径>" `
  "/DOutputDir=<artifacts 的绝对路径>" `
  "/DIconFile=<repo>\apps\mobile\windows\runner\resources\app_icon.ico" `
  "<repo>\docs\build\windows\kedaya.iss"
```

行为：

- 每用户安装（`PrivilegesRequired=lowest`），默认装到 `{autopf}\Kedaya`，
  不弹 UAC，适合学生机房/无管理员账号的机器；
- 创建开始菜单项，可选桌面快捷方式；
- `ArchitecturesAllowed=x64`：32 位 Windows 不允许安装；
- 卸载信息与 `UninstallDisplayIcon` 指向 `kedaya.exe`；
- 图标文件不存在时 `#if FileExists(IconFile)` 会跳过，不会让编译失败。

静默安装（批量部署）：

```powershell
.\kedaya-0.1.0-windows-x64-setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

**本机没有安装 Inno Setup，脚本未实际编译过。** CI 首次运行需确认 `ISCC` 存在；
workflow 在缺失时会 `choco install innosetup` 再重试。

---

## 2. 签名（当前未实现）

Windows 产物未做 Authenticode 签名，SmartScreen 会提示“未知发布者”。
正式分发需要代码签名证书（OV/EV），并：

1. 用 `signtool` 签 exe/DLL 与安装器：

```powershell
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 `
  /f cert.pfx /p "$env:WINDOWS_CERT_PASSWORD" `
  .\build\artifacts\kedaya-0.1.0-windows-x64-setup.exe
```

2. 或在 Inno 里配 `SignTool`（`[Setup]` 的 `SignTool=...`），让安装器编译时自动签。

CI 需要的 secrets（**当前 workflow 不读取**）：

| Secret | 用途 |
| --- | --- |
| `WINDOWS_CERT_PFX_BASE64` | `.pfx` 的 base64 |
| `WINDOWS_CERT_PASSWORD` | pfx 密码 |

注意事项：

- 证书 private key 不能进仓库/artifact/日志；
- 时间戳服务器要选可用的 RFC 3161 服务；
- 先签 exe/DLL 再打安装器，或让 Inno 对最终安装器签名，两者不要混；
- 未签名产物只能内测；不要把它标成“正式版”。

---

## 3. Windows ARM64（实验性，当前不进入 Release）

### 3.1 工具链事实（2026-11-22 核对）

1. **没有官方 Windows ARM64 Flutter SDK。** Windows 发布清单里 3.50.1 仍然只有
   `flutter_windows_3.50.1-stable.zip`（`dart_sdk_arch: x64`），没有 ARM64 归档。
   `subosito/flutter-action` 装的也是 x64 SDK；在 ARM64 Windows 上，它以 x64
   仿真运行。
2. **3.35.1 不能配 VS 2026。** 3.35.1 的 `visual_studio.dart` 只有：

   ```dart
   return switch (_majorVersion) {
     17 => 'Visual Studio 17 2022',
     _ => 'Visual Studio 16 2019',
   };
   ```

   3.50.1 才加入 `18 => 'Visual Studio 18 2026'`。
3. **3.50.1 支持 `FLUTTER_HOST_ARCH` 覆盖。** `OperatingSystemUtils.hostPlatform`
   会优先读这个环境变量；设为 `arm64` 后，`build_windows.dart` 的
   `defaultTargetPlatform` 才会变成 `windows-arm64`。不设它，x64 SDK 的
   `Abi.current()` 仍是 `windowsX64`，默认产出 x64。
4. **windows-arm64 engine 产物存在。** 对 3.50.1 的 engine hash
   （`4d35714800b9266b6693a58e1225ecd7e9e45ed7`）核对过
   `windows-arm64/artifacts.zip`、`windows-arm64-release/windows-arm64-flutter.zip`
   都是 HTTP 200；`flutter precache --windows` 在 `FLUTTER_HOST_ARCH=arm64` 下会取这些。
5. **`flutter build windows` 没有 `--target-platform` 选项。** 3.50.1 的
   `build_windows.dart` 只按 hostPlatform 决定目标，没有注册该参数；传了会报
   “Could not find an option named target-platform”。所以 workflow **不传**
   `--target-platform`。
6. **GitHub 有 ARM64 Windows runner。** `windows-11-vs2026-arm`（或 `windows-11-arm`）
   是 Windows 11 ARM64 + Visual Studio 2026。

依据：

- Flutter 3.35.1 `visual_studio.dart`：
  <https://github.com/flutter/flutter/blob/3.35.1/packages/flutter_tools/lib/src/windows/visual_studio.dart>
- Flutter 3.50.1 同文件（新增 `18 => 'Visual Studio 18 2026'`）：
  <https://github.com/flutter/flutter/blob/3.50.1/packages/flutter_tools/lib/src/windows/visual_studio.dart>
- Flutter 3.50.1 `os.dart`（`FLUTTER_HOST_ARCH`）：
  <https://github.com/flutter/flutter/blob/3.50.1/packages/flutter_tools/lib/src/base/os.dart>
- Flutter 3.50.1 `build_windows.dart`（没有 `--target-platform`）：
  <https://github.com/flutter/flutter/blob/3.50.1/packages/flutter_tools/lib/src/commands/build_windows.dart>
- GitHub `windows-11-vs2026-arm`：
  <https://github.com/actions/runner-images#available-images>

### 3.2 实验 workflow 做了什么

`mobile-windows-arm64.yml`：

- `runs-on: windows-11-vs2026-arm`（GitHub 托管 ARM64 Windows + VS 2026；仅手动触发）；
- Flutter **3.50.1**（不是 3.35.1）；
- 构建前检查 `OSArchitecture == Arm64`；
- 设置 `FLUTTER_HOST_ARCH=arm64`，并 `flutter precache --windows`；
- `flutter build windows --release`（**不传** `--target-platform`）；
- 读取 `kedaya.exe` 的 PE 头，检查 `Machine == 0xAA64`（`IMAGE_FILE_MACHINE_ARM64`）；
  不是 ARM64 就直接失败，**绝不把 x64 二进制改名冒充**；
- 只打 portable zip，不做安装器（Inno 的 ARM64 支持未验证）；
- 只上传 7 天 artifact，**不进入 Release**；Release notes 也明确写“Windows ARM64
  不在本次发布里”。

### 3.3 为什么仍不能算“支持 ARM64”

- 没有官方 ARM64 SDK：x64 Flutter 工具在 ARM64 Windows 上靠仿真运行，
  `FLUTTER_HOST_ARCH=arm64` 只是让工具选 ARM64 目标，不等于官方原生工具链。
- VS 2026 的 ARM64 C++ 组件是否齐全取决于 runner 镜像；缺 `Hostarm64\arm64\cl.exe`
  或 `vcvarsarm64.bat` 时构建会失败，workflow 不会降级成 x64。
- `audioplayers_windows`、`file_selector_windows`、`flutter_secure_storage_windows`
  等插件的 ARM64 编译/运行未逐一验证；它们大多从源码编译，但可能硬编码 x64。
- 3.50.1 与仓库代码/锁文件未做完整兼容性验证；该 workflow 只用于探测。
- **没有在 GitHub 托管 runner 上实跑过**。第一次运行可能失败；失败时不要把产物
  当正式 ARM64 发布。

### 3.4 手动复现（ARM64 Windows）

```powershell
flutter --version                 # 必须是 3.50.1
$env:FLUTTER_HOST_ARCH = 'arm64'
flutter precache --windows

cd apps/mobile
flutter create --platforms=windows --org cn.shanghaitech --project-name kedaya --no-pub .
flutter pub get --enforce-lockfile
flutter build windows --release
```

输出：`build\windows\arm64\runner\Release\kedaya.exe`。

检查 PE 架构（PowerShell）：

```powershell
$exe = 'build\windows\arm64\runner\Release\kedaya.exe'
$fs = [System.IO.File]::OpenRead((Resolve-Path $exe))
$br = New-Object System.IO.BinaryReader($fs)
try {
  $fs.Seek(0x3C, [System.IO.SeekOrigin]::Begin) | Out-Null
  $pe = $br.ReadInt32()
  $fs.Seek($pe + 4, [System.IO.SeekOrigin]::Begin) | Out-Null
  'PE machine=0x{0:X4} (expected 0xAA64)' -f $br.ReadUInt16()
} finally { $fs.Dispose() }
```

---

## 4. 已知限制

- 没有提交 `windows/` 原生目录；窗口标题、图标、DPI、深链、单实例等仍是模板默认。
- 未签名 + 未做安装器升级策略（AppId 固定，版本升级会覆盖安装）。
- 未做 Windows 服务/开机自启；不要把它当系统级客户端。
- CI 的 x64 job 是 Windows Server 2022；未验证 Windows 10/11 真机。
- `windows-2022` 也会随 runner-images 退役；升级前先查
  <https://github.com/actions/runner-images#available-images>，并重新核对 Flutter
  与 Visual Studio 的版本映射。
