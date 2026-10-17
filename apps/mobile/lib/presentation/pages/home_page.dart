import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../application/session_controller.dart';
import '../../domain/models/auth_session.dart';
import '../../domain/models/kedaya_module.dart';
import '../components/module_card.dart';
import '../components/unofficial_platform_notice.dart';
import '../theme/kedaya_theme_extension.dart';
import '../theme/kedaya_tokens.dart';

/// 首页：品牌头 + 非官方声明 + 已跑通的垂直切片入口 + 注册表驱动的模块宫格。
class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AuthSession? session = ref.watch(sessionControllerProvider).valueOrNull;
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
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          _Greeting(session: session),
          const SizedBox(height: KedaYaTokens.space4),
          const UnofficialPlatformNotice(),
          const SizedBox(height: KedaYaTokens.space6),
          const _SectionTitle(
            title: '已跑通的垂直切片',
            subtitle: 'presentation → application → domain ← data',
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _GroupbuyEntryCard(onTap: () => context.push('/groupbuy')),
          const SizedBox(height: KedaYaTokens.space6),
          const _SectionTitle(
            title: '业务模块',
            subtitle: '清单来自 packages/contracts/src/modules.ts，本端只镜像不新增',
          ),
          const SizedBox(height: KedaYaTokens.space3),
          for (final KedayaModule module in businessModules)
            Padding(
              padding: const EdgeInsets.only(bottom: KedaYaTokens.space3),
              child: ModuleCard(
                module: module,
                onTap: () => context.push('/module/${module.id}'),
              ),
            ),
          const SizedBox(height: KedaYaTokens.space2),
          Center(
            child: TextButton(
              onPressed: () => context.go('/modules'),
              child: const Text('查看全部 19 个模块'),
            ),
          ),
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
    final String line = session == null
        ? '还没有登录 · 上科大，什么需求都可以到达'
        : '你好，${session!.user.displayNameOrId} · 上科大，什么需求都可以到达';
    return Row(
      children: <Widget>[
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: KedaYaTokens.colorBrand,
            borderRadius: BorderRadius.circular(KedaYaTokens.radiusXl),
          ),
          alignment: Alignment.center,
          child: const Text('鸭', style: TextStyle(fontSize: 22)),
        ),
        const SizedBox(width: KedaYaTokens.space3),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const Text(
                '可达鸭 KedaYa',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXl,
                  fontWeight: KedaYaTokens.fontWeightBold,
                  color: KedaYaTokens.colorText,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                line,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  color: context.kedayaColors.textMuted,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, this.subtitle});

  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          title,
          style: const TextStyle(
            fontSize: KedaYaTokens.fontSizeLg,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: KedaYaTokens.colorText,
          ),
        ),
        if (subtitle != null) ...<Widget>[
          const SizedBox(height: 2),
          Text(
            subtitle!,
            style: const TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: KedaYaTokens.colorTextMuted,
            ),
          ),
        ],
      ],
    );
  }
}

class _GroupbuyEntryCard extends StatelessWidget {
  const _GroupbuyEntryCard({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        child: Padding(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          child: Row(
            children: <Widget>[
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: KedaYaTokens.colorBrandSoft,
                  borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
                ),
                alignment: Alignment.center,
                child: const Icon(
                  Icons.groups_2_outlined,
                  color: KedaYaTokens.colorInk,
                ),
              ),
              const SizedBox(width: KedaYaTokens.space3),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      '拼单',
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeMd,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: KedaYaTokens.colorText,
                      ),
                    ),
                    SizedBox(height: KedaYaTokens.space1),
                    Text(
                      '列表 + 详情 + 参团，三态齐全；默认走内存 mock，无需后端',
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeSm,
                        color: KedaYaTokens.colorTextMuted,
                        height: KedaYaTokens.lineHeightNormal,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(
                Icons.chevron_right,
                size: 20,
                color: KedaYaTokens.colorTextMuted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
