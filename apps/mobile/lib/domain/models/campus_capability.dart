import 'api_error.dart';
import 'json_read.dart';
import 'techpie_link.dart';

/// wire 取值的**归一化**：去掉所有非字母数字并转大写。
///
/// 为什么需要它：同一个语义在三端写成了不同形式 ——
/// 契约 §2.9 用 `PHASE_0` / `CAMPUS_BINDING_REQUIRED`，
/// 而 `services/api` 的 `TechpiePhase` 用 `phase0` / `phase1` / `phase2`（小写无下划线）。
/// 归一化让两种写法都能命中，**不会**因为一个下划线就把整张能力清单降级成"状态未知"。
String campusCapabilityWireKey(String wire) =>
    wire.replaceAll(RegExp(r'[^A-Za-z0-9]'), '').toUpperCase();

/// 能力可用性。
///
/// ⚠️ **`bindingRequired` 与 `unauthenticated` 是两种不同的状态**，必须分开：
///
/// | 状态 | 含义 | UI 的出路 |
/// | --- | --- | --- |
/// | [bindingRequired] | **已登录**，但没有绑定该校园系统 | 引导去「绑定管理」 |
/// | [unauthenticated] | **未登录** | 引导去完成统一身份认证 |
///
/// 把两者混成一个（例如都当作 401）会让**已经登录**的用户被推去重新登录，
/// 而真正缺的是绑定 —— 这正是契约 §5 硬规则 3 与 ADR §5.4 要防的误导
/// （契约 §11.18-H 的不变式 I4）。
enum CampusCapabilityState {
  /// 可直接使用。
  available('AVAILABLE'),

  /// 409 `CAMPUS_BINDING_REQUIRED`：已登录但未绑定。
  bindingRequired('CAMPUS_BINDING_REQUIRED'),

  /// 401 `UNAUTHENTICATED`：未登录。
  unauthenticated('UNAUTHENTICATED'),

  /// 502 `UPSTREAM_UNAVAILABLE`（含熔断、超时）。
  upstreamUnavailable('UPSTREAM_UNAVAILABLE'),

  /// 上游**没有**这个能力（例如 F3 / R4 的 `RENEW_NOT_SUPPORTED`）。
  /// 不谎称"已续期"、不谎称"可用"。
  unsupported('UNSUPPORTED'),

  /// 本端**尚未实现**（Phase 1–3 阻塞于信息办 / GeekPie 的书面回复）。
  notImplemented('NOT_IMPLEMENTED'),

  /// **状态未知**（规格 §10.1 的 F7 教训）：
  /// 解析不完整时既不能当作"可用"，也不能当作"没有数据"。
  unknown('UNKNOWN');

  const CampusCapabilityState(this.wire);

  final String wire;

  /// 未识别取值收敛为 [unknown]，**不**收敛为 `available`
  /// （宁可让用户看到"状态未知"，也不能谎称可用）。
  ///
  /// 同时接受 `services/api` 的 `TechpieCapabilityStatus` 别名：
  ///   - `EXPIRED`（绑定已过期）→ [bindingRequired]：用户要做的事与"未绑定"一样（去绑定/重绑）；
  ///   - `PHASE_BLOCKED`（该阶段未实现）→ [notImplemented]。
  static CampusCapabilityState fromWire(String wire) {
    final String key = campusCapabilityWireKey(wire);
    for (final CampusCapabilityState state in CampusCapabilityState.values) {
      if (campusCapabilityWireKey(state.wire) == key) return state;
    }
    return switch (key) {
      'EXPIRED' => CampusCapabilityState.bindingRequired,
      'PHASEBLOCKED' => CampusCapabilityState.notImplemented,
      _ => CampusCapabilityState.unknown,
    };
  }

