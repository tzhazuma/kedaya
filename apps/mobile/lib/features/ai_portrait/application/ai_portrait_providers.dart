import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/app_providers.dart';
import '../../../application/consent_controller.dart';
import '../../../domain/models/campus_portrait.dart';
import '../data/campus_portrait_repository.dart';

/// 契约 §4 的模块 id（同意门与 `KedayaModule` 注册表共用）。
const String aiPortraitModuleId = 'ai-portrait';

/// 本机画像仓库。**只读**：没有 save / generate / infer 方法。
final campusPortraitRepositoryProvider = Provider<CampusPortraitRepository>(
  (ref) => LocalCampusPortraitRepository(ref.watch(localCacheProvider)),
);

/// 我的画像。
///
/// 与 wellbeing 相同：先过二次同意门，再读取本机数据；
/// 没有画像时返回 `null`，页面据此渲染空态，**不在客户端编造标签**。
final campusPortraitProvider =
    AsyncNotifierProvider<CampusPortraitController, CampusPortrait?>(
  CampusPortraitController.new,
);

final class CampusPortraitController extends AsyncNotifier<CampusPortrait?> {
  @override
  Future<CampusPortrait?> build() async {
    final Set<String> granted =
        await ref.watch(consentControllerProvider.future);
    if (!granted.contains(aiPortraitModuleId)) return null;
    return ref.read(campusPortraitRepositoryProvider).load();
  }

  Future<void> refresh() async {
    state = const AsyncLoading<CampusPortrait?>();
    state = await AsyncValue.guard<CampusPortrait?>(() async {
      final Set<String> granted =
          await ref.read(consentControllerProvider.future);
      if (!granted.contains(aiPortraitModuleId)) return null;
      return ref.read(campusPortraitRepositoryProvider).load();
    });
  }

  /// 删除本机画像。删除不要求当前仍同意：删除必须永远可行。
  Future<void> delete() async {
    await ref.read(campusPortraitRepositoryProvider).clear();
    state = const AsyncData<CampusPortrait?>(null);
  }
}
