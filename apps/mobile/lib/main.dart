import 'app/bootstrap.dart';

/// 可达鸭 · Flutter 原生端入口（iOS / Android / 鸿蒙）。
///
/// 启动时序**只**在 `app/bootstrap.dart` 里实现（冻结契约 §8），
/// 本文件刻意保持为空壳，避免出现第二份启动逻辑。
Future<void> main() async {
  await bootstrap();
}