  /// 从后端错误码推导（ADR §5.4 的映射表）。
  ///
  /// 返回 null 表示"这个错误码不表达能力可用性"，调用方不要据此改写状态。
  static CampusCapabilityState? fromErrorCode(ApiErrorCode code) =>
      switch (code) {
        ApiErrorCode.campusBindingRequired =>
          CampusCapabilityState.bindingRequired,
        ApiErrorCode.unauthenticated => CampusCapabilityState.unauthenticated,
        ApiErrorCode.upstreamUnavailable =>
          CampusCapabilityState.upstreamUnavailable,
        _ => null,
      };

  /// 从一次失败的调用推导阻塞状态。
  ///
  /// 比 [fromErrorCode] 多一层：F3（R4）的"上游没有续期能力"是
  /// `CONFLICT` + `details.reason = RENEW_NOT_SUPPORTED`，必须与普通冲突区分。
  static CampusCapabilityState? fromApiError(ApiError error) {
    final CampusCapabilityState? byCode = fromErrorCode(error.code);
    if (byCode != null) return byCode;
    if (error.code == ApiErrorCode.conflict &&
        reasonOf(error) == 'RENEW_NOT_SUPPORTED') {
      return CampusCapabilityState.unsupported;
    }
    return null;
  }

  /// 读 `details.reason`（契约 §6.1 的结构化细节）；非字符串一律当作缺失。
  static String? reasonOf(ApiError error) {
    final Object? details = error.details;
    if (details is Map<String, Object?>) {
      final Object? reason = details['reason'];
      if (reason is String && reason.isNotEmpty) return reason;
    }
    return null;
  }

  /// **需要绑定**（已登录但未绑定）—— 这是引导，不是报错。
  bool get needsBinding => this == CampusCapabilityState.bindingRequired;

  /// **需要登录** —— 与 [needsBinding] 是两条完全不同的出路。
  bool get needsSignIn => this == CampusCapabilityState.unauthenticated;

  /// 现在就能用。
  bool get isUsable => this == CampusCapabilityState.available;

  /// 被某种原因挡住（用于 UI 决定是否显示引导块）。
  bool get isBlocked => !isUsable;

  /// 用户视角的出路说明（不是错误堆栈）。
  String get guidance => switch (this) {
        CampusCapabilityState.available => '可直接使用。',
        CampusCapabilityState.bindingRequired =>
          '你已登录，但还没有绑定该校园系统。完成绑定后即可使用 —— 这不是错误。',
        CampusCapabilityState.unauthenticated =>
          '你还没有登录。先完成上科大统一身份认证，再回来绑定校园系统。',
        CampusCapabilityState.upstreamUnavailable =>
          '校园系统暂时不可用（**状态未知 ≠ 没有数据**），稍后重试即可，不影响其它功能。',
        CampusCapabilityState.unsupported => '上游没有提供这个能力，本端不谎称可用，也不谎称"已完成"。',
        CampusCapabilityState.notImplemented =>
          '本端尚未实现该能力（Phase 1–3 阻塞于信息办 / GeekPie 的书面回复）——'
              '没有假页面、没有假成功。',
        CampusCapabilityState.unknown => '状态未知：上游返回的内容不完整。不当作"可用"，也不当作"没有"。',
      };
}

/// 该能力属于哪个接入阶段（规格 §9.1–§9.4）。
enum CampusCapabilityPhase {
  phase0('PHASE_0', 'Phase 0 · 零合规风险入口'),
  phase1('PHASE_1', 'Phase 1 · 结构化校园数据'),
  phase2('PHASE_2', 'Phase 2 · 场馆预约与高级能力'),
  phase3('PHASE_3', 'Phase 3 · 自动续期');

  const CampusCapabilityPhase(this.wire, this.label);

  final String wire;
  final String label;

