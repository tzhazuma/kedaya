/// 相册 / 相机选图端口（`platform/` 提供实现）。
///
/// 为什么是端口而不是在页面里直接调 `image_picker`：
///   1. 冻结契约 §7 硬规则 3 —— UI 不直接接触平台能力；
///   2. **mock 运行时必须能跑**（契约 §7 硬规则 4）：`flutter run` 的默认
///      flavor 是 mock，此时不应该弹真实相册，也不该因为缺插件而崩。
library;

/// 一张已选中的照片。
///
/// `domain` 层只允许 `dart:core`（冻结契约 §7 硬规则 1），因此字节用
/// `List<int>` 而不是 `Uint8List`（后者需要 `dart:typed_data`）。
final class PickedPhoto {
  const PickedPhoto({
    required this.bytes,
    this.fileName,
    this.mimeType,
    this.widthPx,
    this.heightPx,
  });

  final List<int> bytes;
  final String? fileName;
  final String? mimeType;
  final int? widthPx;
  final int? heightPx;

  int get byteSize => bytes.length;

  @override
  String toString() => 'PickedPhoto($fileName, $byteSize bytes)';
}

abstract interface class MediaPickerPort {
  /// 选择最多 [maxCount] 张图片。
  ///
  /// **用户取消返回空列表，不是错误**（取消是正常操作，不该弹错）。
  /// 平台插件异常（权限被拒 / 无相册）也收敛为空列表，由 UI 决定是否提示。
  Future<List<PickedPhoto>> pickImages({int maxCount = 3});
}
