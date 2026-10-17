import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../application/session_controller.dart';
import '../../../../domain/models/auth_session.dart';
import '../../../../domain/models/techpie_link.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/techpie_providers.dart';
import '../components/techpie_cards.dart';

/// `techpie` 模块的入口页（路由 `/techpie`）。
///
/// 它是"两级身份"最直观的落点：上半部分显示**一级身份**（登录与否 / 显示名），
/// 下半部分显示**二级绑定**概况与四个入口 —— 两者来自**两个独立的 provider**，
/// 页面上没有任何一个对象同时持有它们（契约 §5）。
class TechpieHomePage extends ConsumerWidget {
  const TechpieHomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;

    // 第一级身份（登录与否 / 显示名）—— 只来自 sessionControllerProvider。
    final AuthSession? session =
        ref.watch(sessionControllerProvider).valueOrNull;

    // 第二级绑定（元数据）—— 只来自 TechpiePort。
    final List<TechpieLink> links =
        ref.watch(techpieLinksControllerProvider).valueOrNull ??
            const <TechpieLink>[];

    return KedaYaPageScaffold(
      title: '校园整合',
      child: ListView(
        children: <Widget>[
          TwoTierIdentityNotice(
            signedIn: session != null,
            identityLabel: session?.user.displayName,
            bindingSummary: _bindingSummary(links),
          ),
          const SizedBox(height: KedaYaTokens.space4),
          const CredentialFreeNotice(),
          const SizedBox(height: KedaYaTokens.space4),
          Text(
            '入口',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeMd,
              fontWeight: KedaYaTokens.fontWeightSemibold,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          const _EntryCard(
            icon: Icons.link,
            title: '绑定管理',
            description: '查看绑定 / 发起绑定 / 解绑 / 手动续期（响应不含凭证）。',
            route: '/techpie/bindings',
          ),
          const _EntryCard(
            icon: Icons.checklist_outlined,
            title: '能力清单',
            description: '校园能力按 Phase 分组：可用 / 需绑定 / 需登录 / 未实现，'
                '每一行都写清"出路"与"为什么没做"。',
            route: '/techpie/capabilities',
          ),
          const _EntryCard(
            icon: Icons.public,
            title: '校园系统直连',
            description: 'E云课堂 / 学生请假 / 学生活动 / 课程录播：'
                '换一次性票据后打开，用户在校园系统页面自己登录。',
            route: '/techpie/webview',
          ),
          const _EntryCard(
            icon: Icons.credit_card,
            title: '校园卡',
            description: '余额 / 流水 / 付款码 —— 走独立 OPENID 通道，'
                '与校园会话代持无关。',
            route: '/campus-card',
          ),
          const SizedBox(height: KedaYaTokens.space4),
          const _ScopeNotice(),
        ],
      ),
    );
  }
}

String _bindingSummary(List<TechpieLink> links) {
  if (links.isEmpty) return '暂无绑定';
  final DateTime now = DateTime.now();
  final int usable =
      links.where((TechpieLink link) => link.isUsableAt(now)).length;
  final int stale = links.length - usable;
  return stale == 0
      ? '${links.length} 项，全部可用'
      : '${links.length} 项，其中 $stale 项需重绑';
}

class _EntryCard extends StatelessWidget {
  const _EntryCard({
    required this.icon,
    required this.title,
    required this.description,
    required this.route,
  });

  final IconData icon;
  final String title;
  final String description;
  final String route;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Padding(
      padding: const EdgeInsets.only(bottom: KedaYaTokens.space2),
      child: Material(
        color: colors.surface,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        child: InkWell(
          borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
          onTap: () => context.push(route),
          child: Container(
            padding: const EdgeInsets.all(KedaYaTokens.space4),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
              border: Border.all(color: colors.border),
            ),
            child: Row(
              children: <Widget>[
                Icon(icon, size: 20, color: colors.brandStrong),
                const SizedBox(width: KedaYaTokens.space3),
                Expanded(
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
                      const SizedBox(height: 2),
                      Text(
                        description,
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeXs,
                          height: KedaYaTokens.lineHeightNormal,
                          color: colors.textMuted,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(Icons.chevron_right, size: 20, color: colors.textMuted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// 本轮范围与阻塞项（**如实说明**，不含任何"即将上线"的暗示）。
class _ScopeNotice extends StatelessWidget {
  const _ScopeNotice();

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
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
            '本轮范围（Phase 0）',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              fontWeight: KedaYaTokens.fontWeightSemibold,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '已实现：校园卡（独立 OPENID 通道）、校园系统 WebView 直连'
            '（用户自登录，不做会话注入）、绑定管理、能力清单。\n'
            '未实现：结构化校园数据（Phase 1，阻塞于信息办书面回复）、'
            '场馆预约与 WebView 会话注入（Phase 2）、自动续期（Phase 3，'
            '依赖 GeekPie / HeZeBang 确认）。\n'
            '明确不做：在信息办书面批准前，不实现任何校园会话落库路径 ——'
            '一旦落库，就有了一个未经授权的凭证副本，事后清理无法消除已发生的风险。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightLoose,
              color: colors.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}