  /// 接受 `PHASE_0` 与 `phase0` 两种写法（`services/api` 的 `TechpiePhase` 是小写无下划线）。
  static CampusCapabilityPhase fromWire(String wire) {
    final String key = campusCapabilityWireKey(wire);
    return switch (key) {
      'PHASE0' => CampusCapabilityPhase.phase0,
      'PHASE1' => CampusCapabilityPhase.phase1,
      'PHASE2' => CampusCapabilityPhase.phase2,
      'PHASE3' => CampusCapabilityPhase.phase3,
      // 未知阶段按**最保守**处理：当作未实现，绝不当作 Phase 0 已实现。
      _ => CampusCapabilityPhase.phase1,
    };
  }

  /// 本轮（Phase 0）只实现这一个阶段。
  bool get isImplemented => this == CampusCapabilityPhase.phase0;

  /// 该阶段为什么没做 —— 必须写清"阻塞在谁身上"。
  String get blockingNote => switch (this) {
        CampusCapabilityPhase.phase0 => '无需校园授权，可立即开工。',
        CampusCapabilityPhase.phase1 => '阻塞于信息办书面回复（U7：学校是否允许第三方代持校园会话）。'
            '在拿到书面肯定答复前**不实现任何会话落库路径**。',
        CampusCapabilityPhase.phase2 =>
          '依赖 Phase 1 全部通过 + 场馆预约的模块归属裁决（已裁决为 `facility`）。',
        CampusCapabilityPhase.phase3 =>
          '依赖 GeekPie / HeZeBang 确认续期接口是否对我们开放（U8）。',
      };
}

/// 一条校园能力（能力清单页的一行）。
///
/// 它是**纯值对象**：状态由 [resolveCampusCapabilities] 这个纯函数算出来，
/// 因此"已登录但未绑定"与"未登录"的分流可以在没有 UI 的情况下被钉死。
final class CampusCapability {
  const CampusCapability({
    required this.id,
    required this.title,
    required this.description,
    required this.phase,
    required this.state,
    this.platform,
    this.reason,
  });

  /// 解析 `GET /techpie/capabilities` 的条目。
  ///
  /// ⚠️ **同一语义有两套键名同时存在于仓库里**（`services/api` 的
  /// `TechpieCapability` 是两套客户端形状的并集）：冻结 OpenAPI 用
  /// `key` / `available` / `requiredProvider` / `blockedReason`，
  /// 规格 §8.1 与 Web 端用 `id` / `platform` / `status` / `guidance`。
  /// 本解析**两套都接受**，因此任何一端先落地都不会打断另一端。
  factory CampusCapability.fromJson(Map<String, Object?> json) {
    final String id = readString(json, 'id');
    final String? rawPlatform = readStringOrNull(json, 'platform') ??
        readStringOrNull(json, 'requiredProvider');
    CampusPlatform? platform;
    if (rawPlatform != null && rawPlatform.isNotEmpty) {
      platform = CampusPlatform.fromWire(rawPlatform);
      if (platform == null) {
        throw FormatException('CampusCapability: 未知校园平台 "$rawPlatform"');
      }
    }
    final String? state =
        readStringOrNull(json, 'state') ?? readStringOrNull(json, 'status');
    return CampusCapability(
      id: id,
      title: readStringOrNull(json, 'title') ??
          readStringOrNull(json, 'nameZh') ??
          id,
      description: readStringOrNull(json, 'description') ??
          readStringOrNull(json, 'summary') ??
          '',
      phase: CampusCapabilityPhase.fromWire(
          readStringOr(json, 'phase', 'PHASE_1')),
      state: CampusCapabilityState.fromWire(state ?? 'UNKNOWN'),
      platform: platform,
      reason: readStringOrNull(json, 'reason') ??
          readStringOrNull(json, 'blockedReason'),
    );
  }

  /// 稳定 id（例如 `campus-card.balance`）。UI 与测试都用它定位。
  final String id;

  final String title;
  final String description;
  final CampusCapabilityPhase phase;

  /// 依赖的校园平台；null 表示**不依赖任何校园系统**（例如一级身份相关能力）。
  final CampusPlatform? platform;

