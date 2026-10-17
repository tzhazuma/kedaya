import 'json_read.dart';

/// 校园卡绑定状态（**独立 OPENID 通道**，规格 §2.5）。
///
/// 与校园会话代持链路**无关**：校园卡不依赖 CASTGC，因此这条通道零合规风险，
/// 可以在"不代持任何校园会话"的前提下独立落地。
enum CampusCardLinkState {
  unlinked('UNLINKED'),
  linked('LINKED'),
  expired('EXPIRED');

  const CampusCardLinkState(this.wire);

  final String wire;

  static CampusCardLinkState fromWire(String wire) {
    final String normalized = wire.trim().toUpperCase();
    for (final CampusCardLinkState state in CampusCardLinkState.values) {
      if (state.wire == normalized) return state;
    }
    // 未知取值按**最保守**处理：当作未绑定，绝不当作可用。
    return CampusCardLinkState.unlinked;
  }

  bool get isUsable => this == CampusCardLinkState.linked;

  /// 曾经绑定过、现在要重新绑定 —— 与"从未绑定"是两种不同的引导。
  bool get needsRebind => this == CampusCardLinkState.expired;

  String get label => switch (this) {
        CampusCardLinkState.unlinked => '未开通',
        CampusCardLinkState.linked => '已开通',
        CampusCardLinkState.expired => '已过期',
      };
}

/// 校园卡绑定元数据。
///
/// ⚠️ **OPENID 本身不在这里**：它只在 `CampusCardPort.connect(openId:)` 的入参里
/// 出现一次，之后由服务端保管。客户端只拿到一个**脱敏尾巴**用于让用户确认
/// "绑的是哪一张卡"，而不是拿到可复用的标识符。
final class CampusCardLink {
  const CampusCardLink({
    required this.state,
    this.channel,
    this.openIdTail,
    this.linkedAt,
    this.expiresAt,
  });

  factory CampusCardLink.fromJson(Map<String, Object?> json) => CampusCardLink(
        state: CampusCardLinkState.fromWire(
            readStringOr(json, 'state', 'UNLINKED')),
        channel: readStringOrNull(json, 'channel'),
        openIdTail: readStringOrNull(json, 'openIdTail'),
        linkedAt: readDateTimeOrNull(json, 'linkedAt'),
        expiresAt: readDateTimeOrNull(json, 'expiresAt'),
      );

  final CampusCardLinkState state;

  /// 绑定通道（`wechat` 等）。
  final String? channel;

  /// OPENID 的**末 4 位**（形如 `****a1b2`）。
  final String? openIdTail;

  final DateTime? linkedAt;
  final DateTime? expiresAt;

  bool isUsableAt(DateTime now) =>
      state.isUsable && (expiresAt == null || expiresAt!.isAfter(now.toUtc()));

  /// 唯一的脱敏实现 —— 各处不要再自己截字符串。
  static String tailOf(String openId) {
    final String trimmed = openId.trim();
    if (trimmed.length <= 4) return '****';
    return '****${trimmed.substring(trimmed.length - 4)}';
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'state': state.wire,
        'channel': channel,
        'openIdTail': openIdTail,
        'linkedAt': linkedAt == null ? null : isoUtc(linkedAt!),
        'expiresAt': expiresAt == null ? null : isoUtc(expiresAt!),
      };

  @override
  bool operator ==(Object other) =>
      other is CampusCardLink &&
      other.state == state &&
      other.channel == channel &&
      other.openIdTail == openIdTail &&
      other.linkedAt == linkedAt &&
      other.expiresAt == expiresAt;

  @override
  int get hashCode =>
      Object.hash(state, channel, openIdTail, linkedAt, expiresAt);

  @override
  String toString() =>
      'CampusCardLink(${state.wire}, channel=$channel, openIdTail=$openIdTail)';
}

/// 校园卡账户（余额）。
///
/// 金额一律**整数分**（契约 §6.1）；展示层用 `Money.fenToYuan` 转元。
final class CampusCardAccount {
  const CampusCardAccount({
    required this.holderName,
    required this.cardNumberMasked,
    required this.balanceFen,
    required this.updatedAt,
  });

  factory CampusCardAccount.fromJson(Map<String, Object?> json) =>
      CampusCardAccount(
        holderName: readString(json, 'holderName'),
        cardNumberMasked: readString(json, 'cardNumberMasked'),
        balanceFen: readInt(json, 'balanceFen'),
        updatedAt: readDateTime(json, 'updatedAt'),
      );

  /// 持卡人姓名（校园卡场景下展示姓名是必要信息）。
  final String holderName;

  /// **已脱敏**的卡号（服务端就该这么下发；[maskCardNumber] 是本地兜底）。
  final String cardNumberMasked;

  final int balanceFen;
  final DateTime updatedAt;

  /// 本地兜底脱敏：只保留末 4 位。服务端若误发完整卡号，这里也不会把它带上屏。
  static String maskCardNumber(String raw) {
    final String trimmed = raw.trim();
    if (trimmed.length <= 4) return '****';
    return '**** **** **** ${trimmed.substring(trimmed.length - 4)}';
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'holderName': holderName,
        'cardNumberMasked': cardNumberMasked,
        'balanceFen': balanceFen,
        'updatedAt': isoUtc(updatedAt),
      };

