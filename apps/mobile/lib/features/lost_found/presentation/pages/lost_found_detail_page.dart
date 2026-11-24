import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../domain/models/lost_found_item.dart';
import '../../../../domain/models/time_text.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/lost_found_providers.dart';
import '../components/lost_found_pill.dart';

/// 详情页：完整字段 + 标记已解决 + 复制描述。
class LostFoundDetailPage extends ConsumerWidget {
  const LostFoundDetailPage({required this.itemId, super.key});

  final String itemId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final LostFoundItem? item = ref.watch(lostFoundItemProvider(itemId));

    if (item == null) {
      final KedaYaColors colors = context.kedayaColors;
      return KedaYaPageScaffold(
        title: '失物招领详情',
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                Icons.search_off,
                size: 40,
                color: colors.textMuted,
              ),
              const SizedBox(height: KedaYaTokens.space3),
              Text(
                '这条信息不在了',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeMd,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  color: colors.text,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                '可能已经被删除，或者链接不对。回到列表看看其他信息。',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  height: KedaYaTokens.lineHeightLoose,
                  color: colors.textMuted,
                ),
              ),
            ],
          ),
        ),
      );
    }

    final KedaYaColors colors = context.kedayaColors;
    final bool isLost = item.kind == LostFoundKind.lost;
    final Color kindColor = isLost ? colors.warning : colors.success;
    final Color statusColor = item.isResolved ? colors.success : colors.info;
    final DateTime now = ref.watch(lostFoundClockProvider)();
    final String description = (item.description ?? '').trim();
    final String contact = (item.contact ?? '').trim();

    return KedaYaPageScaffold(
      title: '失物招领详情',
      padding: EdgeInsets.zero,
      child: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          Row(
            children: <Widget>[
              LostFoundPill(
                label: isLost ? '寻物' : '招领',
                color: kindColor,
              ),
              const SizedBox(width: KedaYaTokens.space1),
              LostFoundPill(
                label: item.isResolved ? '已解决' : item.status.label,
                color: statusColor,
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space3),
          Text(
            item.title,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXl,
              fontWeight: KedaYaTokens.fontWeightBold,
              height: KedaYaTokens.lineHeightTight,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          if (item.location != null && item.location!.trim().isNotEmpty)
            _DetailRow(
              icon: Icons.place_outlined,
              label: '地点',
              value: item.location!,
            ),
          if (item.occurredAt != null) ...<Widget>[
            _DetailRow(
              icon: Icons.schedule_outlined,
              label: '时间',
              value: formatDetailDateTime(item.occurredAt!),
            ),
            _DetailRow(
              icon: Icons.hourglass_bottom_outlined,
              label: '相对',
              value: formatRelativeTime(item.occurredAt!, now: now),
            ),
          ],
          _DetailRow(
            icon: Icons.publish_outlined,
            label: '发布',
            value: formatDetailDateTime(item.createdAt),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _SectionTitle(text: '描述'),
          const SizedBox(height: KedaYaTokens.space1),
          SelectableText(
            description.isEmpty ? '发布者没有填写描述。' : description,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightLoose,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _SectionTitle(text: '联系方式'),
          const SizedBox(height: KedaYaTokens.space1),
          SelectableText(
            contact.isEmpty ? '发布者没有留联系方式。' : contact,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightLoose,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            '联系方式由发布者填写，请注意甄别；建议优先使用站内留言。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space5),
          if (item.isOpen) ...<Widget>[
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: () => _resolve(context, ref, item),
                icon: const Icon(Icons.check_circle_outline, size: 18),
                label: const Text('标记已解决'),
              ),
            ),
            const SizedBox(height: KedaYaTokens.space2),
          ],
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => _copyDescription(context, description),
              icon: const Icon(Icons.copy_all_outlined, size: 18),
              label: const Text('复制描述'),
            ),
          ),
          if (item.isResolved) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space3),
            Text(
              '这条信息已标记为已解决；如果又需要跟进，可以重新发布一条。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightLoose,
                color: colors.textMuted,
              ),
            ),
          ],
        ],
      ),
    );
  }

  void _resolve(BuildContext context, WidgetRef ref, LostFoundItem item) {
    ref.read(lostFoundFeedProvider.notifier).resolve(item.id);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('已标记为已解决。')),
    );
  }

  Future<void> _copyDescription(BuildContext context, String text) async {
    if (text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('这条信息没有描述可复制。')),
      );
      return;
    }

    await Clipboard.setData(ClipboardData(text: text));
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('描述已复制。')),
    );
  }
}

/// `2026年11月24日 12:30`（本地时区）。
String formatDetailDateTime(DateTime value) {
  final DateTime local = value.isUtc ? value.toLocal() : value;
  final String hour = local.hour.toString().padLeft(2, '0');
  final String minute = local.minute.toString().padLeft(2, '0');
  return '${local.year}年${local.month}月${local.day}日 $hour:$minute';
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
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
      padding: const EdgeInsets.only(bottom: KedaYaTokens.space2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, size: 16, color: colors.textMuted),
          const SizedBox(width: KedaYaTokens.space2),
          SizedBox(
            width: 48,
            child: Text(
              label,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: colors.textMuted,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
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

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: TextStyle(
        fontSize: KedaYaTokens.fontSizeMd,
        fontWeight: KedaYaTokens.fontWeightSemibold,
        color: context.kedayaColors.text,
      ),
    );
  }
}
