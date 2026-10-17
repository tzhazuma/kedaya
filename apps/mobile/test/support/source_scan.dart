import 'dart:io';

/// 源码机械扫描的共享工具（**只给测试用**）。
///
/// 本机没有 Flutter SDK，跑不了 `dart analyze`，因此"源码层面不许出现 X"
/// 这类不变式只能靠文本扫描来守。工具集中在这里，避免每个测试各写一份
/// 略有差异的实现（那种差异会让不变式悄悄失效）。

/// 包根目录（`apps/mobile/`）。
///
/// `flutter test` 的工作目录是包根，但为了在别的调用方式下也能跑，
/// 这里做一次向上/向下的探测。
Directory packageRoot() {
  final Directory cwd = Directory.current;
  if (Directory('${cwd.path}/lib').existsSync()) return cwd;
  final Directory nested = Directory('${cwd.path}/apps/mobile');
  if (Directory('${nested.path}/lib').existsSync()) return nested;
  throw StateError('找不到 lib/ 目录：cwd=${cwd.path}');
}

/// 读一个相对包根的源文件。
String readSource(String relativePath) =>
    File('${packageRoot().path}/$relativePath').readAsStringSync();

/// 递归列出某个相对目录下的全部 `.dart` 文件（相对路径，已排序）。
List<String> dartSourcesUnder(String relativeDir) {
  final Directory root = packageRoot();
  final Directory dir = Directory('${root.path}/$relativeDir');
  if (!dir.existsSync()) return const <String>[];
  final List<String> out = <String>[];
  for (final FileSystemEntity entity in dir.listSync(recursive: true)) {
    if (entity is! File || !entity.path.endsWith('.dart')) continue;
    out.add(entity.path.substring(root.path.length + 1));
  }
  out.sort();
  return out;
}

/// 源文件里的 import/export 目标（原样字符串）。
List<String> importTargets(String source) {
  final RegExp pattern = RegExp(
    r"""^\s*(?:import|export)\s+['"]([^'"]+)['"]""",
    multiLine: true,
  );
  return pattern
      .allMatches(source)
      .map((RegExpMatch match) => match.group(1)!)
      .toList(growable: false);
}

/// 源文件是否 import/export 了某个路径片段（例如 `auth_port.dart`）。
bool importsFragment(String source, String fragment) =>
    importTargets(source).any((String target) => target.contains(fragment));

/// 某个类的**实例字段名**集合。
///
/// 只用于"这个上抛对象的字段集合是封闭的"这类断言（例如
/// `WebViewLaunchOutcome` 不得出现票据 / URL 字段）。
Set<String> fieldNamesOf(String source, String className) {
  final String marker = 'class $className';
  final int start = source.indexOf(marker);
  if (start < 0) throw StateError('源码里找不到 class $className');
  final int end = source.indexOf('\n}\n', start);
  final String body = end < 0 ? source.substring(start) : source.substring(start, end);
  final RegExp field = RegExp(
    r'^\s*final\s+.*?\s+(\w+)\s*;$',
    multiLine: true,
  );
  return field
      .allMatches(body)
      .map((RegExpMatch match) => match.group(1)!)
      .toSet();
}

/// 去掉注释后的源码（字符串字面量保留）——用于"代码里不许出现 X"的扫描，
/// 避免文档注释里为了解释"为什么不这么做"而提到 X 造成误报。
String stripComments(String source) {
  final StringBuffer out = StringBuffer();
  int index = 0;
  while (index < source.length) {
    final String rest = source.substring(index);
    if (rest.startsWith('//')) {
      final int newline = source.indexOf('\n', index);
      index = newline < 0 ? source.length : newline;
      continue;
    }
    if (rest.startsWith('/*')) {
      final int close = source.indexOf('*/', index + 2);
      index = close < 0 ? source.length : close + 2;
      continue;
    }
    out.write(source[index]);
    index++;
  }
  return out.toString();
}