  @override
  bool operator ==(Object other) =>
      other is CampusCardAccount &&
      other.holderName == holderName &&
      other.cardNumberMasked == cardNumberMasked &&
      other.balanceFen == balanceFen &&
      other.updatedAt == updatedAt;

  @override
  int get hashCode =>
      Object.hash(holderName, cardNumberMasked, balanceFen, updatedAt);

  @override
  String toString() =>
      'CampusCardAccount($cardNumberMasked, balanceFen=$balanceFen)';
}

/// 一笔流水的方向。
enum CampusCardTransactionDirection {
  debit('DEBIT'),
  credit('CREDIT');

  const CampusCardTransactionDirection(this.wire);

  final String wire;

  /// 接受 `DEBIT`/`CREDIT`，也接受 `services/api` 脚手架用的 `out`/`in`。
  ///
  /// 未知方向按支出处理（展示为负数）：宁可让用户以为花得多一点，
  /// 也不要把一笔支出显示成收入。
  static CampusCardTransactionDirection fromWire(String wire) {
    final String key = wire.trim().toUpperCase();
    if (key == 'CREDIT' || key == 'IN' || key == 'INCOME') {
      return CampusCardTransactionDirection.credit;
    }
    return CampusCardTransactionDirection.debit;
  }

  String get label =>
      this == CampusCardTransactionDirection.debit ? '支出' : '充值';
}

/// 一笔校园卡流水。
final class CampusCardTransaction {
  const CampusCardTransaction({
    required this.id,
    required this.merchant,
    required this.amountFen,
    required this.direction,
    required this.occurredAt,
    this.balanceAfterFen,
  });

  factory CampusCardTransaction.fromJson(Map<String, Object?> json) =>
      CampusCardTransaction(
        id: readString(json, 'id'),
        merchant: readString(json, 'merchant'),
        amountFen: readInt(json, 'amountFen'),
        direction: CampusCardTransactionDirection.fromWire(
          readStringOr(json, 'direction', 'DEBIT'),
        ),
        // 时间字段名两端不一致（本端 `occurredAt`，脚手架用 `happenedAt`）→ 两种都接受。
        occurredAt: readDateTimeOrNull(json, 'occurredAt') ??
            readDateTime(json, 'happenedAt'),
        balanceAfterFen: readIntOrNull(json, 'balanceAfterFen'),
      );

  final String id;
  final String merchant;

  /// **正数**金额（方向由 [direction] 表达）。
  final int amountFen;

  final CampusCardTransactionDirection direction;
  final DateTime occurredAt;
  final int? balanceAfterFen;

  /// 带符号分值：支出为负（展示层用 `Money.fenToSignedYuan`）。
  int get signedAmountFen => direction == CampusCardTransactionDirection.debit
      ? -amountFen
      : amountFen;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'merchant': merchant,
        'amountFen': amountFen,
        'direction': direction.wire,
        'occurredAt': isoUtc(occurredAt),
        'balanceAfterFen': balanceAfterFen,
      };

  @override
  bool operator ==(Object other) =>
      other is CampusCardTransaction &&
      other.id == id &&
      other.merchant == merchant &&
      other.amountFen == amountFen &&
      other.direction == direction &&
      other.occurredAt == occurredAt &&
      other.balanceAfterFen == balanceAfterFen;

  @override
  int get hashCode => Object.hash(
      id, merchant, amountFen, direction, occurredAt, balanceAfterFen);

  @override
  String toString() =>
      'CampusCardTransaction($id, ${direction.wire}, amountFen=$amountFen)';
}

/// 付款码（校园卡的动态条码）。
///
/// ⚠️ 它是一个**短时效的支付凭据**，因此：
///   - [toString] **必须脱敏**（否则一行日志就把付款码写进了日志，违反规格 §10.3）；
///   - **绝不落盘、绝不缓存**（`test/domain/techpie_source_invariants_test.dart`
///     机械扫描 techpie 源码里不存在任何持久化调用）；
///   - 只在付款码页面**可见期间**存活，离开页面即丢弃。
final class CampusPaymentCode {
  const CampusPaymentCode({
    required this.code,
    required this.expiresAt,
    this.refreshAfterSec,
  });

  factory CampusPaymentCode.fromJson(Map<String, Object?> json) =>
      CampusPaymentCode(
        code: readString(json, 'code'),
        expiresAt: readDateTime(json, 'expiresAt'),
        refreshAfterSec: readIntOrNull(json, 'refreshAfterSec'),
      );

  final String code;
  final DateTime expiresAt;

  /// 建议刷新间隔（秒）；null 表示由服务端/客户端按 [expiresAt] 自行决定。
  final int? refreshAfterSec;

  bool isExpiredAt(DateTime now) => !now.toUtc().isBefore(expiresAt.toUtc());

  /// 展示用分组（每 4 位一组），不改变凭据本身。
  String get displayCode {
    final StringBuffer buffer = StringBuffer();
    for (int index = 0; index < code.length; index++) {
      if (index > 0 && index % 4 == 0) buffer.write(' ');
      buffer.write(code[index]);
    }
    return buffer.toString();
  }

  /// ⚠️ **付款码脱敏**：这里刻意不打 [code]。
  @override
  String toString() =>
      'CampusPaymentCode(expiresAt=${isoUtc(expiresAt)}, code=<redacted>)';
}
