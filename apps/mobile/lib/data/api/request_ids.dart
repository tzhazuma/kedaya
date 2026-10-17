import 'dart:math';

final Random _random = Random();

/// 请求级随机标识（追踪 / 幂等共用同一策略）。
///
/// 不使用 UUID 包：这里只要求"碰撞概率足够低 + 可读"，不要求密码学强度。
String newRequestId(String prefix) {
  final String time = DateTime.now().toUtc().microsecondsSinceEpoch.toRadixString(36);
  final String random = _random.nextInt(0x7fffffff).toRadixString(36);
  return '$prefix-$time-$random';
}

/// `X-KedaYa-Trace` 的默认生成器（契约 §6.1）。
String defaultTraceIdFactory() => newRequestId('kdy');

/// `Idempotency-Key` 的默认生成器（契约 §6.1：写操作支持幂等）。
String newIdempotencyKey() => newRequestId('idem');
