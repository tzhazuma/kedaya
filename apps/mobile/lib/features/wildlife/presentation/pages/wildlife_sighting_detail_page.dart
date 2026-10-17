import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../domain/models/api_error.dart';
import '../../../../domain/models/time_text.dart';
import '../../../../domain/models/wildlife.dart';
import '../../../../domain/models/wildlife_sighting.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/wildlife_providers.dart';
import '../components/wildlife_badges.dart';

/// 观测详情。
///
/// 三态：loading / error（可重试）/ **empty**（`NOT_FOUND` → "不存在或已下架"，
/// 与 `groupbuy` / `forum` 的详情页同构 —— 未公开的记录对非上报人按 404 处理，
/// 规格 §9.1 A3：不区分，避免成为"这条记录存在吗"的枚举旁路）。
class WildlifeSightingDetailPage extends ConsumerWidget {
  const WildlifeSightingDetailPage({required this.sightingId, super.key});

  final String sightingId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<WildlifeSighting> value = ref.watch(
      wildlifeSightingDetailProvider(sightingId),
    );
    return KedaYaPageScaffold(
      title: '观测详情',
      padding: EdgeInsets.zero,
      child: value.when(
        data: (WildlifeSighting sighting) => _SightingBody(sighting: sighting),
        loading: () => const KedaYaLoadingState(message: '正在加载观测详情…'),
        error: (Object error, StackTrace stackTrace) =>
            _buildError(context, ref, error),
      ),
    );
  }

  Widget _buildError(BuildContext context, WidgetRef ref, Object error) {
    if (error is ApiException && error.code == ApiErrorCode.notFound) {
      return const KedaYaEmptyState(
        title: '该观测不存在或未公开',
        description: '它可能还在审核中，或者已经被上报人撤回。',
        icon: Icons.visibility_off_outlined,
      );
    }
    return KedaYaErrorState(
      error: error,
      onRetry: () => ref.invalidate(wildlifeSightingDetailProvider(sightingId)),
    );
  }
}

class _SightingBody extends ConsumerWidget {
  const _SightingBody({required this.sighting});

  final WildlifeSighting sighting;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final DateFormat dateFormat = DateFormat('yyyy-MM-dd HH:mm');
    final List<WildlifeSpecies> species =
        ref.watch(wildlifeSpeciesProvider).valueOrNull ??
            const <WildlifeSpecies>[];

