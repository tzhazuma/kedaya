import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/application/module_entries.dart';
import 'package:kedaya/domain/models/kedaya_module.dart';

void main() {
  group('模块目录的展示与跳转', () {
    test('有真实页面的模块点击直达，不再经过契约信息页', () {
      expect(moduleEntryLocation('groupbuy'), '/groupbuy');
      expect(moduleEntryLocation('schedule'), '/schedule');
      expect(moduleEntryLocation('campus-card'), '/campus-card');
      for (final String route in moduleEntryRoutes.values) {
        expect(route.startsWith('/module/'), isFalse,
            reason: '已实现模块不该再跳到二次确认页');
      }
    });

    test('未实现的模块仍然落到如实说明页', () {
      expect(moduleEntryLocation('not-a-module'), '/module/not-a-module');
      expect(moduleHasRealPage('not-a-module'), isFalse);
      expect(moduleHasRealPage('forum'), isTrue);
    });

    test('techpie 不再单独占一个模块格子，能力指向校园服务', () {
      expect(directoryModules(kedayaModules), hasLength(kedayaModules.length - 1));
      expect(
        directoryModules(kedayaModules).any((KedayaModule m) => m.id == 'techpie'),
        isFalse,
      );
      // 契约注册表本身不动：它是三端共享的冻结镜像。
      expect(moduleById('techpie'), isNotNull);
      expect(moduleEntryLocation('techpie'), '/campus-services');
    });

    test('目录过滤保持契约顺序，且只过滤已合并项', () {
      final List<String> ids = directoryModules(businessModules)
          .map((KedayaModule m) => m.id)
          .toList();
      expect(ids.first, businessModules.first.id);
      expect(ids, containsAll(<String>['groupbuy', 'facility', 'wellbeing']));
      // 固定入口 wellbeing 不会因为展示层过滤而消失。
      expect(ids, contains('wellbeing'));
    });
  });
}
