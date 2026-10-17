import 'package:flutter/services.dart';

import '../domain/ports/platform_ports.dart';

/// [SharePort] 的剪贴板实现。
///
/// **为什么不是系统分享面板**：骨架阶段不引入额外的原生依赖（`share_plus`），
/// 而 `SharePort` 的语义必须现在就成立。本实现是**真实可用**的降级路径：
/// 文本/链接会进入系统剪贴板，用户可自行粘贴到任意 App。
/// 接入 `share_plus` 时只需替换本文件，端口与调用方不动。
final class ClipboardSharePort implements SharePort {
  const ClipboardSharePort();

  @override
  Future<void> shareText(String text, {String? subject}) => copyToClipboard(text);

  @override
  Future<void> shareLink(Uri uri, {String? title}) => copyToClipboard(
    title == null ? uri.toString() : '$title ${uri.toString()}',
  );

  @override
  Future<void> copyToClipboard(String text) =>
      Clipboard.setData(ClipboardData(text: text));
}
