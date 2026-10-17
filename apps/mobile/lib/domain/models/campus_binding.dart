import 'json_read.dart';

/// 第二级 · 能力层可绑定的校园系统（冻结契约 §5）。
enum CampusSystem {
  egate('egate', 'eGate'),
  cpdaily('cpdaily', 'CpDaily'),
  academic('academic', '教务'),
  ecard('ecard', '一卡通');

  const CampusSystem(this.id, this.label);

  /// 线上标识，也是持久化 key 的一部分。
  final String id;

  /// 面向用户的中文/英文名。
  final String label;

  static CampusSystem? fromId(String id) {
    for (final CampusSystem system in CampusSystem.values) {
      if (system.id == id) return system;
    }
    return null;
  }
}

/// 第二级 · 能力层的绑定**元数据**（冻结契约 §5）。
///
/// 这里刻意**不含** session cookie / tgc / CASTGC：绑定状态可以安全地上抛给 UI，
/// 凭据本身只能经 `CampusSessionPort.cookieHeaderFor()` 取用，且只交给 WebView
/// 注入或校园系统适配器。契约 §5 硬规则 2：绝不可从 `AuthPort` 读取。
final class CampusBinding {
  const CampusBinding({
    required this.system,
    required this.boundAt,
    this.displayName,
    this.expiresAt,
  });

  factory CampusBinding.fromJson(Map<String, Object?> json) {
    final String rawSystem = readString(json, 'system');
    final CampusSystem? system = CampusSystem.fromId(rawSystem);
    if (system == null) {
      throw FormatException('CampusBinding: 未知校园系统 "$rawSystem"');
    }
    return CampusBinding(
      system: system,
      boundAt: readDateTime(json, 'boundAt'),
      displayName: readStringOrNull(json, 'displayName'),
      expiresAt: readDateTimeOrNull(json, 'expiresAt'),
    );
  }

  final CampusSystem system;
  final DateTime boundAt;

  /// 校园系统侧显示名（例如学号/姓名），仅用于展示绑定归属。
  final String? displayName;

  /// 绑定有效期；null 表示不过期（由服务端决定）。
  final DateTime? expiresAt;

  bool isExpiredAt(DateTime now) => expiresAt != null && !expiresAt!.isAfter(now.toUtc());

  bool get isExpired => isExpiredAt(DateTime.now());

  bool get isActive => !isExpired;

  Map<String, Object?> toJson() => <String, Object?>{
    'system': system.id,
    'boundAt': isoUtc(boundAt),
    'displayName': displayName,
    if (expiresAt != null) 'expiresAt': isoUtc(expiresAt!),
  };

  CampusBinding copyWith({
    CampusSystem? system,
    DateTime? boundAt,
    String? displayName,
    DateTime? expiresAt,
  }) => CampusBinding(
    system: system ?? this.system,
    boundAt: boundAt ?? this.boundAt,
    displayName: displayName ?? this.displayName,
    expiresAt: expiresAt ?? this.expiresAt,
  );

  @override
  bool operator ==(Object other) =>
      other is CampusBinding &&
      other.system == system &&
      other.boundAt == boundAt &&
      other.displayName == displayName &&
      other.expiresAt == expiresAt;

  @override
  int get hashCode => Object.hash(system, boundAt, displayName, expiresAt);

  @override
  String toString() => 'CampusBinding(${system.id}, boundAt=${isoUtc(boundAt)})';
}
