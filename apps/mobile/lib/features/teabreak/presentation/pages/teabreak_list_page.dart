import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_providers.dart';
import '../../../../data/mock/mock_controls.dart';
import '../../../../domain/models/api_error.dart';
import '../../../../domain/models/teabreak.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/components/mock_state_menu.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/teabreak_providers.dart';
import '../components/teabreak_card.dart';

/// 学术会议茶歇列表（契约 §4.1 `teabreak`）。
///
/// 三条产品约束直接体现在这个页面里：
///   1. **排序不是按时间，是按「值不值得现在跑一趟」** —— 用 `sortTeabreaks`；
///   2. **时效必须可见** —— 每条都带 freshness 徽章与「还有 X 分钟结束」；
///   3. **空态要解释这个功能是干什么的** —— 空列表不是错误，是"还没人报"。
class TeabreakListPage extends ConsumerStatefulWidget {
  const TeabreakListPage({super.key});

  @override
  ConsumerState<TeabreakListPage> createState() => _TeabreakListPageState();
}

class _TeabreakListPageState extends ConsumerState<TeabreakListPage> {
  /// 倒计时会走 —— 30 秒重画一次，让「还有 X 分钟」不至于停在打开页面那一刻。
  Timer? _ticker;

  /// 正在提交「确认还有」的条目（防重复点击）。
  final Set<String> _confirming = <String>{};

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

  Future<void> _confirm(Teabreak teabreak) async {
    setState(() => _confirming.add(teabreak.id));
    try {
      await ref.read(teabreakActionsProvider).confirm(teabreak.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已确认还有。谢谢，你的 20 分钟是别人的晚饭。')),
      );
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_messageOf(error))),
      );
    } finally {
      if (mounted) setState(() => _confirming.remove(teabreak.id));
    }
  }

  String _messageOf(Object error) =>
      error is ApiException ? error.error.userMessage : '$error';

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<Teabreak>> value =
        ref.watch(teabreakListControllerProvider);
    final TeabreakListController controller =
        ref.read(teabreakListControllerProvider.notifier);
    final DateTime now = ref.watch(teabreakClockProvider)();
    final MockControls? mockControls = ref.watch(mockControlsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('学术会议茶歇'),
        actions: <Widget>[
          if (mockControls != null)
            MockStateMenu(
              controls: mockControls,
              onChanged: () =>
                  ref.invalidate(teabreakListControllerProvider),
            ),
          IconButton(
            tooltip: '刷新',
            onPressed: controller.refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Column(
        children: <Widget>[
          const Padding(
            padding: EdgeInsets.fromLTRB(
              KedaYaTokens.space4,
              KedaYaTokens.space3,
              KedaYaTokens.space4,
              0,
            ),
            child: TeabreakIntro(),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: controller.refresh,
              child: AsyncStateView<List<Teabreak>>(
                value: value,
                isEmpty: (List<Teabreak> items) => items.isEmpty,
                emptyTitle: '还没有人报茶歇',
                emptyDescription: '这个功能用来共享校内学术会议的茶歇：'
                    '有人把会议的时间、地点和「有没有点心」报上来，'
                    '你就能知道现在哪栋楼可以过去。'
                    '第一条信息可能就来自你。',
                loadingMessage: '正在看哪栋楼有点心…',
                onRetry: controller.refresh,
                builder: (BuildContext context, List<Teabreak> items) =>
                    ListView.separated(
                  padding: const EdgeInsets.all(KedaYaTokens.space4),
                  itemCount: items.length,
                  separatorBuilder: (BuildContext context, int index) =>
                      const SizedBox(height: KedaYaTokens.space3),
                  itemBuilder: (BuildContext context, int index) {
                    final Teabreak teabreak = items[index];
                    final TeabreakStatus status = teabreak.statusAt(now);
                    return TeabreakCard(
                      teabreak: teabreak,
                      now: now,
                      isConfirming: _confirming.contains(teabreak.id),
                      // `over` 的条目不给「确认还有」——盖棺的东西不需要再确认。
                      onConfirm: status.freshness == TeabreakFreshness.over
                          ? null
                          : () => unawaited(_confirm(teabreak)),
                    );
                  },
                ),
              ),
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/teabreak/compose'),
        icon: const Icon(Icons.add),
        label: const Text('报一个茶歇'),
      ),
    );
  }
}

/// 页首说明卡（空态时也在，因此"这是干什么的"永远可见）。
class TeabreakIntro extends StatelessWidget {
  const TeabreakIntro({super.key});

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
              Icon(Icons.local_cafe_outlined,
                  size: 18, color: colors.brandStrong),
              const SizedBox(width: KedaYaTokens.space2),
              Text(
                '现在哪栋楼有点心？',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  color: colors.text,
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            '会议茶歇通常只有 15–30 分钟。列表按「值不值得现在跑一趟」排序：'
            '20 分钟内有人确认过的是「刚确认还有」，久了只能说「可能还有」。'
            '开放程度（对外 / 仅限注册）也已标出，去不去自己判断。',
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
