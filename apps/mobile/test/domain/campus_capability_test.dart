import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/campus_capability.dart';
import 'package:kedaya/domain/models/techpie_link.dart';

/// 能力清单的**状态推导**测试（契约 §5 硬规则 3 / §11.18-H 的 I4）。
///
/// 本文件最重要的一条：**`CAMPUS_BINDING_REQUIRED` 与 `UNAUTHENTICATED`
/// 是两种不同的状态** —— 前者引导去绑定，后者引导去登录。
/// 把它们混成一个（例如都当 401）会让**已经登录**的用户被推去重新登录。
void main() {
  const CampusCapability phase0Ecard = CampusCapability(
    id: 'campus-card.balance',
    title: '校园卡余额',
    description: '余额查询',
    phase: CampusCapabilityPhase.phase0,
    platform: CampusPlatform.ecard,
    state: CampusCapabilityState.unknown,
  );

  const CampusCapability phase0Cpdaily = CampusCapability(
    id: 'techpie.webview',
    title: '校园系统直连',
    description: 'WebView 直连',
    phase: CampusCapabilityPhase.phase0,
    platform: CampusPlatform.cpdaily,
    state: CampusCapabilityState.unknown,
  );

  const CampusCapability phase0NoPlatform = CampusCapability(
    id: 'techpie.identity',
    title: '一级身份',
    description: '统一身份认证',
    phase: CampusCapabilityPhase.phase0,
    state: CampusCapabilityState.unknown,
  );

  const CampusCapability phase1 = CampusCapability(
    id: 'schedule.timetable',
    title: '课表',
    description: '需要 CpDaily',
    phase: CampusCapabilityPhase.phase1,
    platform: CampusPlatform.cpdaily,
    state: CampusCapabilityState.notImplemented,
  );

  const List<CampusCapability> catalog = <CampusCapability>[
    phase0Ecard,
    phase0Cpdaily,
    phase0NoPlatform,
    phase1,
  ];

  List<CampusCapability> resolve({
    required bool signedIn,
    Set<CampusPlatform> usablePlatforms = const <CampusPlatform>{},
    Map<String, CampusCapabilityState> serverStates =
        const <String, CampusCapabilityState>{},
  }) => resolveCampusCapabilities(
    catalog: catalog,
    signedIn: signedIn,
    usablePlatforms: usablePlatforms,
    serverStates: serverStates,
  );

  CampusCapabilityState stateOf(List<CampusCapability> items, String id) =>
      items.firstWhere((CampusCapability item) => item.id == id).state;

  group('CAMPUS_BINDING_REQUIRED 与 UNAUTHENTICATED 是两种不同状态', () {
    test('枚举值 / wire / 语义 / 出路四条都不同', () {
      const CampusCapabilityState binding = CampusCapabilityState.bindingRequired;
      const CampusCapabilityState anonymous = CampusCapabilityState.unauthenticated;

      expect(binding == anonymous, isFalse);
      expect(binding.wire, 'CAMPUS_BINDING_REQUIRED');
      expect(anonymous.wire, 'UNAUTHENTICATED');

      expect(binding.needsBinding, isTrue);
      expect(binding.needsSignIn, isFalse);
      expect(anonymous.needsSignIn, isTrue);
      expect(anonymous.needsBinding, isFalse);

      expect(binding.guidance, contains('已登录'));
      expect(binding.guidance, contains('绑定'));
      expect(anonymous.guidance, contains('还没有登录'));
      expect(anonymous.guidance, contains('统一身份认证'));
      // 引导文案不许互换：绑定引导里不能出现"重新登录"这种误导。
      expect(binding.guidance, isNot(contains('重新登录')));
    });

    test('已登录但未绑定 → CAMPUS_BINDING_REQUIRED（不是 UNAUTHENTICATED）', () {
      final List<CampusCapability> items = resolve(signedIn: true);
      expect(stateOf(items, 'campus-card.balance'), CampusCapabilityState.bindingRequired);
      expect(stateOf(items, 'techpie.webview'), CampusCapabilityState.bindingRequired);
      expect(stateOf(items, 'campus-card.balance').needsSignIn, isFalse);
    });

    test('未登录 → UNAUTHENTICATED（即使同时也没绑定）', () {
      final List<CampusCapability> items = resolve(signedIn: false);
      expect(stateOf(items, 'campus-card.balance'), CampusCapabilityState.unauthenticated);
      expect(stateOf(items, 'techpie.webview'), CampusCapabilityState.unauthenticated);
      expect(stateOf(items, 'campus-card.balance').needsBinding, isFalse);
    });

    test('从错误码推导：409 与 401 映射到两个不同状态', () {
      expect(
        CampusCapabilityState.fromErrorCode(ApiErrorCode.campusBindingRequired),
        CampusCapabilityState.bindingRequired,
      );
      expect(
        CampusCapabilityState.fromErrorCode(ApiErrorCode.unauthenticated),
        CampusCapabilityState.unauthenticated,
      );
      expect(
        CampusCapabilityState.fromErrorCode(ApiErrorCode.upstreamUnavailable),
        CampusCapabilityState.upstreamUnavailable,
      );
      expect(CampusCapabilityState.fromErrorCode(ApiErrorCode.notFound), isNull);
    });

    test('F3（R4）：CONFLICT + RENEW_NOT_SUPPORTED → UNSUPPORTED，而不是普通冲突', () {
      const ApiError unsupported = ApiError(
        code: ApiErrorCode.conflict,
        message: '上游没有续期能力',
        details: <String, Object?>{'reason': 'RENEW_NOT_SUPPORTED'},
      );
      const ApiError plainConflict = ApiError(
        code: ApiErrorCode.conflict,
        message: '冲突',
      );
      expect(
        CampusCapabilityState.fromApiError(unsupported),
        CampusCapabilityState.unsupported,
      );
      expect(CampusCapabilityState.fromApiError(plainConflict), isNull);
      expect(CampusCapabilityState.reasonOf(unsupported), 'RENEW_NOT_SUPPORTED');
      // 非字符串的 details 不许抛异常。
      expect(
        CampusCapabilityState.reasonOf(
          const ApiError(
            code: ApiErrorCode.conflict,
            message: 'x',
            details: <String, Object?>{'reason': 42},
          ),
        ),
        isNull,
      );
    });
  });

  group('resolveCampusCapabilities 的优先级', () {
    test('Phase 1+ 一律 NOT_IMPLEMENTED —— 即使服务端说可用', () {
      final List<CampusCapability> items = resolve(
        signedIn: true,
        usablePlatforms: const <CampusPlatform>{CampusPlatform.cpdaily},
        serverStates: const <String, CampusCapabilityState>{
          'schedule.timetable': CampusCapabilityState.available,
        },
      );
      expect(stateOf(items, 'schedule.timetable'), CampusCapabilityState.notImplemented);
      final CampusCapability timetable = items.firstWhere(
        (CampusCapability item) => item.id == 'schedule.timetable',
      );
      expect(timetable.isUsable, isFalse);
      expect(timetable.phase.isImplemented, isFalse);
      expect(timetable.phase.blockingNote, contains('信息办'));
    });

    test('已绑定平台的能力可用；不依赖平台的能力在已登录时可用', () {
      final List<CampusCapability> items = resolve(
        signedIn: true,
        usablePlatforms: const <CampusPlatform>{CampusPlatform.cpdaily},
      );
      expect(stateOf(items, 'techpie.webview'), CampusCapabilityState.available);
      expect(stateOf(items, 'techpie.identity'), CampusCapabilityState.available);
      expect(stateOf(items, 'campus-card.balance'), CampusCapabilityState.bindingRequired);
    });

    test('服务端显式状态优先；但"可用"而平台未绑定 → 降级为需绑定', () {
      final List<CampusCapability> downgraded = resolve(
        signedIn: true,
        serverStates: const <String, CampusCapabilityState>{
          'campus-card.balance': CampusCapabilityState.available,
        },
      );
      expect(
        stateOf(downgraded, 'campus-card.balance'),
        CampusCapabilityState.bindingRequired,
      );

      final List<CampusCapability> kept = resolve(
        signedIn: true,
        serverStates: const <String, CampusCapabilityState>{
          'techpie.webview': CampusCapabilityState.upstreamUnavailable,
        },
      );
      expect(
        stateOf(kept, 'techpie.webview'),
        CampusCapabilityState.upstreamUnavailable,
      );
    });

    test('unknown 状态不等于可用（F7：状态未知与没有数据必须区分）', () {
      expect(CampusCapabilityState.unknown.isUsable, isFalse);
      expect(CampusCapabilityState.fromWire('SOMETHING_NEW'), CampusCapabilityState.unknown);
      expect(CampusCapabilityState.unknown.guidance, contains('状态未知'));
    });

    test('未知 phase 按最保守处理（当作未实现，不当作 Phase 0）', () {
      expect(
        CampusCapabilityPhase.fromWire('PHASE_9'),
        CampusCapabilityPhase.phase1,
      );
      expect(CampusCapabilityPhase.fromWire('PHASE_9').isImplemented, isFalse);
    });
  });

  group('CampusCapability 解析与序列化', () {
    test('fromJson 容忍缺失的 description / reason，但 id 与 title 必需', () {
      final CampusCapability item = CampusCapability.fromJson(<String, Object?>{
        'id': 'campus-card.balance',
        'title': '校园卡余额',
        'state': 'CAMPUS_BINDING_REQUIRED',
      });
      expect(item.description, '');
      expect(item.platform, isNull);
      expect(item.phase, CampusCapabilityPhase.phase1); // 缺失 → 最保守
      expect(item.state, CampusCapabilityState.bindingRequired);
      expect(item.reason, isNull);
    });

    test('未知平台抛 FormatException；toJson 键名封闭', () {
      expect(
        () => CampusCapability.fromJson(<String, Object?>{
          'id': 'x',
          'title': 'y',
          'platform': 'academic',
        }),
        throwsFormatException,
      );
      expect(phase0Ecard.toJson().keys.toSet(), <String>{
        'id',
        'title',
        'description',
        'phase',
        'platform',
        'state',
        'reason',
      });
    });
  });
}
