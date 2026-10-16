import '../../domain/ports/media_picker_port.dart';

/// 内存选图实现 —— 让 mock 运行时（`flutter run` 的默认 flavor）
/// **不需要相册权限、不需要真机、也不会因为缺插件而崩**（契约 §7 硬规则 4）。
///
/// 它返回的是**一张真实的 1×1 PNG**（69 字节，含正确的文件头魔数），
/// 因此上传链路里的魔数嗅探（`looksLikeImage`）会正常通过 ——
/// 用假字节会让"选图 → 上传"这条链路在 mock 下走不到真实分支。
final class InMemoryMediaPicker implements MediaPickerPort {
  InMemoryMediaPicker({this.mode = InMemoryMediaPickerMode.onePhoto});

  /// 可运行时切换（演示"用户取消"与"选了非图片文件"两条路径）。
  InMemoryMediaPickerMode mode;

  int _sequence = 0;

  @override
  Future<List<PickedPhoto>> pickImages({int maxCount = 3}) async {
    switch (mode) {
      case InMemoryMediaPickerMode.none:
        // 用户取消：**空列表不是错误**。
        return const <PickedPhoto>[];
      case InMemoryMediaPickerMode.unsupportedFile:
        return <PickedPhoto>[
          PickedPhoto(
            bytes: _textFileBytes,
            fileName: 'not-an-image.txt',
            mimeType: 'text/plain',
          ),
        ];
      case InMemoryMediaPickerMode.onePhoto:
        return <PickedPhoto>[_nextPng()];
      case InMemoryMediaPickerMode.threePhotos:
        final int count = maxCount < 3 ? maxCount : 3;
        return <PickedPhoto>[for (int i = 0; i < count; i++) _nextPng()];
    }
  }

  PickedPhoto _nextPng() => PickedPhoto(
    bytes: mockPngBytes,
    fileName: 'mock-photo-${_sequence++}.png',
    mimeType: 'image/png',
    widthPx: 1,
    heightPx: 1,
  );
}

/// 选图行为（演示 / 测试用）。
enum InMemoryMediaPickerMode {
  /// 用户取消。
  none,

  /// 选一张。
  onePhoto,

  /// 选三张（上限）。
  threePhotos,

  /// 选了一个**不是图片**的文件（改扩展名的场景，规格 §11.5 T36）。
  unsupportedFile,
}

/// 一张真实的 1×1 PNG（69 字节）。
const List<int> mockPngBytes = <int>[
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, //
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, //
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, //
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, //
  0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, //
  0x54, 0x78, 0x9C, 0x63, 0xF8, 0xFF, 0xFF, 0x3F, //
  0x00, 0x05, 0xFE, 0x02, 0xFE, 0x0D, 0xEF, 0x46, //
  0xB8, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, //
  0x44, 0xAE, 0x42, 0x60, 0x82,
];

/// 一段文本（冒充图片）：用于验证魔数嗅探会拒绝它。
const List<int> _textFileBytes = <int>[
  0x68, 0x65, 0x6C, 0x6C, 0x6F, 0x20, 0x77, 0x6F, 0x72, 0x6C, 0x64, 0x21,
];
