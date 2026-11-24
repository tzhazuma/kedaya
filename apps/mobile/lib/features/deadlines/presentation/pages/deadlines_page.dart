import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/deadline_item.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/deadlines_providers.dart';
import '../components/deadline_card.dart';
import '../components/deadline_summary.dart';

/// 建议路由（在 `lib/app/app_router.dart` 注册后生效）。
const String deadlinesRoutePath = '/deadlines';
const String deadlineComposeRoutePath = '/deadlines/new';

/// DDL 聚合（`deadlines`）。
///
/// 三条产品约束直接体现在页面上：
/// 1. 列表**按截止时间升序**，逾期文案是「已逾期 N 天」并标红；
/// 2. 统计条统计全部条目，不受筛选 chips 影响；
/// 3. **DDL 不写入课程表** —— 页首写清楚，两个模块互不影响。
class DeadlinesPage extends ConsumerStatefulWidget {
  const DeadlinesPage({super.key});

  @override
  ConsumerState<DeadlinesPage> createState() => _DeadlinesPageState();
}

class _DeadlinesPageState extends ConsumerState<DeadlinesPage> {
  /// 倒计时会走 —— 30 秒重画一次，避免「还有 3 小时」停在打开页面那一刻。
  Timer? _ticker;

  /// 正在提交的条目（防重复点击）。
  final Set<String> _busy = <String>{};

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 30), (Timer timer) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _toggle(DeadlineItem item, bool completed) async {
    if (_busy.contains(item.id)) return;
    setState(() => _busy.add(item.id));
    try {
      await ref
          .read(deadlinesControllerProvider.notifier)
          .setCompleted(item.id, completed);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            completed ? '已标记完成：${item.title}' : '已恢复未完成：${item.title}',
          ),
        ),
      );
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$error')),
      );
    } finally {
      if (mounted) setState(() => _busy.remove(item.id));
    }
  }

  Future<void> _delete(DeadlineItem item) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('删除这条 DDL？'),
        content: Text('「${item.title}」会从本机列表移除，删除后不可恢复。'),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: TextButton.styleFrom(
              foregroundColor: context.kedayaColors.danger,
            ),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _busy.add(item.id));
    try {
      await ref.read(deadlinesControllerProvider.notifier).delete(item.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('已删除：${item.title}')),
      );
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$error')),
      );
    } finally {
      if (mounted) setState(() => _busy.remove(item.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final DateTime now = ref.watch(deadlinesClockProvider)();
    final AsyncValue<List<DeadlineItem>> value =
        ref.watch(deadlinesControllerProvider);
    final DeadlineFilter filter = ref.watch(deadlineFilterProvider);
    final DeadlinesController controller =
        ref.read(deadlinesControllerProvider.notifier);

    final List<DeadlineItem>? all = value.valueOrNull;
    final DeadlineStats? stats = all == null ? null : deadlineStats(all, now);
    final AsyncValue<List<DeadlineItem>> visible =
        value.whenData((List<DeadlineItem> items) {
      return filterDeadlines(items, filter, now);
    });
    final bool filtered = filter != DeadlineFilter.all;

    return Scaffold(
      appBar: AppBar(
        title: const Text('DDL 聚合'),
        actions: <Widget>[
          IconButton(
            tooltip: '刷新',
            onPressed: controller.refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push(deadlineComposeRoutePath),
        icon: const Icon(Icons.add),
        label: const Text('新增 DDL'),
      ),
      body: SafeArea(
        child: Column(
          children: <Widget>[
            const Padding(
              padding: EdgeInsets.fromLTRB(
                KedaYaTokens.space4,
                KedaYaTokens.space3,
                KedaYaTokens.space4,
                0,
              ),
              child: DeadlineIntro(),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                KedaYaTokens.space4,
                KedaYaTokens.space2,
                KedaYaTokens.space4,
                0,
              ),
              child: DeadlineStatsBar(stats: stats, now: now),
            ),
            DeadlineFilterBar(
              selected: filter,
              onSelected: (DeadlineFilter next) =>
                  ref.read(deadlineFilterProvider.notifier).state = next,
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: controller.refresh,
                child: AsyncStateView<List<DeadlineItem>>(
                  value: visible,
                  isEmpty: (List<DeadlineItem> items) => items.isEmpty,
                  emptyTitle: filtered ? '没有符合筛选的 DDL' : '还没有 DDL',
                  emptyDescription: filtered
                      ? '试试切换到「全部」，或者新增一条 DDL。'
                      : 'DDL 不写入课程表：作业、考试、报名与其它截止日期都在这里管。'
                          '点右下角「新增 DDL」记一条，逾期条目也可以补记。',
                  loadingMessage: '正在整理 DDL…',
                  onRetry: controller.refresh,
                  builder: (BuildContext context, List<DeadlineItem> items) =>
                      ListView.separated(
                    key: const Key('deadline-list'),
                    padding: const EdgeInsets.fromLTRB(
                      KedaYaTokens.space4,
                      KedaYaTokens.space3,
                      KedaYaTokens.space4,
                      KedaYaTokens.space12,
                    ),
                    itemCount: items.length,
                    separatorBuilder: (BuildContext context, int index) =>
                        const SizedBox(height: KedaYaTokens.space2),
                    itemBuilder: (BuildContext context, int index) {
                      final DeadlineItem item = items[index];
                      return DeadlineCard(
                        key: ValueKey<String>('deadline-${item.id}'),
                        item: item,
                        now: now,
                        busy: _busy.contains(item.id),
                        onToggle: (bool completed) =>
                            unawaited(_toggle(item, completed)),
                        onDelete: () => unawaited(_delete(item)),
                      );
                    },
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 页首说明：本模块的边界（不写课程表）。
class DeadlineIntro extends StatelessWidget {
  const DeadlineIntro({super.key});

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.brandSoft,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                Icons.event_busy_outlined,
                size: 18,
                color: colors.brandStrong,
              ),
              const SizedBox(width: KedaYaTokens.space2),
              Expanded(
                child: Text(
                  'DDL 不写入课程表',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            '作业、考试、报名与其它截止日期都聚在这里，按截止时间升序排列；'
            '勾选完成后仍留在列表里，可以随时取消。'
            '这里只是本机记录，不写入课表，也不会自动生成提醒。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.text,
            ),
          ),
        ],
      ),
    );
  }
}
