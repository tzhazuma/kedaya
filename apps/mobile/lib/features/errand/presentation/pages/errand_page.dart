import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/errand_task.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/errand_providers.dart';
import '../../domain/errand_board.dart';
import '../components/errand_card.dart';
import '../components/errand_demo_notice.dart';

/// 跑腿首页：待接单 / 进行中 / 已完成。
class ErrandPage extends ConsumerStatefulWidget {
  const ErrandPage({super.key});

  @override
  ConsumerState<ErrandPage> createState() => _ErrandPageState();
}

class _ErrandPageState extends ConsumerState<ErrandPage> {
  /// 倒计时会走 —— 30 秒重画一次，避免「还有 50 分钟」停在打开页面那一刻。
  Timer? _ticker;

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

  @override
  Widget build(BuildContext context) {
    final DateTime now = ref.watch(errandClockProvider)();

    return DefaultTabController(
      length: ErrandTab.values.length,
      child: KedaYaPageScaffold(
        title: '跑腿',
        padding: EdgeInsets.zero,
        actions: <Widget>[
          TextButton.icon(
            onPressed: () => context.push('/errand/new'),
            icon: const Icon(Icons.add, size: 18),
            label: const Text('发布'),
          ),
        ],
        bottom: const TabBar(
          tabs: <Widget>[
            Tab(text: '待接单'),
            Tab(text: '进行中'),
            Tab(text: '已完成'),
          ],
        ),
        child: Column(
          children: <Widget>[
            const Padding(
              padding: EdgeInsets.fromLTRB(
                KedaYaTokens.space4,
                KedaYaTokens.space3,
                KedaYaTokens.space4,
                0,
              ),
              child: ErrandDemoNotice(),
            ),
            Expanded(
              child: TabBarView(
                children: <Widget>[
                  for (final ErrandTab tab in ErrandTab.values)
                    _ErrandTabView(tab: tab, now: now),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrandTabView extends ConsumerWidget {
  const _ErrandTabView({required this.tab, required this.now});

  final ErrandTab tab;
  final DateTime now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final List<ErrandTask> tasks = ref.watch(errandTasksByTabProvider(tab));

    if (tasks.isEmpty) {
      return ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          KedaYaEmptyState(
            title: _emptyTitle(tab),
            description: _emptyDescription(tab),
            icon: _emptyIcon(tab),
          ),
        ],
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      itemCount: tasks.length,
      separatorBuilder: (BuildContext context, int index) =>
          const SizedBox(height: KedaYaTokens.space3),
      itemBuilder: (BuildContext context, int index) {
        final ErrandTask task = tasks[index];
        return ErrandCard(
          task: task,
          now: now,
          onTap: () => context.push('/errand/${task.id}'),
        );
      },
    );
  }

  String _emptyTitle(ErrandTab tab) => switch (tab) {
        ErrandTab.open => '还没有待接单的跑腿',
        ErrandTab.inProgress => '没有进行中的跑腿',
        ErrandTab.completed => '还没有完成记录',
      };

  String _emptyDescription(ErrandTab tab) => switch (tab) {
        ErrandTab.open => '这里用来发布「帮我取一下 / 带一份」的小任务：'
            '写清取件点、送达点、报酬和截止时间，别人接单后按流程完成。'
            '第一条任务可能就来自你。',
        ErrandTab.inProgress => '接单后的任务会出现在这里；'
            '送达后点「完成」，任务会移到「已完成」。',
        ErrandTab.completed => '完成的跑腿会留在这里，方便回看。'
            '演示数据只保存在本机，重启后会回到示例内容。',
      };

  IconData _emptyIcon(ErrandTab tab) => switch (tab) {
        ErrandTab.open => Icons.directions_run_outlined,
        ErrandTab.inProgress => Icons.pending_actions_outlined,
        ErrandTab.completed => Icons.task_alt_outlined,
      };
}