  /// 当前可用性。
  final CampusCapabilityState state;

  /// 上游给出的原因（`details.reason`），例如 `UPSTREAM_TIMEOUT` / `RENEW_NOT_SUPPORTED`。
  final String? reason;

  /// 已登录但未绑定 → 引导绑定（**不是**错误）。
  bool get needsBinding => state.needsBinding;

  /// 未登录 → 引导登录。
  bool get needsSignIn => state.needsSignIn;

  /// 真正可用 = 状态可用 **且** 该阶段已实现。
  ///
  /// 第二个条件不能省：Phase 1 的能力即使上游说可用，本端也**没有**实现，
  /// 展示成"可用"就是撒谎。
  bool get isUsable => state.isUsable && phase.isImplemented;

  /// 覆盖状态（服务端 `GET /techpie/capabilities` 是上游可用性的权威）。
  CampusCapability withState(CampusCapabilityState next, {String? reason}) =>
      CampusCapability(
        id: id,
        title: title,
        description: description,
        phase: phase,
        platform: platform,
        state: next,
        reason: reason ?? this.reason,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'title': title,
        'description': description,
        'phase': phase.wire,
        'platform': platform?.wire,
        'state': state.wire,
        'reason': reason,
      };

  @override
  bool operator ==(Object other) =>
      other is CampusCapability &&
      other.id == id &&
      other.title == title &&
      other.description == description &&
      other.phase == phase &&
      other.platform == platform &&
      other.state == state &&
      other.reason == reason;

  @override
  int get hashCode =>
      Object.hash(id, title, description, phase, platform, state, reason);

  @override
  String toString() => 'CampusCapability($id, ${phase.wire}, ${state.wire})';
}

/// 把「我的绑定」合并进能力目录，得到每个能力的**真实**状态。
///
/// 纯函数，规则按优先级（顺序本身是契约的一部分）：
///
/// 1. `phase != phase0` → [CampusCapabilityState.notImplemented]。
///    本轮只做 Phase 0；Phase 1–3 即使上游说可用也不谎称已实现。
/// 2. 服务端给了显式状态 → 用它（上游可用性的权威）；
///    但若它说 `available` 而所需平台并未绑定，则**降级为** [CampusCapabilityState.bindingRequired]
///    —— 让用户看到可行动的出路，而不是一个用不了的"可用"。
/// 3. **未登录** → [CampusCapabilityState.unauthenticated]。
///    这一条必须排在绑定判断**之前**：没登录时谈绑定没有意义。
/// 4. 不依赖平台 → [CampusCapabilityState.available]。
/// 5. 所需平台已绑定且未过期 → [CampusCapabilityState.available]。
/// 6. 否则 → [CampusCapabilityState.bindingRequired]（已登录但未绑定，合法状态）。
List<CampusCapability> resolveCampusCapabilities({
  required List<CampusCapability> catalog,
  required bool signedIn,
  required Set<CampusPlatform> usablePlatforms,
  Map<String, CampusCapabilityState> serverStates =
      const <String, CampusCapabilityState>{},
}) =>
    catalog.map((CampusCapability capability) {
      if (!capability.phase.isImplemented) {
        return capability.withState(CampusCapabilityState.notImplemented);
      }
      final CampusPlatform? platform = capability.platform;
      final bool platformUsable =
          platform == null || usablePlatforms.contains(platform);
      final CampusCapabilityState? fromServer = serverStates[capability.id];
      if (fromServer != null) {
        if (fromServer == CampusCapabilityState.available && !platformUsable) {
          return capability.withState(CampusCapabilityState.bindingRequired);
        }
        return capability.withState(fromServer);
      }
      if (!signedIn) {
        return capability.withState(CampusCapabilityState.unauthenticated);
      }
      if (platformUsable) {
        return capability.withState(CampusCapabilityState.available);
      }
      return capability.withState(CampusCapabilityState.bindingRequired);
    }).toList(growable: false);
