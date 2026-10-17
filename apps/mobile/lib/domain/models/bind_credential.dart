/// 发起绑定时可用的凭据形态（`POST /api/v1/techpie/links`，规格 §8.5）。
///
/// ⚠️ **刻意没有"明文口令"变体**。
///
/// 契约 §11.18-D（对应未决问题 U12）已经裁决：
/// 「绑定时接受明文密码**风险极高**。若学校提供 OAuth/扫码/SMS，**必须优先**。
/// 在信息办回复前，Phase 1 的绑定流程**不实现**。」
///
/// 因此 Phase 0 只提供两条**不接触用户口令**的通道：
///
/// | 子类 | 通道 | 依据 |
/// | --- | --- | --- |
/// | [OAuthCodeCredential] | 校园系统授权码 | 规格 §8.5 的硬要求（优先免密码方式） |
/// | [OpenIdCredential] | 校园卡的独立 OPENID 通道 | 规格 §2.5 |
///
/// 因为 [BindCredential] 是 `sealed` 且**只有这两个子类**，
/// 「写一条明文口令绑定路径」在**类型上**就做不到 —— 这是结构性约束，
/// 不是靠注释提醒（ADR §2.2 的教训 L2/L3）。
sealed class BindCredential {
  const BindCredential();

  /// 可安全写进日志 / 错误信息 / UI 的形态描述。
  ///
  /// **实现里绝不包含凭据值** —— 这是"凭证绝不进日志"（规格 §10.3）的落点。
  String get redactedLabel;

  /// 请求体里的 `credential` 对象。
  ///
  /// ⚠️ 唯一允许的用途是交给网络层（`data/repositories/`）。
  /// 调用方**不得**把它写进日志、错误信息或本地存储。
  Map<String, Object?> toWire();

  /// 凭据是否形态完整（空值在发请求前就该被拦下）。
  bool get isWellFormed;
}

/// 校园系统**授权码**（免密码通道，规格 §8.5 优先项）。
///
/// 授权码只在 `TechpiePort.bind()` 的入参里出现一次；换到会话后由服务端处理，
/// 客户端**不留存**。
final class OAuthCodeCredential extends BindCredential {
  const OAuthCodeCredential({required this.code});

  /// 线上 `credential.kind` 取值。
  static const String kind = 'oauth_code';

  final String code;

  @override
  String get redactedLabel => '授权码（免密码通道，已脱敏）';

  @override
  bool get isWellFormed => code.trim().isNotEmpty;

  @override
  Map<String, Object?> toWire() => <String, Object?>{
    'kind': kind,
    'code': code,
  };

  /// ⚠️ 不打 [code]。
  @override
  String toString() => 'OAuthCodeCredential(<redacted>)';
}

/// 校园卡的 **OPENID** 通道凭据（规格 §2.5：校园卡不依赖校园会话代持）。
///
/// OPENID 由 eCard 官方授权流程产出，客户端只转手一次。
final class OpenIdCredential extends BindCredential {
  const OpenIdCredential({required this.openId, this.channel = defaultChannel});

  /// 线上 `credential.kind` 取值。
  static const String kind = 'openid';

  /// 默认通道（规格 §2.5 的 `EcardOpenIdChannel.wechat`）。
  static const String defaultChannel = 'wechat';

  final String openId;
  final String channel;

  @override
  String get redactedLabel => 'OPENID 通道（$channel，已脱敏）';

  @override
  bool get isWellFormed => openId.trim().isNotEmpty && channel.trim().isNotEmpty;

  @override
  Map<String, Object?> toWire() => <String, Object?>{
    'kind': kind,
    'openId': openId,
    'channel': channel,
  };

  /// ⚠️ 不打 [openId]。
  @override
  String toString() => 'OpenIdCredential(channel=$channel, openId=<redacted>)';
}
