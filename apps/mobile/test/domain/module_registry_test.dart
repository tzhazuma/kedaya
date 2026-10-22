import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/kedaya_module.dart';

/// 模块注册表是契约 §4 的冻结项，Dart 侧只是镜像 —— 因此这里断言镜像没走样。
/// 对应用例见 `packages/contracts/src/modules.test.ts`。
void main() {
  // 2026-10-22 契约新增 `teabreak`（学术会议茶歇）。Dart 镜像同步了这一条，
  // 但**仍未同步** `petition` 与 `campus-map`（`modules.ts` 现有 24 条）——
  // 那两条不在本轮范围内，已登记进交付说明。
  test('注册表共 22 个模块：16 业务 + 6 基础', () {
    expect(kedayaModules, hasLength(22));
    expect(businessModules, hasLength(16));
    expect(coreModules, hasLength(6));
  });

  test('teabreak 已注册：business / low / 无同意门 / route == id', () {
    final KedayaModule? module = moduleById('teabreak');
    expect(module, isNotNull, reason: 'contracts 的 modules.ts 已有 teabreak');
    expect(module!.nameZh, '会议茶歇');
    expect(module.nameEn, 'Conference Tea Breaks');
    expect(module.category, ModuleCategory.business);
    expect(module.sensitivity, ModuleSensitivity.low);
    expect(module.requiresConsent, isFalse);
    expect(module.route, 'teabreak');
    expect(module.summary, contains('茶歇'));
    expect(moduleRequiresConsent('teabreak'), isFalse);
    expect(moduleIsSensitive('teabreak'), isFalse);
  });

  // 2026-10-19 契约新增第 21 个模块 `deadlines`（DDL 聚合），Dart 侧必须同步。
  // 期望值逐条抄自 `packages/contracts/src/modules.test.ts` 的同名断言。
  test('deadlines 是第 21 个模块：core / medium / 无同意门 / route == id', () {
    final KedayaModule? module = moduleById('deadlines');
    expect(module, isNotNull, reason: '契约已有 deadlines，Dart 镜像不能缺项');
    expect(module!.nameZh, 'DDL 聚合');
    expect(module.nameEn, 'Deadlines');
    expect(module.category, ModuleCategory.core);
    expect(module.sensitivity, ModuleSensitivity.medium);
    expect(module.requiresConsent, isFalse);
    expect(module.route, 'deadlines');
    expect(module.summary, contains('Gradescope'));
    expect(moduleIsSensitive('deadlines'), isFalse);
    expect(moduleRequiresConsent('deadlines'), isFalse);
  });

  test('id 唯一，route 与 id 一致，中文名与一句话定义非空', () {
    final Set<String> ids = <String>{};
    for (final KedayaModule module in kedayaModules) {
      expect(ids.add(module.id), isTrue, reason: '${module.id} 重复注册');
      expect(module.route, module.id, reason: '${module.id} 的 route 必须等于 id');
      expect(module.nameZh, isNotEmpty);
      expect(module.nameEn, isNotEmpty);
      expect(module.summary, isNotEmpty);
    }
  });

  test('只有 wellbeing / dorm-harmony / ai-portrait 需要二次同意（契约 §9）', () {
    final List<String> ids = consentModules()
        .map((KedayaModule module) => module.id)
        .toList(growable: false)
      ..sort();
    expect(ids, <String>['ai-portrait', 'dorm-harmony', 'wellbeing']);
    expect(moduleRequiresConsent('wellbeing'), isTrue);
    expect(moduleRequiresConsent('canteen'), isFalse);
    expect(moduleRequiresConsent('unknown-module'), isFalse);
  });

  test('auth / campus-card 是 high 敏感但**不设**同意门（登录/开卡本身就是同意）', () {
    expect(moduleById('auth')!.sensitivity, ModuleSensitivity.high);
    expect(moduleById('auth')!.requiresConsent, isFalse);
    expect(moduleById('campus-card')!.sensitivity, ModuleSensitivity.high);
    expect(moduleById('campus-card')!.requiresConsent, isFalse);
    expect(moduleIsSensitive('campus-card'), isTrue);
  });

  test('critical 模块必须要求同意', () {
    for (final KedayaModule module in kedayaModules) {
      if (module.sensitivity == ModuleSensitivity.critical) {
        expect(module.requiresConsent, isTrue,
            reason: '${module.id} 是 critical 但未要求同意');
      }
    }
  });

  test('wellbeing 是唯一 critical，且危机干预入口属于它', () {
    final List<KedayaModule> critical = kedayaModules
        .where((KedayaModule module) =>
            module.sensitivity == ModuleSensitivity.critical)
        .toList(growable: false);
    expect(critical.map((KedayaModule module) => module.id).toList(),
        <String>['wellbeing']);
  });

  test('modulePath 生成契约 §6.1 的路径形状', () {
    expect(
        modulePath('groupbuy', <Object>['items', '123']), 'groupbuy/items/123');
    expect(modulePath('lost-found'), 'lost-found');
    // 未注册的 id 直接透传，不抛异常（与 TS 实现一致）。
    expect(modulePath('not-registered', <Object>['items']),
        'not-registered/items');
  });

  test('KedayaModule.path 与 modulePath 等价', () {
    final KedayaModule module = moduleById('groupbuy')!;
    expect(module.path(<Object>['items', 7]), 'groupbuy/items/7');
    expect(module.path(), 'groupbuy');
  });

  test('sensitiveModules 覆盖 high + critical', () {
    final List<String> ids = sensitiveModules()
        .map((KedayaModule module) => module.id)
        .toList(growable: false);
    expect(
        ids,
        containsAll(<String>[
          'auth',
          'campus-card',
          'dorm-harmony',
          'ai-portrait',
          'wellbeing'
        ]));
    expect(ids, isNot(contains('groupbuy')));
  });
}
