import 'json_read.dart';

/// 校园平台标识（冻结契约 §11.10-B：`TechpieLink.provider` 与
/// `CampusBinding.platform` **同一套**）。
///
/// 刻意不复用 `campus_binding.dart` 的 `CampusSystem`：那套枚举是早期骨架
/// （`egate` / `cpdaily` / `academic` / `ecard`），与 §11.10-B 裁决后的
/// `cas | egate | cpdaily | ecard | techpie` 不一致。契约裁决是权威，
/// 因此这里按裁决逐字实现；两套枚举的合并需要 Lead 裁决（已登记进交付说明）。
enum CampusPlatform {
  cas('cas', '统一身份认证'),
  egate('egate', 'eGate'),
  cpdaily('cpdaily', 'CpDaily'),
  ecard('ecard', '校园卡'),
  techpie('techpie', 'TechPie / GeekPie');

  const CampusPlatform(this.wire, this.label);

  /// 线上标识（也是 `/api/v1/<module>/*` 请求体里的取值）。
  final String wire;

  /// 面向用户的名字。
  final String label;

  /// 未知取值返回 null —— 调用方**必须**显式决定怎么处理，不许静默降级。
  static CampusPlatform? fromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final CampusPlatform platform in CampusPlatform.values) {
      if (platform.wire == normalized) return platform;
    }
    return null;
  }

  /// 是否需要**第二级**绑定才能访问。
  ///
  /// `cas` 是**第一级身份源**（契约 §5），不是校园系统能力 —— 它由 `AuthPort`
  /// 负责，永远不出现在绑定列表里。
  bool get isCampusCapability => this != CampusPlatform.cas;

  /// 校园卡走**独立的 OPENID 通道**（规格 §2.5），与校园会话代持链路解耦。
  bool get usesOpenIdChannel => this == CampusPlatform.ecard;
}

/// 绑定状态（契约 §2.9 / 规格 §4.3）。
enum CampusBindingStatus {
  unlinked('UNLINKED'),
  linking('LINKING'),
  linked('LINKED'),
  expired('EXPIRED'),
  revoked('REVOKED');

  const CampusBindingStatus(this.wire);

  final String wire;

  static CampusBindingStatus? fromWire(String wire) {
    final String normalized = wire.trim().toUpperCase();
    for (final CampusBindingStatus status in CampusBindingStatus.values) {
      if (status.wire == normalized) return status;
    }
    return null;
  }

  /// 已绑定（**不含**过期判断；过期要用 `isUsableAt`）。
  bool get isLinked => this == CampusBindingStatus.linked;

  /// 绑定流程进行中（F11：上游失败时必须回到 `UNLINKED`，不留悬挂态）。
  bool get isInFlight => this == CampusBindingStatus.linking;

  /// 曾经绑定过、现在需要重新绑定 —— 与「从未绑定」是**两种不同的引导**。
  bool get needsRebind =>
      this == CampusBindingStatus.expired ||
      this == CampusBindingStatus.revoked;

  /// 用户视角的文案（不是错误信息）。
  String get label => switch (this) {
        CampusBindingStatus.unlinked => '未绑定',
        CampusBindingStatus.linking => '绑定中',
        CampusBindingStatus.linked => '已绑定',
        CampusBindingStatus.expired => '已过期',
        CampusBindingStatus.revoked => '已解除',
      };
}

/// 第二级 · 能力层的绑定**元数据**（规格 §4.3）。
///
/// 这是业务层**唯一**能拿到的形状：只有状态，没有任何凭据。
/// 明确**不存在**的键（服务端与客户端双向断言，契约 §11.4 I1 的镜像）：
/// `cookie` / `cookies` / `session` / `sessionToken` / `tgc` / `castgc` /
/// `ticket` / `tenant`。见 `test/domain/techpie_credential_boundary_test.dart`。
final class CampusBindingSummary {
  const CampusBindingSummary({
    required this.platform,
    required this.status,
    this.externalUserId,
    this.expiresAt,
    this.lastSyncAt,
  });

  /// 只读白名单里的键；`json` 里多出来的键（例如服务端误加的 `sessionCipher`）
  /// **不会被读取**，因此不可能被上抛到 UI。
  factory CampusBindingSummary.fromJson(Map<String, Object?> json) {
    final String rawPlatform = readString(json, 'platform');
    final CampusPlatform? platform = CampusPlatform.fromWire(rawPlatform);
    if (platform == null) {
      throw FormatException('CampusBindingSummary: 未知校园平台 "$rawPlatform"');
    }
    final String rawStatus = readString(json, 'status');
    final CampusBindingStatus? status = CampusBindingStatus.fromWire(rawStatus);
    if (status == null) {
      throw FormatException('CampusBindingSummary: 未知绑定状态 "$rawStatus"');
    }
    return CampusBindingSummary(
      platform: platform,
      status: status,
      externalUserId: readStringOrNull(json, 'externalUserId'),
      expiresAt: readDateTimeOrNull(json, 'expiresAt'),
      lastSyncAt: readDateTimeOrNull(json, 'lastSyncAt'),
    );
  }

