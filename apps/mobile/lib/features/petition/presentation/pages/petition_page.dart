import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/petition_ticket.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/petition_providers.dart';
import '../components/petition_widgets.dart';
import '../petition_paths.dart';

/// 「建议与诉求」主页：本机提交列表。
///
/// 三条约束直接体现在页面上：
///   1. 固定提示「演示版：提交只保存在本机，不会发送给学校」；
///   2. 列表按时间倒序，状态徽章与时间同时可见；
///   3. 空态解释用途与隐私边界，而不是一句「暂无数据」。
class PetitionPage extends ConsumerWidget {
  const PetitionPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final List<PetitionTicket> tickets = ref.watch(petitionTicketsProvider);

    return KedaYaPageScaffold(
      title: '建议与诉求',
      padding: EdgeInsets.zero,
      child: Column(
        children: <Widget>[
          const Padding(
            padding: EdgeInsets.fromLTRB(
              KedaYaTokens.space4,
              KedaYaTokens.space3,
              KedaYaTokens.space4,
              0,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                PetitionDemoNotice(),
                SizedBox(height: KedaYaTokens.space3),
                _PetitionIntro(),
              ],
            ),
          ),
          Expanded(
            child: tickets.isEmpty
                ? const KedaYaEmptyState(
                    icon: Icons.campaign_outlined,
                    title: '还没有提交过建议',
                    description: '这里用来记录你对教学、后勤、宿舍、餐饮和校园设施的'
                        '建议或诉求，方便自己回看进度。'
                        '演示版只保存在本机：不上传、不发送给任何部门，'
                        '也不会出现在公开列表里。',
                  )
                : ListView.separated(
                    padding: const EdgeInsets.all(KedaYaTokens.space4),
                    itemCount: tickets.length,
                    separatorBuilder: (BuildContext context, int index) =>
                        const SizedBox(height: KedaYaTokens.space3),
                    itemBuilder: (BuildContext context, int index) {
                      final PetitionTicket ticket = tickets[index];
                      return PetitionTicketCard(
                        ticket: ticket,
                        onTap: () => context.push(
                          PetitionRoutes.detail(ticket.id),
                        ),
                      );
                    },
                  ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              KedaYaTokens.space4,
              KedaYaTokens.space1,
              KedaYaTokens.space4,
              KedaYaTokens.space4,
            ),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                key: const Key('petition-new-button'),
                onPressed: () => context.push(PetitionRoutes.compose),
                icon: const Icon(Icons.edit_outlined, size: 18),
                label: const Text('写一条建议'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 页首说明：用途与边界（空态时也可见）。
class _PetitionIntro extends StatelessWidget {
  const _PetitionIntro();

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
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                Icons.edit_note,
                size: 18,
                color: colors.brandStrong,
              ),
              const SizedBox(width: KedaYaTokens.space2),
              Text(
                '先留一份自己的记录',
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
            '教学、后勤、宿舍、餐饮、校园设施的建议都可以写在这里，'
            '提交后按时间倒序保存在本机。'
            '匿名提交不会保存联系方式；记录不会上传，也不会同步到其他设备。',
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
