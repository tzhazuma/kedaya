import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../application/module_catalog.dart';
import '../../domain/models/kedaya_module.dart';
import '../components/module_card.dart';
import '../theme/kedaya_tokens.dart';

/// 全部模块页：注册表驱动的完整清单。
///
/// ⚠️ 这里**不写死数量** —— 数量随契约变化（2026-10-22 是 24 个：17 业务 + 7 基础），
/// 写死的注释一定会过期。需要数量请看 `kedayaModules.length`。
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
          // ⚠️ 原先这里把核心模块**逐个列举**（列举必过期：后来加了
          // campus-map 与 deadlines，列举就漏了）。改为读 core.length。
          _GroupHeader(
            title: '基础模块',
            subtitle: '共 ${core.length} 个',
          ),
          for (final KedayaModule module in core) ...<Widget>[
            ModuleCard(
              module: module,
              onTap: () => context.push('/module/${module.id}'),
            ),
            const SizedBox(height: KedaYaTokens.space3),
          ],
          const SizedBox(height: KedaYaTokens.space3),
          // ⚠️ 文案里的数量必须是**动态**的。原先这里写死了一个数字，
          // 契约增长后屏幕上就显示了错误的模块数（写死必过期）。
          _GroupHeader(
            title: '业务模块',
            subtitle: '共 ${business.length} 个',
          ),
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