  final CampusPlatform platform;
  final CampusBindingStatus status;

  /// 对端标识（例如学号）。**不是**凭据；可以为空。
  final String? externalUserId;

  /// 会话有效期；null 表示由服务端决定、当前无明确过期时刻。
  final DateTime? expiresAt;

  /// 最近一次同步时刻（规格 §8.3）。
  final DateTime? lastSyncAt;

  /// 契约 §5 硬规则 3 的客户端判据：**已登录但未绑定是合法状态**。
  ///
  /// 注意这里只回答「这个平台能不能用」，不回答「用户有没有登录」——
  /// 后者属于第一级身份（`AuthPort`），本模型**不携带**任何身份字段。
  bool isUsableAt(DateTime now) => status.isLinked && !isExpiredAt(now);

  bool isExpiredAt(DateTime now) =>
      expiresAt != null && !expiresAt!.isAfter(now.toUtc());

  Map<String, Object?> toJson() => <String, Object?>{
        'platform': platform.wire,
        'status': status.wire,
        'externalUserId': externalUserId,
        'expiresAt': expiresAt == null ? null : isoUtc(expiresAt!),
        'lastSyncAt': lastSyncAt == null ? null : isoUtc(lastSyncAt!),
      };

  CampusBindingSummary copyWith({
    CampusPlatform? platform,
    CampusBindingStatus? status,
    String? externalUserId,
    DateTime? expiresAt,
    DateTime? lastSyncAt,
  }) =>
      CampusBindingSummary(
        platform: platform ?? this.platform,
        status: status ?? this.status,
        externalUserId: externalUserId ?? this.externalUserId,
        expiresAt: expiresAt ?? this.expiresAt,
        lastSyncAt: lastSyncAt ?? this.lastSyncAt,
      );

  @override
  bool operator ==(Object other) =>
      other is CampusBindingSummary &&
      other.platform == platform &&
      other.status == status &&
      other.externalUserId == externalUserId &&
      other.expiresAt == expiresAt &&
      other.lastSyncAt == lastSyncAt;

  @override
  int get hashCode =>
      Object.hash(platform, status, externalUserId, expiresAt, lastSyncAt);

  @override
  String toString() => 'CampusBindingSummary(${platform.wire}, ${status.wire})';
}

/// 一条绑定（`GET /api/v1/techpie/links` 的行，规格 §8.3）。
///
/// 契约 §2.9 的 `TechpieLink` 有 `userId` 与 `tokenCipher` 两列，**都不在这里**：
///
///   - `userId`：由第一级身份决定。绑定模型**不得复制身份字段** ——
///     否则 presentation 层就有机会把两级身份混进一个对象（契约 §5 硬规则 1）；
///   - `tokenCipher`：服务端的加密列。客户端**永远拿不到**，也不该拿到。
final class TechpieLink {
  const TechpieLink({required this.id, required this.summary});

  factory TechpieLink.fromJson(Map<String, Object?> json) => TechpieLink(
        id: readString(json, 'id'),
        // §8.3 的行把 `id` 与元数据放在**同一层**，因此直接复用同一个 map。
        summary: CampusBindingSummary.fromJson(json),
      );

  final String id;
  final CampusBindingSummary summary;

  CampusPlatform get platform => summary.platform;

  CampusBindingStatus get status => summary.status;

  bool isUsableAt(DateTime now) => summary.isUsableAt(now);

  /// 手动续期只对「已绑定」或「曾绑定但已过期/被吊销」有意义（规格 §8.6）。
  ///
  /// `LINKING` 期间不给续期入口（避免和绑定流程打架）；
  /// `UNLINKED` 没有可续的会话。
  bool get canRenew => status.isLinked || status.needsRebind;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        ...summary.toJson(),
      };

  TechpieLink copyWith({String? id, CampusBindingSummary? summary}) =>
      TechpieLink(id: id ?? this.id, summary: summary ?? this.summary);

  @override
  bool operator ==(Object other) =>
      other is TechpieLink && other.id == id && other.summary == summary;

  @override
  int get hashCode => Object.hash(id, summary);

  @override
  String toString() => 'TechpieLink($id, ${platform.wire}, ${status.wire})';
}
