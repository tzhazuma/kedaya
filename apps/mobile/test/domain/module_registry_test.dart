import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/kedaya_module.dart';

/// 模块注册表是契约 §4 的冻结项，Dart 侧只是镜像 —— 因此这里断言镜像没走样。
/// 对应用例见 `packages/contracts/src/modules.test.ts`。
void main() {
  // 2026-10-22 契约新增 `teabreak`（学术会议茶歇）。Dart 镜像同步了这一条，
  // 但**仍未同步** `petition` 与 `campus-map`（`modules.ts` 现有 24 条）——
  // 那两条不在本轮范围内，已登记进交付说明。
  test('注册表共 24 个模块：17 业务 + 7 基础（与契约 modules.ts 对齐）', () {
    // 2026-10-22 补齐：此前 Dart 镜像只有 22 条，缺 `petition`（业务）与
    // `campus-map`（核心）—— 契约早就有了，Dart 端漏了，导致真机首页
    // 显示「查看全部 22 个模块」而契约是 24。本轮一次补齐并对齐顺序。
    expect(kedayaModules, hasLength(24));
    expect(businessModules, hasLength(17));
    expect(coreModules, hasLength(7));
  });

  test('petition 已注册（业务 / low / 无同意门）', () {
    final KedayaModule? module = moduleById('petition');
    expect(module, isNotNull);
    expect(module!.nameZh, '众筹诉求');
    expect(module.category, ModuleCategory.business);
    expect(module.sensitivity, ModuleSensitivity.low);
    expect(module.requiresConsent, isFalse);
    expect(module.route, 'petition');
    // ⚠️ 措辞守卫：这个模块**不筹钱**，摘要里不该出现「资金/支付/筹款」
    expect(module.summary, isNot(contains('资金')));
    expect(module.summary, isNot(contains('支付')));
  });

  test('campus-map 已注册（核心 / low / 无同意门）', () {
    final KedayaModule? module = moduleById('campus-map');
    expect(module, isNotNull);
    expect(module!.nameZh, '校园地点');
    expect(module.category, ModuleCategory.core);
    expect(module.sensitivity, ModuleSensitivity.low);
    expect(module.requiresConsent, isFalse);
    expect(module.route, 'campus-map');
  });

  test('⚠️ 业务模块顺序与契约逐条一致（顺序即首页展示顺序）', () {
    // 契约顺序来自 packages/contracts/src/modules.ts；Dart 端必须同序，
    // 否则首页宫格与契约模块表会「看起来有同一个模块但排列不同」。
    expect(businessModules.map((m) => m.id).toList(), <String>[
      'groupbuy',
      'takeout-guard',
      'flea-market',
      'dorm-harmony',
      'errand',
      'buddy',
      'lost-found',
      'canteen',
      'forum',
      'ai-portrait',
      'wellbeing',
      'faq',
      'techpie',
      'wildlife',
      'facility',
      'petition',
      'teabreak',
    ]);
  });

  test('⚠️ 核心模块顺序与契约逐条一致', () {
    expect(coreModules.map((m) => m.id).toList(), <String>[
      'auth',
      'schedule',
      'campus-map',
      'deadlines',
      'campus-card',
      'profile',
      'notifications',
    ]);
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
    // ==================================================================
    // 防「写死模块数」—— 屏幕上显示错误数字是很尴尬的失败
    // ==================================================================

    group('⚠️ 源码守卫：不许把模块数写死在 UI 文案里', () {
      /// 读源码（测试跑在 apps/mobile 下，路径相对它）
      String read(String rel) => File(rel).readAsStringSync();

      test('modules_page.dart 的分组副标题是动态的', () {
        final String src = read('lib/presentation/pages/modules_page.dart');
        // 曾经写死：「来自需求图的 14 个模块」「身份 / 课表 / 校园卡 / 我的 / 通知」。
        // 契约早就不止这些了，于是屏幕上显示的数字是错的。
        expect(
          src,
          isNot(contains('14 个模块')),
          reason: '分组副标题必须用 business.length，不能写死',
        );
        expect(
          src,
          isNot(contains('身份 / 课表 / 校园卡 / 我的 / 通知')),
          reason: '基础模块副标题必须用 core.length，不能列举（列举必过期）',
        );
        // 正向：确实用了动态长度
        expect(src, contains(r'business.length'));
        expect(src, contains(r'core.length'));
      });

      test('home_page.dart 的「查看全部 N 个模块」是动态的', () {
        final String src = read('lib/presentation/pages/home_page.dart');
        expect(src, contains(r'kedayaModules.length'));
        // 不许出现形如「查看全部 22 个模块」的字面量
        expect(RegExp(r'查看全部\s*\d+\s*个模块').hasMatch(src), isFalse);
      });

      test('注册表计数与契约对齐（24 = 17 + 7）', () {
        // 这条是「数字对不对」的最终裁定；上面两条防的是「UI 不读它」。
        expect(kedayaModules.length, 24);
        expect(businessModules.length + coreModules.length, kedayaModules.length);
      });
    });

}


