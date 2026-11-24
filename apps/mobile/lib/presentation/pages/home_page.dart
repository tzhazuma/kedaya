import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../application/session_controller.dart';
import '../../domain/models/auth_session.dart';
import '../../domain/models/kedaya_module.dart';
import '../components/unofficial_platform_notice.dart';
import '../theme/kedaya_theme_extension.dart';
import '../theme/kedaya_tokens.dart';

/// 首页：问候头 + 快捷服务 + 分组模块列表 + 非官方声明。
///
/// 视觉参照 TechPie 的 iOS 分组表面：每个分组是一张圆角卡，行间用 hairline
/// 分隔，右侧 chevron；色值全部来自 [KedaYaColors]，不写死亮色令牌。
class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AuthSession? session =
        ref.watch(sessionControllerProvider).valueOrNull;
    final KedaYaColors colors = context.kedayaColors;
    return Scaffold(
      appBar: AppBar(
        title: const Text('可达鸭'),
        actions: <Widget>[
          IconButton(
            tooltip: '全部模块',
            onPressed: () => context.go('/modules'),
            icon: const Icon(Icons.grid_view_outlined),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          KedaYaTokens.space4,
          KedaYaTokens.space2,
          KedaYaTokens.space4,
          KedaYaTokens.space8,
        ),
        children: <Widget>[
          _Greeting(session: session),
          const SizedBox(height: KedaYaTokens.space5),
          const _QuickActions(),
          const SizedBox(height: KedaYaTokens.space5),
          const _SectionTitle(title: '常用'),
          const SizedBox(height: KedaYaTokens.space2),
          _GroupedCard(
            children: <Widget>[
              _ModuleRow(
                icon: Icons.groups_2_outlined,
                title: '拼单',
                subtitle: '列表 + 详情 + 参团，三态齐全',
                onTap: () => context.push('/groupbuy'),
              ),
              _ModuleRow(
                icon: Icons.forum_outlined,
                title: '论坛',
                subtitle: '版块、主题、回复与匿名发帖',
                onTap: () => context.push('/forum'),
              ),
              _ModuleRow(
                icon: Icons.help_outline,
                title: '常见问题',
                subtitle: '分类、搜索与我的工单',
                onTap: () => context.push('/faq'),
              ),
              _ModuleRow(
                icon: Icons.local_cafe_outlined,
                title: '学术会议茶歇',
                subtitle: '按「值不值得现在跑一趟」排序',
                onTap: () => context.push('/teabreak'),
              ),
              _ModuleRow(
                icon: Icons.school_outlined,
                title: '校园服务',
                subtitle: 'E云课堂 · ELRC 录播 · 教务 · 请假',
                onTap: () => context.push('/campus-services'),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space5),
          const _SectionTitle(title: '业务模块'),
          const SizedBox(height: KedaYaTokens.space2),
          _GroupedCard(
            children: <Widget>[
              for (final KedayaModule module in businessModules)
                _ModuleRow(
                  title: module.nameZh,
                  subtitle: module.summary,
                  badge: module.sensitivity == ModuleSensitivity.critical
                      ? '最高敏感'
                      : module.requiresConsent
                          ? '需同意'
                          : null,
                  onTap: () => context.push('/module/${module.id}'),
                ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space3),
          Center(
            child: TextButton(
              onPressed: () => context.go('/modules'),
              style: TextButton.styleFrom(foregroundColor: colors.info),
              // 不写死数字：注册表加模块而这里忘了改，是最容易发生的"文案说谎"。
              child: Text('查看全部 ${kedayaModules.length} 个模块'),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space4),
          const UnofficialPlatformNotice(),
        ],
      ),
    );
  }
}

class _Greeting extends StatelessWidget {
  const _Greeting({required this.session});

  final AuthSession? session;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final String line = session == null
        ? '还没有登录 · 浏览类功能仍可用'
        : '你好，${session!.user.displayNameOrId}';
    return Row(
      children: <Widget>[
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: colors.brandSoft,
            borderRadius: BorderRadius.circular(12),
          ),
          alignment: Alignment.center,
          child: Text(
            '鸭',
            style: TextStyle(
              fontSize: 20,
              fontWeight: KedaYaTokens.fontWeightSemibold,
              color: colors.brandStrong,
            ),
          ),
        ),
        const SizedBox(width: KedaYaTokens.space3),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                '可达鸭 KedaYa',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: KedaYaTokens.fontWeightBold,
                  color: colors.text,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                line,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  color: colors.textMuted,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// 高频入口：横向滚动的图标磁贴（TechPie 的 quick actions 形态）。
class _QuickActions extends StatelessWidget {
  const _QuickActions();

  @override
  Widget build(BuildContext context) {
    const List<({IconData icon, String label, String route})> actions =
        <({IconData icon, String label, String route})>[
      (icon: Icons.calendar_today_outlined, label: '课表', route: '/schedule'),
      (icon: Icons.timer_outlined, label: 'DDL', route: '/deadlines'),
      (icon: Icons.sports_tennis_outlined, label: '场馆', route: '/facility'),
      (icon: Icons.restaurant_outlined, label: '营养', route: '/canteen'),
      (
        icon: Icons.credit_card_outlined,
        label: '校园卡',
        route: '/campus-card'
      ),
      (icon: Icons.event_outlined, label: '活动', route: '/activities'),
    ];
    return SizedBox(
      height: 92,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: actions.length,
        separatorBuilder: (_, __) => const SizedBox(width: KedaYaTokens.space3),
        itemBuilder: (BuildContext context, int index) {
          final ({IconData icon, String label, String route}) action =
              actions[index];
          return _QuickActionTile(
            icon: action.icon,
            label: action.label,
            onTap: () => context.push(action.route),
          );
        },
      ),
    );
  }
}

class _QuickActionTile extends StatelessWidget {
  const _QuickActionTile({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        width: 76,
        padding: const EdgeInsets.symmetric(vertical: KedaYaTokens.space3),
        decoration: BoxDecoration(
          color: colors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: colors.border),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: 22, color: colors.brandStrong),
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              label,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.text,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: KedaYaTokens.space1),
      child: Text(
        title,
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeSm,
          fontWeight: KedaYaTokens.fontWeightSemibold,
          color: context.kedayaColors.textMuted,
          letterSpacing: 0.2,
        ),
      ),
    );
  }
}

/// 分组卡：一张圆角卡装多行，行间 hairline 分隔（iOS grouped list）。
class _GroupedCard extends StatelessWidget {
  const _GroupedCard({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: colors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: <Widget>[
          for (int i = 0; i < children.length; i++) ...<Widget>[
            children[i],
            if (i != children.length - 1)
              Divider(height: 0.5, thickness: 0.5, color: colors.border),
          ],
        ],
      ),
    );
  }
}

