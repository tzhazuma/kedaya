import '../../../domain/models/campus_card.dart';
import '../../../domain/models/result.dart';
import 'payment_code_channel.dart';

/// **正式通道的签发者**：只有拿到学校/校方书面授权的接口之后才可能存在实现。
///
/// 这是一个**空接口**：本仓库里没有任何实现，也**不允许**为了"先跑起来"
/// 写一个返回常量的实现 —— 那个常量就是假码
/// （见 `docs/features/techpie-native-payment-code.md` §5）。
///
/// 之所以把它单独抽出来：`available` 状态与"真的能签发出码"必须是**同一件事**。
/// 只把状态改成 `available` 而没有签发者，在类型上就走不通
/// （`GatedPaymentCodeChannel.official` 要求传入本接口的实例）。
abstract interface class PaymentCodeIssuer {
  /// 签发一个短时效付款码。实现**不得**缓存、落盘或写日志。
  Future<Result<CampusPaymentCode>> issue();
}

/// 原生端「校园卡付款码通道」的端口（**只做能力与状态建模，不含任何网络/DNS**）。
///
/// 与既有 `CampusCardPort.paymentCode()` 的分工（两者**不是**替代关系）：
///
/// | | `CampusCardPort.paymentCode()` | 本端口 |
/// | --- | --- | --- |
/// | 链路 | 经 `services/api` 中转的 OPENID 通道 | 原生端**直连**（TechPie 方案）的抽象 |
/// | 现状 | 已接线；服务端返回 503 `UPSTREAM_UNAVAILABLE` | **没有**任何实现 |
/// | 目的 | 产品功能 | 把"为什么现在不能做"变成**类型**，而不是注释 |
///
/// 三条硬边界：
///
/// 1. **不联网**。本端口的方法**不得**发起 HTTP/DNS/隧道操作；本仓库里的实现
///    只是在本地读写一个状态值。
/// 2. **不返回假码**。被阻塞时返回 `Err(ApiError)`（结构化错误），
///    `Ok` 只有一个来源：注入的 [PaymentCodeIssuer]。
/// 3. **不落盘**。付款码是短时效支付凭据（规格 §10.3），实现不得持有它的字段。
abstract interface class PaymentCodeChannelPort {
  /// 通道状态（纯本地判定，不触发任何 IO）。
  PaymentCodeChannel get channel;

  /// 取付款码。
  ///
  /// 在 [PaymentCodeChannelState.notConfigured] 与
  /// [PaymentCodeChannelState.requiresBinding] 下**必须**返回结构化错误
  /// （`UPSTREAM_UNAVAILABLE` / `CAMPUS_BINDING_REQUIRED`），
  /// 且 `Result.valueOrNull` 必须为 null。
  Future<Result<CampusPaymentCode>> issuePaymentCode();
}

/// 带**状态闸门**的通道实现：被阻塞时只返回结构化错误，绝不返回假码。
///
/// 构造方式是封闭的（三个具名工厂），因此下面这些错误写法在类型/编译期就做不到：
///
///   - 凭空说"可用"：`PaymentCodeChannel.available` 不经过
///     [GatedPaymentCodeChannel.official] 拿不到签发者；
///   - 被阻塞时给一个码：唯一的 `Ok` 路径是 `_issuer.issue()`；
///   - 把状态当成可随意修改的字段：`channel` 只有 getter，没有 setter。
///
/// 本类**不持有**付款码、不缓存、不写日志、不 import 任何 IO 库
/// （`test/domain/payment_code_channel_test.dart` 有源码扫描兜底）。
final class GatedPaymentCodeChannel implements PaymentCodeChannelPort {
  const GatedPaymentCodeChannel._(this.channel, this._issuer);

  /// 学校接口未申请/未接通（**默认**用法）。
  factory GatedPaymentCodeChannel.notConfigured({
    String reason = paymentCodeNotWiredReason,
    List<String> blockedBy = paymentCodeBlockedBy,
  }) =>
      GatedPaymentCodeChannel._(
        PaymentCodeChannel.notConfigured(
          reason: reason,
          blockedBy: blockedBy,
        ),
        null,
      );

  /// 已登录但没开通校园卡（OPENID 通道）。
  factory GatedPaymentCodeChannel.requiresBinding() =>
      const GatedPaymentCodeChannel._(
        PaymentCodeChannel.requiresBinding(),
        null,
      );

  /// 正式通道：**必须**注入签发者。本仓库没有任何调用点。
  ///
  /// ⚠️ 生产装配里**不应**存在这个调用 —— 一旦出现，就说明我们真的在
  /// 直连学校系统发付款码了，那需要先解决
  /// `docs/features/techpie-native-payment-code.md` §4 的合规问题。
  factory GatedPaymentCodeChannel.official({
    required PaymentCodeIssuer issuer,
  }) =>
      GatedPaymentCodeChannel._(
        const PaymentCodeChannel.available(),
        issuer,
      );

  @override
  final PaymentCodeChannel channel;

  /// 只有 [GatedPaymentCodeChannel.official] 会传入非 null。
  final PaymentCodeIssuer? _issuer;

  @override
  Future<Result<CampusPaymentCode>> issuePaymentCode() async {
    if (!channel.isUsable) {
      // 唯一的失败路径：把状态原样变成结构化错误。
      return Err<CampusPaymentCode>(channel.toApiError());
    }

    final PaymentCodeIssuer? issuer = _issuer;
    if (issuer == null) {
      // 理论上不可达（`official` 要求非 null）；真到了这里也**不造假码**。
      return Err<CampusPaymentCode>(
        PaymentCodeChannel.notConfigured(
          reason: paymentCodeIssuerMissingReason,
          blockedBy: const <String>[],
        ).toApiError(),
      );
    }

    final Result<CampusPaymentCode> issued = await issuer.issue();
    final CampusPaymentCode? code = issued.valueOrNull;
    if (code == null) return issued;

    // 上游给了空码：当成失败。空串画出来的"条码"扫不出任何东西，
    // 让用户以为自己拿到了码，比直接报错更糟。
    if (code.code.trim().isEmpty) {
      return Err<CampusPaymentCode>(
        PaymentCodeChannel.notConfigured(
          reason: paymentCodeEmptyReason,
          blockedBy: const <String>[],
        ).toApiError(),
      );
    }
    return Ok<CampusPaymentCode>(code);
  }
}
