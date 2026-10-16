import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/models/kedaya_module.dart';

/// 模块注册表（契约 §4：清单只有一处真相 —— `domain/models/kedaya_module.dart`，
/// 它又镜像自 `packages/contracts/src/modules.ts`）。
///
/// 页面**必须**从这里取模块，禁止在 widget 里写死清单。
final moduleCatalogProvider = Provider<List<KedayaModule>>((ref) => kedayaModules);

final businessModulesProvider = Provider<List<KedayaModule>>(
  (ref) => businessModules,
);

final coreModulesProvider = Provider<List<KedayaModule>>((ref) => coreModules);

/// 按 id 取模块；未注册返回 null（页面据此渲染"未知模块"）。
final moduleByIdProvider = Provider.family<KedayaModule?, String>(
  (ref, String moduleId) => moduleById(moduleId),
);

/// 需要二次同意的模块（契约 §9）。
final consentModulesProvider = Provider<List<KedayaModule>>(
  (ref) => consentModules(),
);
