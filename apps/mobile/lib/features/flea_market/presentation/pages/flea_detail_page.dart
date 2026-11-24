import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../domain/models/flea_listing.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/flea_market_providers.dart';
import '../components/flea_tags.dart';

/// 闲置详情（`/flea-market/:id`）。
///
/// 两个动作：
///   - 「复制联系文案」—— 把标题 / 价格 / 成色 / 地点拼成一段可粘贴文本；
///   - 「下架 / 重新上架」—— **只有自己的发布**才出现。
///
/// 没有聊天、没有手机号：对方怎么联系由用户自己决定。
class FleaDetailPage extends ConsumerWidget {
  const FleaDetailPage({required this.listingId, super.key});

  final String listingId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final List<FleaListing> listings = ref.watch(fleaMarketListingsProvider);
    FleaListing? listing;
    for (final FleaListing item in listings) {
      if (item.id == listingId) {
        listing = item;
        break;
      }
    }

    if (listing == null) {
      return KedaYaPageScaffold(
        title: '闲置详情',
        child: KedaYaEmptyState(
          title: '这条发布不在了',
          description: '可能已经被删除，或者链接不对。回到列表看看其他闲置。',
          icon: Icons.search_off_outlined,
        ),
      );
    }

    final KedaYaColors colors = context.kedayaColors;
    final DateTime now = ref.watch(fleaMarketClockProvider)();
    final FleaListing item = listing;

    return Scaffold(
      appBar: AppBar(title: const Text('闲置详情')),
      body: SafeArea(
        top: false,
        child: ListView(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          children: <Widget>[
            Text(
              item.title,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXl,
                fontWeight: KedaYaTokens.fontWeightBold,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.text,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space2),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: <Widget>[
                Text(
                  formatFleaPrice(item.priceFen),
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeDisplay,
                    fontWeight: KedaYaTokens.fontWeightBold,
                    color: colors.brandStrong,
                  ),
                ),
                const SizedBox(width: KedaYaTokens.space2),
                Padding(
                  padding: const EdgeInsets.only(bottom: KedaYaTokens.space1),
                  child: FleaTag(
                    text: item.condition.label,
                    tone: FleaTagTone.success,
                  ),
                ),
              ],
            ),
            const SizedBox(height: KedaYaTokens.space3),
            Wrap(
              spacing: KedaYaTokens.space2,
              runSpacing: KedaYaTokens.space1,
              children: <Widget>[
                FleaTag(text: item.category.label, tone: FleaTagTone.brand),
                if (item.isMine)
                  const FleaTag(
                    text: '我发布的',
                    tone: FleaTagTone.brand,
                    icon: Icons.person_outline,
                  ),
                if (!item.active)
                  const FleaTag(
                    text: '已下架',
                    tone: FleaTagTone.danger,
                    icon: Icons.visibility_off_outlined,
                  ),
              ],
            ),
            const SizedBox(height: KedaYaTokens.space4),
            Card(
              margin: EdgeInsets.zero,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: KedaYaTokens.space4,
                  vertical: KedaYaTokens.space2,
                ),
                child: Column(
                  children: <Widget>[
                    _InfoRow(
                      icon: Icons.place_outlined,
                      label: '交易地点',
                      value: item.location,
                    ),
                    Divider(height: 1, color: colors.border),
                    _InfoRow(
                      icon: Icons.schedule,
                      label: '发布时间',
                      value: describeFleaPostedAt(item, now),
                    ),
                    Divider(height: 1, color: colors.border),
                    _InfoRow(
                      icon: Icons.sell_outlined,
                      label: '分类',
                      value: item.category.label,
                    ),
                  ],
                ),
              ),
            ),
            if (item.description.trim().isNotEmpty) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space3),
              Card(
                margin: EdgeInsets.zero,
                child: Padding(
                  padding: const EdgeInsets.all(KedaYaTokens.space4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        '物品描述',
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeSm,
                          fontWeight: KedaYaTokens.fontWeightSemibold,
                          color: colors.text,
                        ),
                      ),
                      const SizedBox(height: KedaYaTokens.space2),
                      Text(
                        item.description,
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeSm,
                          height: KedaYaTokens.lineHeightLoose,
                          color: colors.text,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: KedaYaTokens.space3),
            Container(
              padding: const EdgeInsets.all(KedaYaTokens.space3),
              decoration: BoxDecoration(
                color: colors.warning.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
                border:
                    Border.all(color: colors.warning.withValues(alpha: 0.35)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Icon(Icons.shield_outlined, size: 18, color: colors.warning),
                  const SizedBox(width: KedaYaTokens.space2),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          '当面交易 · 先验货再付款',
                          style: TextStyle(
                            fontSize: KedaYaTokens.fontSizeSm,
                            fontWeight: KedaYaTokens.fontWeightSemibold,
                            color: colors.text,
                          ),
                        ),
                        const SizedBox(height: KedaYaTokens.space1),
                        Text(
                          '平台不保存手机号，也不提供站内聊天。复制联系文案后自己发给对方；'
                          '不要提前转账，不要发验证码。',
                          style: TextStyle(
                            fontSize: KedaYaTokens.fontSizeXs,
                            height: KedaYaTokens.lineHeightNormal,
                            color: colors.text,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: colors.surface,
          border: Border(top: BorderSide(color: colors.border)),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.all(KedaYaTokens.space3),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => unawaited(_copyContact(context, item)),
                    icon: const Icon(Icons.copy_all_outlined, size: 18),
                    label: const Text('复制联系文案'),
                  ),
                ),
                if (item.isMine) ...<Widget>[
                  const SizedBox(width: KedaYaTokens.space2),
                  OutlinedButton.icon(
                    onPressed: () => _toggleActive(context, ref, item),
                    icon: Icon(
                      item.active
                          ? Icons.visibility_off_outlined
                          : Icons.refresh,
                      size: 18,
                    ),
                    label: Text(item.active ? '下架' : '重新上架'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _copyContact(BuildContext context, FleaListing listing) async {
    await Clipboard.setData(ClipboardData(text: buildFleaContactText(listing)));
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('联系文案已复制，粘贴给对方即可')),
    );
  }

  void _toggleActive(BuildContext context, WidgetRef ref, FleaListing listing) {
    final bool next = !listing.active;
    try {
      ref.read(fleaMarketListingsProvider.notifier).setActive(listing.id, next);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(next ? '已重新上架' : '已下架，别人在「全部」里看不到这条了'),
        ),
      );
    } on Object catch (error) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$error')),
      );
    }
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: KedaYaTokens.space3),
      child: Row(
        children: <Widget>[
          Icon(icon, size: 18, color: colors.textMuted),
          const SizedBox(width: KedaYaTokens.space2),
          Text(
            label,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: colors.text,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