class _ModuleRow extends StatelessWidget {
  const _ModuleRow({
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.icon,
    this.badge,
  });

  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final IconData? icon;
  final String? badge;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: KedaYaTokens.space4,
          vertical: KedaYaTokens.space3,
        ),
        child: Row(
          children: <Widget>[
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: colors.brandSoft,
                borderRadius: BorderRadius.circular(9),
              ),
              alignment: Alignment.center,
              child: icon != null
                  ? Icon(icon, size: 18, color: colors.brandStrong)
                  : Text(
                      title.isEmpty ? '?' : title.substring(0, 1),
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeSm,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: colors.brandStrong,
                      ),
                    ),
            ),
            const SizedBox(width: KedaYaTokens.space3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      Flexible(
                        child: Text(
                          title,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: KedaYaTokens.fontSizeMd,
                            color: colors.text,
                          ),
                        ),
                      ),
                      if (badge != null) ...<Widget>[
                        const SizedBox(width: KedaYaTokens.space2),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 1,
                          ),
                          decoration: BoxDecoration(
                            color: colors.danger.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            badge!,
                            style: TextStyle(
                              fontSize: 10,
                              color: colors.danger,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 1),
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: colors.textMuted,
                    ),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right, size: 18, color: colors.textMuted),
          ],
        ),
      ),
    );
  }
}
