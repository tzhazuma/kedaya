import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_providers.dart';
import '../../../../application/session_controller.dart';
import '../../../../data/mock/mock_controls.dart';
import '../../../../domain/models/campus_capability.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/mock_state_menu.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/techpie_providers.dart';
import '../components/techpie_cards.dart';

/// 能力清单页（路由 `/techpie/capabilities`）。
///
/// 这是"两级身份"最容易被做错的一页：**未绑定**与**未登录**必须给出
/// **两条不同的出路**（去绑定 / 去登录），而不是都当成一个错误。
/// 状态由 `resolveCampusCapabilities` 这个纯函数算出来，页面只负责展示与引导。
class TechpieCapabilitiesPage extends ConsumerWidget {
  const TechpieCapabilitiesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<CampusCapability>> value = ref.watch(
      campusCapabilitiesProvider,
    );
    final MockControls? mockControls = ref.watch(mockControlsProvider);

    return KedaYaPageScaffold(
      title: '能力清单',
      padding: EdgeInsets.zero,
      actions: <Widget>[
        if (mockControls != null)
          MockStateMenu(
            controls: mockControls,
            onChanged: () => ref.invalidate(campusCapabilitiesProvider),
          ),
        IconButton(
          tooltip: '刷新',
          onPressed: () => ref.invalidate(campusCapabilitiesProvider),
          icon: const Icon(Icons.refresh),
        ),
      ],
      child: AsyncStateView<List<CampusCapability>>(
        value: value,
        isEmpty: (List<CampusCapability> items) => items.isEmpty,
        emptyTitle: '能力清单为空',
        emptyDescription: '服务端没有返回任何校园能力。这不等于"没有数据"——'
            '如果刚才是解析失败，请重试（规格 §10.1 的 F7：状态未知与没有数据必须区分）。',
        loadingMessage: '正在读取能力清单…',
        onRetry: () => ref.invalidate(campusCapabilitiesProvider),
        builder: (BuildContext context, List<CampusCapability> items) => ListView(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          children: <Widget>[
            _CapabilitySummary(items: items),
            const SizedBox(height: KedaYaTokens.space4),
            for (final CampusCapabilityPhase phase
                in CampusCapabilityPhase.values)
              _PhaseSection(
                phase: phase,
                items: items
                    .where((CampusCapability item) => item.phase == phase)
                    .toList(growable: false),
                ref: ref,
              ),
          ],
        ),
      ),
    );
  }
}

/// 概览：四个计数，让"哪些能用、哪些要绑定、哪些要登录、哪些没做"一眼可见。
class _CapabilitySummary extends StatelessWidget {
  const _CapabilitySummary({required this.items});

  final List<CampusCapability> items;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final int usable = items.where((CampusCapability item) => item.isUsable).length;
    final int needBinding = items
        .where((CampusCapability item) => item.needsBinding)
        .length;
    final int needSignIn = items
        .where((CampusCapability item) => item.needsSignIn)
        .length;
    final int notImplemented = items
        .where((CampusCapability item) => !item.phase.isImplemented)
        .length;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            '共 ${items.length} 项',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              fontWeight: KedaYaTokens.fontWeightSemibold,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Wrap(
            spacing: KedaYaTokens.space2,
            runSpacing: KedaYaTokens.space1,
            children: <Widget>[
              TechpieBadge(
                label: '可用 $usable',
                tone: colors.success,
                icon: Icons.check_circle_outline,
              ),
              TechpieBadge(
                label: '需绑定 $needBinding',
                tone: colors.warning,
                icon: Icons.link,
              ),
              TechpieBadge(
                label: '需登录 $needSignIn',
                tone: colors.info,
                icon: Icons.login,
              ),
              TechpieBadge(
                label: '未实现 $notImplemented',
                tone: colors.textMuted,
                icon: Icons.construction,
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '「需绑定」= 已登录但没绑定（引导去绑定）；'
            '「需登录」= 还没登录（引导去登录）。这是两种不同的状态，'
            '混在一起会让已登录的用户被推去重新登录（契约 §5 硬规则 3）。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}

class _PhaseSection extends StatelessWidget {
  const _PhaseSection({
    required this.phase,
    required this.items,
    required this.ref,
  });

  final CampusCapabilityPhase phase;
  final List<CampusCapability> items;
  final WidgetRef ref;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    final KedaYaColors colors = context.kedayaColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const SizedBox(height: KedaYaTokens.space2),
        Text(
          phase.label,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeMd,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space1),
        Text(
          phase.blockingNote,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            height: KedaYaTokens.lineHeightNormal,
            color: colors.textMuted,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space3),
        for (final CampusCapability item in items)
          Padding(
            padding: const EdgeInsets.only(bottom: KedaYaTokens.space3),
            child: _tileFor(context, item),
          ),
      ],
    );
  }

  Widget _tileFor(BuildContext context, CampusCapability item) {
    final _Guide? guide = _guideFor(context, item);
    return CampusCapabilityTile(
      capability: item,
      onGuide: guide?.onTap,
      guideLabel: guide?.label,
    );
  }

  /// 未绑定 → 去绑定；未登录 → 去登录。**两条不同的出路**。
  _Guide? _guideFor(BuildContext context, CampusCapability item) {
    if (item.needsBinding) {
      return _Guide(
        label: '去绑定',
        onTap: () => context.push('/techpie/bindings'),
      );
    }
    if (item.needsSignIn) {
      return _Guide(
        label: '去登录',
        onTap: () async {
          // 一级身份的动作走它自己的控制器 —— 与二级绑定不是同一个对象。
          await ref.read(sessionControllerProvider.notifier).signIn();
        },
      );
    }
    return null;
  }
}

class _Guide {
  const _Guide({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;
}
