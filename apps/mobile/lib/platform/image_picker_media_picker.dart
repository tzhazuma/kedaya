import 'package:image_picker/image_picker.dart';

import '../domain/ports/media_picker_port.dart';

/// [MediaPickerPort] 的真实实现（相册 / 相机）。
///
/// 只在**非 mock** 运行时装配：mock 运行时用 `InMemoryMediaPicker`，
/// 因此 `git clone` 之后 `flutter run` 不会弹相册、也不需要权限
/// （契约 §7 硬规则 4）。
///
/// 与规格 §4.2 的客户端参数对齐：
///   - `count` ≤ 3（契约 `photoUrls` ≤3）；
///   - `imageQuality: 85` 让平台先压一次（目标 ≤1 MB，减少上传失败率）；
///   - 只收图片（`pickMultiImage` 本身只返回图片）；
///   - **不做** EXIF 处理：剥离是**服务端**的硬要求（规格 §4.3），
///     客户端处理会被绕过，因此这里刻意什么都不做。
///
/// 任何异常（用户取消 / 相册权限被拒 / 插件缺失）都收敛为**空列表** ——
/// 取消不是错误，不该弹错（端口契约，见 `MediaPickerPort`）。
final class ImagePickerMediaPicker implements MediaPickerPort {
  ImagePickerMediaPicker({ImagePicker? picker})
      : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  @override
  Future<List<PickedPhoto>> pickImages({int maxCount = 3}) async {
    final int limit = maxCount < 1 ? 1 : maxCount;
    try {
      final List<XFile> files = await _picker.pickMultiImage(
        imageQuality: 85,
        limit: limit,
      );
      final List<PickedPhoto> photos = <PickedPhoto>[];
      for (final XFile file in files) {
        final List<int> bytes = await file.readAsBytes();
        photos.add(
          PickedPhoto(
            bytes: bytes,
            fileName: file.name,
            mimeType: file.mimeType,
          ),
        );
      }
      return photos;
    } on Object {
      // 取消 / 权限被拒 / 无相册实现：统一当作"没有选到照片"。
      return const <PickedPhoto>[];
    }
  }
}
