import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_providers.dart';
import '../../../../data/mock/mock_controls.dart';
import '../../../../domain/models/wildlife.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/components/mock_state_menu.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/wildlife_providers.dart';
import '../components/wildlife_cards.dart';

/// 活动区域列表（人工定义 / 管理端维护）。
///
/// 与「聚合热点」不是一回事（规格 §2.3 的对照表）：
/// 区域是稳定的管理边界与告示位，热点是算法聚类出来的、每次重算可能变化。
class WildlifeZonesPage extends ConsumerWidget {
  const WildlifeZonesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<WildlifeZone>> value =
        ref.watch(wildlifeZonesProvider);
    final MockControls? mockControls = ref.watch(mockControlsProvider);
    final KedaYaColors colors = context.kedayaColors;

    return Scaffold(
      appBar: AppBar(
        title: const Text('活动区域'),
        actions: <Widget>[
          if (mockControls != null)
            MockStateMenu(
              controls: mockControls,
              onChanged: () => ref.invalidate(wildlifeZonesProvider),
            ),
          IconButton(
            tooltip: '刷新',
            onPressed: () => ref.invalidate(wildlifeZonesProvider),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: AsyncStateView<List<WildlifeZone>>(
        value: value,
        isEmpty: (List<WildlifeZone> zones) => zones.isEmpty,
        emptyTitle: '还没有定义活动区域',
        emptyDescription: '区域由管理端维护，用于承载投喂政策与告示位。',
        loadingMessage: '正在加载活动区域…',
        onRetry: () => ref.invalidate(wildlifeZonesProvider),
        builder: (BuildContext context, List<WildlifeZone> zones) =>
            ListView.separated(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          itemCount: zones.length + 1,
          separatorBuilder: (BuildContext context, int index) =>
              const SizedBox(height: KedaYaTokens.space3),
          itemBuilder: (BuildContext context, int index) {
            if (index == 0) {
              return Padding(
                padding: const EdgeInsets.only(bottom: KedaYaTokens.space1),
                child: Text(
                  '投喂政策与告示位来自管理端；带「敏感区」标记的区域只公开区域本身，'
                  '不公开任何坐标。',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.textMuted,
                  ),
                ),
              );
            }
            final WildlifeZone zone = zones[index - 1];
            return WildlifeZoneCard(
              zone: zone,
              onTap: () => context.push('/wildlife/zones/${zone.id}'),
            );
          },
        ),
      ),
    );
  }
}
