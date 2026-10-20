import '../../../domain/models/api_error.dart';

/// 原生端「校园卡付款码通道」的**三态**（评估文档：
/// `docs/features/techpie-native-payment-code.md`）。
///
/// 这三态是**通道**的状态，不是一次请求的状态。一次网络失败（超时、502、
/// 限流）不改变本枚举 —— 否则"暂时取不到码"会被误显示成"学校没给接口"，
/// 反过来也一样糟。
///
/// ⚠️ 只有 [available] 允许签发付款码，而它**只可能**在拿到学校正式接口后为真：
///
/// | 状态 | 含义 | 出路 |
/// | --- | --- | --- |
/// | [notConfigured] | 学校接口未申请/未打通 | 去申请（信息办 / 校园卡中心），或走官方页面 |
/// | [requiresBinding] | 已登录，但没开通校园卡（OPENID 通道） | 去开通 |
/// | [available] | 正式通道已打通 | 取码（短时效、不缓存、不落盘） |
///
/// 本枚举刻意**没有** `unauthenticated`：那是**一级身份**的问题
/// （`AuthPort`），与"通道"是两件事（契约 §5 两级身份边界）。
enum PaymentCodeChannelState {
  notConfigured(
    'NOT_CONFIGURED',
    '通道未配置',
    '学校尚未提供校园卡付款码的正式接口。可达鸭不自建通道、不返回假码 ——'
        '在书面授权与正式接口到位之前，这个能力不可能变成「可用」。',
  ),
  requiresBinding(
    'REQUIRES_BINDING',
    '需要开通校园卡',
    '你已登录，但还没有开通校园卡（eCard 的 OPENID 通道）。开通后回到这里取码。',
  ),
  available(
    'AVAILABLE',
    '通道已可用',
    '正式接口已打通。付款码仍然只取一次、不缓存、不落盘，离开页面即丢弃。',
  );

  const PaymentCodeChannelState(this.wire, this.label, this.guidance);

  /// 线上标识（与 `details.state` 同名）。
  final String wire;

  /// 面向用户的短标签（不是错误信息）。
  final String label;

  /// 用户视角的出路说明。
  final String guidance;

  /// 未知取值收敛为 [notConfigured] —— **fail-closed**：
  /// 宁可让用户看到"通道未配置"，也绝不把不认识的状态当作"可用"。
  static PaymentCodeChannelState fromWire(String wire) {
    final String normalized = wire.trim().toUpperCase();
    for (final PaymentCodeChannelState state
        in PaymentCodeChannelState.values) {
      if (state.wire == normalized) return state;
    }
    return PaymentCodeChannelState.notConfigured;
  }

  /// 现在就能签发付款码。
  bool get isUsable => this == PaymentCodeChannelState.available;
}

/// `notConfigured` 的结构化原因 —— 与 `services/api` 的
/// `campus-card.service.ts` 里 `details.reason` **逐字一致**。
///
/// 服务端在真实通道未接通时返回 `503 UPSTREAM_UNAVAILABLE` +
/// `{reason: 'CAMPUS_CARD_PAYMENT_CODE_NOT_WIRED', upstreamReady: false}`；
/// 客户端按同一个字符串回填，因此"服务端说没接通"与"客户端认为没配置"
/// 是**同一个**状态，不会出现两套说法。
const String paymentCodeNotWiredReason = 'CAMPUS_CARD_PAYMENT_CODE_NOT_WIRED';

/// 正式通道返回了空码 —— 当作失败。宁可让用户重试，也不把空串画成条码。
const String paymentCodeEmptyReason = 'UPSTREAM_RETURNED_EMPTY_CODE';

/// `available` 却没有正式签发者（只可能来自装配错误）。
const String paymentCodeIssuerMissingReason = 'PAYMENT_CODE_ISSUER_MISSING';

/// 该能力当前的阻塞项（契约 §11.21-B 的 `details.blockedBy`）：
/// `U7` = 信息办 / 校方书面答复；`U11` = 校园域名白名单内容未关闭。
///
/// 这里只是**服务器那串值的客户端镜像**（`paymentCodeNotWiredReason` 同一来源），
/// 不新增任何契约未登记的错误码。
const List<String> paymentCodeBlockedBy = <String>['U7', 'U11'];

/// 付款码通道的描述（**纯值对象**，不含任何凭据）。
///
/// 它只有状态、原因与阻塞项 —— 没有 token、没有 URL、没有码。
/// 因此它可以安全地进 UI 状态，也可以被序列化进日志诊断字段（只含枚举与常量）。
final class PaymentCodeChannel {
  /// 学校接口未申请 / 未打通。**默认状态**：没有显式证据时一律用这个。
  const PaymentCodeChannel.notConfigured({
    this.reason = paymentCodeNotWiredReason,
    this.blockedBy = paymentCodeBlockedBy,
    this.upstreamReady = false,
  }) : state = PaymentCodeChannelState.notConfigured;

  /// 已登录，但 eCard 绑定缺失/过期（服务端是 **409 `CAMPUS_BINDING_REQUIRED`**，
  /// 不是 401 —— 用户可能已经登录，缺的只是开通校园卡）。
  const PaymentCodeChannel.requiresBinding()
      : state = PaymentCodeChannelState.requiresBinding,
        reason = 'CAMPUS_BINDING_REQUIRED',
        blockedBy = const <String>[],
        upstreamReady = false;

