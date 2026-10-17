import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../application/module_catalog.dart';
import '../../domain/models/kedaya_module.dart';
import '../components/module_card.dart';
import '../theme/kedaya_tokens.dart';

/// 全部模块页：注册表驱动的 18 个一级入口（13 业务 + 5 基础）。
class ModulesPage extends ConsumerWidget {
  const ModulesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final List<KedayaModule> core = ref.watch(coreModulesProvider);
    final List<KedayaModule> business = ref.watch(businessModulesProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('全部模块')),
      body: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          const _GroupHeader(
            title: '基础模块',
            subtitle: '身份 / 课表 / 校园卡 / 我的 / 通知',
          ),
          for (final KedayaModule module in core) ...<Widget>[
            ModuleCard(
              module: module,
              onTap: () => context.push('/module/${module.id}'),
            ),
            const SizedBox(height: KedaYaTokens.space3),
          ],
          const SizedBox(height: KedaYaTokens.space3),
          const _GroupHeader(title: '业务模块', subtitle: '13 个一级入口；找搭子归入凑凑'),
          for (final KedayaModule module in business) ...<Widget>[
            ModuleCard(
              module: module,
              onTap: () => context.push('/module/${module.id}'),
            ),
            const SizedBox(height: KedaYaTokens.space3),
          ],
        ],
      ),
    );
  }
}

class _GroupHeader extends StatelessWidget {
  const _GroupHeader({required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: KedaYaTokens.space3),
      child: Column(
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
          const SizedBox(height: 2),
          Text(
            subtitle,
            style: const TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: KedaYaTokens.colorTextMuted,
            ),
          ),
        ],
      ),
    );
  }
}
