import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../domain/models/campus_portrait.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/ai_portrait_providers.dart';
import '../components/portrait_consent_gate.dart';
import '../components/portrait_demo_preview.dart';
import '../components/portrait_tag_tile.dart';

/// AI 校园画像（契约 §4.1 `ai-portrait`，敏感级 high）。
///
/// 产品边界：
///   - **只读**：不生成、不推断；没有画像就明确说没有；
///   - 每个标签都必须显示**来源 + 更新时间**（模型层强制）；
///   - 显著位置声明「心理支持与宿舍矛盾不参与画像」；
///   - 提供「删除我的画像」，删除后回到空态。
class AiPortraitPage extends StatelessWidget {
  const AiPortraitPage({super.key});

  @override
  Widget build(BuildContext context) {
    return KedaYaPageScaffold(
      title: 'AI 校园画像',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const _PortraitBoundaryBanner(),
          const SizedBox(height: KedaYaTokens.space3),
          Expanded(
            child: PortraitConsentGate(
              builder: (BuildContext context) => const _PortraitContent(),
            ),
          ),
        ],
      ),
    );
  }
}

/// 必须显著展示的边界声明。
class _PortraitBoundaryBanner extends StatelessWidget {
  const _PortraitBoundaryBanner();

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.info.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.info.withValues(alpha: 0.45)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.visibility_outlined, size: 20, color: colors.info),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  '心理支持与宿舍矛盾不参与画像',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightBold,
                    color: colors.text,
                  ),
                ),
                const SizedBox(height: KedaYaTokens.space1),
                Text(
                  '画像只读取你授权的数据；本页只展示已有画像，不生成、不推断。',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.textMuted,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PortraitContent extends ConsumerWidget {
  const _PortraitContent();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<CampusPortrait?> value = ref.watch(campusPortraitProvider);

    return ListView(
      padding: EdgeInsets.zero,
      children: <Widget>[
        Text(
          '画像只读：只展示已有画像，不生成、不推断，也不会为了填满而编造标签。'
          '删除按钮只删除本机保存的画像。',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            height: KedaYaTokens.lineHeightNormal,
            color: context.kedayaColors.textMuted,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space3),
        value.when(
          data: (CampusPortrait? portrait) {
            if (portrait == null || !portrait.hasTags) {
              return const KedaYaEmptyState(
                title: '暂无画像；画像需要足够的、你授权的数据',
                icon: Icons.insights_outlined,
                description: '数据不足时这里会保持为空。'
                    '本页不会在客户端推断标签，也不会读取心理支持或宿舍矛盾的数据。',
              );
            }
            return _PortraitCard(
              portrait: portrait,
              onDelete: () => _confirmDelete(context, ref),
            );
          },
          loading: () => const KedaYaLoadingState(
            message: '正在读取本机画像…',
          ),
          error: (Object error, StackTrace stackTrace) => KedaYaErrorState(
            error: error,
            onRetry: () => ref.read(campusPortraitProvider.notifier).refresh(),
          ),
        ),
        if (!value.isLoading && value.valueOrNull == null) ...<Widget>[
          const SizedBox(height: KedaYaTokens.space2),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              foregroundColor: context.kedayaColors.danger,
              side: BorderSide(color: context.kedayaColors.danger),
            ),
            onPressed: () => _confirmDelete(context, ref),
            icon: const Icon(Icons.delete_outline, size: 18),
            label: const Text('删除我的画像'),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            '当前没有画像；点击只会清空本机残留数据。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: context.kedayaColors.textMuted,
            ),
          ),
        ],
        const SizedBox(height: KedaYaTokens.space4),
        const PortraitDemoPreview(),
        const SizedBox(height: KedaYaTokens.space4),
        Text(
          '画像不读取心理支持、宿舍矛盾、找搭子匹配资料与反馈。'
          '删除只影响本机保存的画像，不会影响其他模块。',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            height: KedaYaTokens.lineHeightLoose,
            color: context.kedayaColors.textMuted,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space4),
      ],
    );
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('删除我的画像？'),
        content: const Text(
          '只删除本机保存的画像；如果当前没有画像，只会清空本机残留数据。'
          '删除后回到空态，本页不会自动重建，也不会影响心理支持或宿舍矛盾的数据。',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    try {
      await ref.read(campusPortraitProvider.notifier).delete();
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已删除本机画像')),
      );
    } on Object catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('删除失败：$error')),
      );
    }
  }
}

class _PortraitCard extends StatelessWidget {
  const _PortraitCard({required this.portrait, required this.onDelete});

  final CampusPortrait portrait;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  '我的画像',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeMd,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
              ),
              if (portrait.isDemo)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: KedaYaTokens.space2,
                    vertical: KedaYaTokens.space1,
                  ),
                  decoration: BoxDecoration(
                    color: colors.warning.withValues(alpha: 0.15),
                    borderRadius:
                        BorderRadius.circular(KedaYaTokens.radiusPill),
                  ),
                  child: Text(
                    '演示数据',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      fontWeight: KedaYaTokens.fontWeightMedium,
                      color: colors.warning,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            '更新时间：${formatPortraitTimestamp(portrait.updatedAt)}',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          for (int index = 0;
              index < portrait.tags.length;
              index++) ...<Widget>[
            if (index > 0) const SizedBox(height: KedaYaTokens.space2),
            PortraitTagTile(tag: portrait.tags[index]),
          ],
          const SizedBox(height: KedaYaTokens.space3),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              foregroundColor: colors.danger,
              side: BorderSide(color: colors.danger),
            ),
            onPressed: onDelete,
            icon: const Icon(Icons.delete_outline, size: 18),
            label: const Text('删除我的画像'),
          ),
        ],
      ),
    );
  }
}