  /// 正式接口已打通。**只能**由真实签发的适配器构造（见 `payment_code_port.dart`
  /// 的 `GatedPaymentCodeChannel.official`），本仓库里没有任何地方构造它。
  const PaymentCodeChannel.available()
      : state = PaymentCodeChannelState.available,
        reason = null,
        blockedBy = const <String>[],
        upstreamReady = true;

  final PaymentCodeChannelState state;

  /// 结构化原因（`details.reason`）；`available` 时为 null。
  final String? reason;

  /// 阻塞项（`details.blockedBy`）；通常为空。
  final List<String> blockedBy;

  /// 上游是否**真的**接通了（`details.upstreamReady`）。
  ///
  /// 这个布尔是服务端给出的机器可读事实；`false` 时 UI 可以直接说
  /// "不是网络问题，是接口没打通"，而不是让用户反复重试。
  final bool upstreamReady;

  bool get isUsable => state.isUsable;

  /// 从一次**服务端错误**还原通道状态；返回 null 表示"这个错误不表达通道状态"。
  ///
  /// 映射规则（只用冻结的错误码，不新增）：
  ///
  /// | 错误 | 结论 |
  /// | --- | --- |
  /// | `CAMPUS_BINDING_REQUIRED`(409) | [PaymentCodeChannelState.requiresBinding] |
  /// | `UPSTREAM_UNAVAILABLE`(503) + `upstreamReady: false` | [PaymentCodeChannelState.notConfigured] |
  /// | `UPSTREAM_UNAVAILABLE`(503) 但 `upstreamReady: true` | **null** —— 通道是通的，只是这次调用失败 |
  /// | 其它（401 / 429 / 500 …） | **null** —— 不属于通道三态（401 是一级身份的问题） |
  ///
  /// 未知错误码绝不映射成 `available` —— 这是"不谎称可用"的最后一道闸。
  static PaymentCodeChannel? tryFromApiError(ApiError error) {
    switch (error.code) {
      case ApiErrorCode.campusBindingRequired:
        return const PaymentCodeChannel.requiresBinding();
      case ApiErrorCode.upstreamUnavailable:
        final bool? ready = _upstreamReadyOf(error);
        if (ready == true) return null;
        return PaymentCodeChannel.notConfigured(
          reason: _reasonOf(error) ?? paymentCodeNotWiredReason,
          blockedBy: _blockedByOf(error),
          upstreamReady: false,
        );
      case ApiErrorCode.unauthenticated:
      case ApiErrorCode.forbidden:
      case ApiErrorCode.notFound:
      case ApiErrorCode.validationFailed:
      case ApiErrorCode.rateLimited:
      case ApiErrorCode.conflict:
      case ApiErrorCode.consentRequired:
      case ApiErrorCode.internal:
        return null;
    }
  }

  /// 把通道状态变成**结构化错误**（`ApiError` + `details`）。
  ///
  /// ⚠️ 只有被阻塞的状态才有错误可表达；[PaymentCodeChannelState.available]
  /// 调用本方法是**编程错误**（会抛 [StateError]），不是运行时条件。
  ApiError toApiError() {
    switch (state) {
      case PaymentCodeChannelState.notConfigured:
        return ApiError(
          code: ApiErrorCode.upstreamUnavailable,
          message: '校园卡付款码通道尚未打通（学校正式接口未申请/未接通）。'
              '可达鸭不会返回一个假的付款码。',
          details: <String, Object?>{
            'reason': reason ?? paymentCodeNotWiredReason,
            'upstreamReady': false,
            if (blockedBy.isNotEmpty) 'blockedBy': blockedBy,
          },
        );
      case PaymentCodeChannelState.requiresBinding:
        return const ApiError(
          code: ApiErrorCode.campusBindingRequired,
          message: '请先开通校园卡（OPENID 通道）后再取付款码',
          details: <String, Object?>{
            'reason': 'CAMPUS_BINDING_REQUIRED',
            'upstreamReady': false,
          },
        );
      case PaymentCodeChannelState.available:
        throw StateError('通道可用时没有结构化错误可返回（不要用它表达成功）');
    }
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'state': state.wire,
        'reason': reason,
        'blockedBy': blockedBy,
        'upstreamReady': upstreamReady,
      };

  @override
  bool operator ==(Object other) =>
      other is PaymentCodeChannel &&
      other.state == state &&
      other.reason == reason &&
      other.upstreamReady == upstreamReady &&
      _sameList(other.blockedBy, blockedBy);

  @override
  int get hashCode =>
      Object.hash(state, reason, upstreamReady, Object.hashAll(blockedBy));

  @override
  String toString() => 'PaymentCodeChannel(${state.wire}, reason=$reason, '
      'upstreamReady=$upstreamReady)';
}

bool _sameList(List<String> a, List<String> b) {
  if (a.length != b.length) return false;
  for (int index = 0; index < a.length; index++) {
    if (a[index] != b[index]) return false;
  }
  return true;
}

String? _reasonOf(ApiError error) {
  final Object? details = error.details;
  if (details is Map<String, Object?>) {
    final Object? reason = details['reason'];
    if (reason is String && reason.isNotEmpty) return reason;
  }
  return null;
}

bool? _upstreamReadyOf(ApiError error) {
  final Object? details = error.details;
  if (details is Map<String, Object?>) {
    final Object? ready = details['upstreamReady'];
    if (ready is bool) return ready;
  }
  return null;
}

List<String> _blockedByOf(ApiError error) {
  final Object? details = error.details;
  if (details is Map<String, Object?>) {
    final Object? blocked = details['blockedBy'];
    if (blocked is List<Object?>) {
      return blocked.whereType<String>().toList(growable: false);
    }
  }
  return const <String>[];
}
