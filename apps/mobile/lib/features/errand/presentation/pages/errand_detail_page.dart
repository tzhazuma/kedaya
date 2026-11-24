import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../domain/models/errand_task.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/errand_providers.dart';
import '../../data/errand_repository.dart';
import '../../domain/errand_board.dart';
import '../components/errand_demo_notice.dart';
import '../components/errand_status_badge.dart';

/// 跑腿详情：完整信息 + 本机状态操作（接单 / 完成）。
class ErrandDetailPage extends ConsumerStatefulWidget {
  const ErrandDetailPage({required this.taskId, super.key});

  final String taskId;

  @override
  ConsumerState<ErrandDetailPage> createState() => _ErrandDetailPageState();
}

class _ErrandDetailPageState extends ConsumerState<ErrandDetailPage> {
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

  void _accept(ErrandTask task) {
    try {
      ref.read(errandTasksProvider.notifier).accept(task.id);
      _show('已接单。演示：不会真的通知对方。');
    } on ErrandException catch (error) {
      _show(error.message);
    }
  }

  void _complete(ErrandTask task) {
    try {
      ref.read(errandTasksProvider.notifier).complete(task.id);
      _show('已标记完成。演示：不会真的通知对方。');
    } on ErrandException catch (error) {
      _show(error.message);
    }
  }

  void _show(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final ErrandTask? task = ref.watch(errandTaskProvider(widget.taskId));
    final DateTime now = ref.watch(errandClockProvider)();

    if (task == null) {
      return const KedaYaPageScaffold(
        title: '跑腿详情',
        child: KedaYaEmptyState(
          title: '这条跑腿不存在',
          description: '它可能已经被删除，或者链接不完整。回到列表看看别的任务吧。',
          icon: Icons.search_off_outlined,
        ),
      );
    }

    final KedaYaColors colors = context.kedayaColors;
    final bool passed = errandDeadlinePassed(task.deadline, now);

    return KedaYaPageScaffold(
      title: '跑腿详情',
      padding: EdgeInsets.zero,
      child: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              ErrandStatusBadge(status: task.status),
              const Spacer(),
              Text(
                '¥${task.rewardYuan}',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXxl,
                  fontWeight: KedaYaTokens.fontWeightBold,
                  color: colors.brandStrong,
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            task.title,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeLg,
              fontWeight: KedaYaTokens.fontWeightSemibold,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space4),
          Container(
            padding: const EdgeInsets.all(KedaYaTokens.space4),
            decoration: BoxDecoration(
              color: colors.surfaceAlt,
              borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
            ),
            child: Column(
              children: <Widget>[
                _InfoRow(
                  icon: Icons.trip_origin,
                  label: '取件点',
                  value: errandPickupText(task),
                ),
                _InfoRow(
                  icon: Icons.place_outlined,
                  label: '送达点',
                  value: errandDeliveryText(task),
                ),
                _InfoRow(
                  icon: Icons.timer_outlined,
                  label: '截止时间',
                  value: task.deadline == null
                      ? '不设截止'
                      : '${formatErrandDateTime(task.deadline!)}'
                          '（${errandDeadlineText(task.deadline, now)}）',
                  tone: passed ? colors.danger : colors.text,
                ),
                _InfoRow(
                  icon: Icons.person_outline,
                  label: '发布者',
                  value: errandPosterAlias(task),
                ),
                _InfoRow(
                  icon: Icons.directions_run_outlined,
                  label: '接单人',
                  value: _runnerText(task),
                ),
                _InfoRow(
                  icon: Icons.schedule_outlined,
                  label: '发布时间',
                  value: formatErrandDateTime(task.createdAt),
                  isLast: true,
                ),
              ],
            ),
          ),
          if (task.note != null && task.note!.trim().isNotEmpty) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space4),
            Text(
              '备注',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                fontWeight: KedaYaTokens.fontWeightSemibold,
                color: colors.text,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              task.note!,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                height: KedaYaTokens.lineHeightLoose,
                color: colors.text,
              ),
            ),
          ],
          const SizedBox(height: KedaYaTokens.space4),
          const ErrandDemoNotice(),
          const SizedBox(height: KedaYaTokens.space4),
          _buildAction(task, colors),
        ],
      ),
    );
  }

  String _runnerText(ErrandTask task) {
    if (task.runnerId == null) return '还没人接单';
    if (task.runnerId == errandCurrentUserId) return '我（本机演示）';
    return '其他同学';
  }

  Widget _buildAction(ErrandTask task, KedaYaColors colors) {
    if (task.status == ErrandStatus.open) {
      return SizedBox(
        width: double.infinity,
        child: FilledButton.icon(
          onPressed: () => _accept(task),
          icon: const Icon(Icons.handshake_outlined, size: 18),
          label: const Text('接单'),
        ),
      );
    }
    if (task.status == ErrandStatus.accepted ||
        task.status == ErrandStatus.delivered) {
      return SizedBox(
        width: double.infinity,
        child: FilledButton.icon(
          onPressed: () => _complete(task),
          icon: const Icon(Icons.task_alt_outlined, size: 18),
          label: const Text('完成'),
        ),
      );
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Row(
        children: <Widget>[
          Icon(
            task.status == ErrandStatus.completed
                ? Icons.check_circle_outline
                : Icons.lock_outline,
            size: 18,
            color: colors.textMuted,
          ),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              task.status == ErrandStatus.completed
                  ? '这条跑腿已完成，页面为只读。'
                  : '当前状态不可操作。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: colors.textMuted,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
    this.tone,
    this.isLast = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color? tone;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Padding(
      padding: EdgeInsets.only(
        bottom: isLast ? 0 : KedaYaTokens.space3,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, size: 16, color: colors.textMuted),
          const SizedBox(width: KedaYaTokens.space2),
          SizedBox(
            width: 64,
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
                height: KedaYaTokens.lineHeightNormal,
                color: tone ?? colors.text,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