    return ListView(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Text(
                sighting.speciesNameZh ?? sighting.speciesId,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXl,
                  fontWeight: KedaYaTokens.fontWeightBold,
                  color: colors.text,
                ),
              ),
            ),
            WildlifeStatusBadge(status: sighting.status),
          ],
        ),
        const SizedBox(height: KedaYaTokens.space2),
        Wrap(
          spacing: KedaYaTokens.space2,
          runSpacing: KedaYaTokens.space1,
          children: <Widget>[
            if (sighting.zoneName != null)
              WildlifePill(
                  text: sighting.zoneName!, icon: Icons.place_outlined),
            if (sighting.individualName != null)
              WildlifePill(
                text: '个体：${sighting.individualName!}',
                icon: Icons.pets,
                tone: colors.brandStrong,
              ),
            WildlifePill(
                text: sighting.reporterLabel, icon: Icons.person_outline),
            if (sighting.isAnonymous)
              WildlifePill(text: '匿名上报', icon: Icons.visibility_off_outlined),
          ],
        ),
        const SizedBox(height: KedaYaTokens.space4),

        // 发现时间 vs 上报时间（规格 §11.10 A：两者语义不同，必须分开显示）
        _InfoCard(
          title: '时间',
          children: <Widget>[
            _InfoRow(
                label: '发现时间',
                value: dateFormat.format(sighting.observedAt.toLocal())),
            _InfoRow(
              label: '上报时间',
              value: dateFormat.format(sighting.createdAt.toLocal()),
            ),
            if (sighting.observedAtFuzzed != null)
              _InfoRow(
                label: '公开时间（粗化）',
                value: dateFormat.format(sighting.observedAtFuzzed!.toLocal()),
              ),
            _InfoRow(
              label: '相对现在',
              value: formatRelativeTime(sighting.observedAt),
            ),
            if (sighting.reportingDelay.inMinutes.abs() >= 30)
              _InfoRow(
                label: '补录',
                value:
                    '发现到上报相隔 ${formatRelativeTime(sighting.createdAt, now: sighting.observedAt)}',
              ),
          ],
        ),
        const SizedBox(height: KedaYaTokens.space3),

        if (sighting.healthConcern) ...<Widget>[
          const WildlifeHealthConcernNotice(),
          const SizedBox(height: KedaYaTokens.space3),
        ],

        if (sighting.note != null &&
            sighting.note!.trim().isNotEmpty) ...<Widget>[
          _InfoCard(
            title: '备注',
            children: <Widget>[
              Text(
                sighting.note!,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.text,
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space3),
        ],

        if (sighting.photoUrls.isNotEmpty)
          _InfoCard(
            title: '照片（${sighting.photoUrls.length}）',
            children: <Widget>[
              SizedBox(
                height: 120,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: sighting.photoUrls.length,
                  separatorBuilder: (BuildContext context, int index) =>
                      const SizedBox(width: KedaYaTokens.space2),
                  itemBuilder: (BuildContext context, int index) => ClipRRect(
                    borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
                    child: Image.network(
                      sighting.photoUrls[index],
                      width: 120,
                      height: 120,
                      fit: BoxFit.cover,
                      // mock 运行时没有真实图片：加载失败就显示占位图标，**不报错**。
                      errorBuilder: (BuildContext context, Object error,
                              StackTrace? stackTrace) =>
                          Container(
                        width: 120,
                        height: 120,
                        color: colors.surfaceAlt,
                        child: Icon(
                          Icons.image_not_supported_outlined,
                          color: colors.textMuted,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                '照片已由服务端剥离 EXIF（含 GPS），原图不会泄漏拍摄位置。',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.textMuted,
                ),
              ),
            ],
          ),
        const SizedBox(height: KedaYaTokens.space3),

        if (sighting.isAutoClassified) ...<Widget>[
          _InfoCard(
            title: '分类来源',
            children: <Widget>[
              _InfoRow(label: '来源', value: sighting.classifiedByLabel),
              if (sighting.autoConfidence != null)
                _InfoRow(
                  label: '自动置信度',
                  value: sighting.autoConfidence!.toStringAsFixed(2),
                ),
              if (sighting.wasCorrected)
                const _InfoRow(label: '人工纠正', value: '是（已记录为标注样本）'),
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                '识别结果仅供参考，请以人工确认为准；平台不保证识别准确率。',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.warning,
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space3),
        ],

        WildlifePrivacyNotice(hasGeo: sighting.hasGeo),
        const SizedBox(height: KedaYaTokens.space3),

        Row(
          children: <Widget>[
            Expanded(
              child: OutlinedButton.icon(
                onPressed: species.isEmpty
                    ? null
                    : () => unawaited(
                          _showCorrectSpeciesSheet(
                              context, ref, sighting, species),
                        ),
                icon: const Icon(Icons.edit_outlined, size: 16),
                label: const Text('纠正物种'),
              ),
            ),
            const SizedBox(width: KedaYaTokens.space2),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () =>
                    unawaited(_confirmWithdraw(context, ref, sighting)),
                icon: const Icon(Icons.delete_outline, size: 16),
                label: const Text('撤回'),
              ),
            ),
          ],
        ),
        const SizedBox(height: KedaYaTokens.space2),
        Text(
          '纠正与撤回只对自己上报的记录有效；纠正会把「被纠正的物种」记录为标注样本，'
          '用于以后改进自动识别。',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            height: KedaYaTokens.lineHeightNormal,
            color: colors.textMuted,
          ),
        ),
      ],
    );
  }

  Future<void> _showCorrectSpeciesSheet(
    BuildContext context,
    WidgetRef ref,
    WildlifeSighting sighting,
    List<WildlifeSpecies> species,
  ) =>
      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (BuildContext sheetContext) => SafeArea(
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.all(KedaYaTokens.space4),
            children: <Widget>[
              Text(
                '纠正物种',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeLg,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  color: sheetContext.kedayaColors.text,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space2),
              for (final WildlifeSpecies item in species)
                ListTile(
                  dense: true,
                  title: Text(item.displayName),
                  subtitle: Text(item.scientificName),
                  trailing: item.id == sighting.speciesId
                      ? const Icon(Icons.check, size: 18)
                      : null,
                  onTap: () async {
                    Navigator.of(sheetContext).pop();
                    final WildlifeActions actions =
                        ref.read(wildlifeActionsProvider);
                    try {
                      await actions.correctSpecies(sighting.id,
                          speciesId: item.id);
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('已纠正为「${item.displayName}」')),
                        );
                      }
                    } on Object catch (error) {
                      if (context.mounted) {
                        ScaffoldMessenger.of(
                          context,
                        ).showSnackBar(SnackBar(content: Text('$error')));
                      }
                    }
                  },
                ),
            ],
          ),
        ),
      );

  Future<void> _confirmWithdraw(
    BuildContext context,
    WidgetRef ref,
    WildlifeSighting sighting,
  ) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('撤回这条上报？'),
        content: const Text('撤回后它将不再出现在列表里（软删）。'),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('撤回'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    try {
      await ref.read(wildlifeActionsProvider).withdraw(sighting.id);
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('已撤回')));
        Navigator.of(context).maybePop();
      }
    } on Object catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('撤回失败：$error')));
      }
    }
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            title,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              fontWeight: KedaYaTokens.fontWeightSemibold,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          ...children,
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
            width: 96,
            child: Text(
              label,
              style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs, color: colors.textMuted),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm, color: colors.text),
            ),
          ),
        ],
      ),
    );
  }
}
