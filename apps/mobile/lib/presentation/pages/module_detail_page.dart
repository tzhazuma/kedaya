import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../application/consent_controller.dart';
import '../../application/module_catalog.dart';
import '../../domain/models/kedaya_module.dart';
import '../components/kedaya_shell.dart';
import '../theme/kedaya_tokens.dart';

/// 模块落地页 —— **注册表驱动**，不含任何伪造的业务数据。
///
/// 已实现的模块（`groupbuy`）从这里给出真实入口；其余模块如实说明"尚未实现"，
/// 并展示它在契约里的冻结信息（路由前缀 / 敏感级 / 是否需要二次同意）。
/// 这样"未实现"是**可见的**，而不是假装成功。
class ModuleDetailPage extends ConsumerWidget {
  const ModuleDetailPage({required this.moduleId, super.key});

  final String moduleId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedayaModule? module = ref.watch(moduleByIdProvider(moduleId));
    if (module == null) {
      return KedaYaPageScaffold(
        title: '未知模块',
        child: Center(
          child: Text(
            '模块 "$moduleId" 不在冻结注册表里（契约 §4）。',
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              color: KedaYaTokens.colorTextMuted,
            ),
          ),
        ),
      );
    }

    final bool hasConsent =
        ref.watch(consentControllerProvider).valueOrNull?.contains(module.id) ?? false;

    return KedaYaPageScaffold(
      title: module.nameZh,
      child: ListView(
        children: <Widget>[
          _InfoRow(label: '英文标识', value: module.nameEn),
          _InfoRow(label: '模块 id', value: module.id),
          _InfoRow(label: 'API 路由前缀', value: '/api/v1/${module.route}'),
          _InfoRow(label: '分类', value: module.category.wire),
          _InfoRow(label: '敏感级', value: module.sensitivity.wire),
          _InfoRow(
            label: '二次同意',
            value: module.requiresConsent ? '需要' : '不需要',
          ),
          const SizedBox(height: KedaYaTokens.space4),
          Text(
            module.summary,
            style: const TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightLoose,
              color: KedaYaTokens.colorText,
            ),
          ),
          if (module.requiresConsent) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space5),
            const Text(
              '敏感模块 · 二次同意（契约 §9）',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeMd,
                fontWeight: KedaYaTokens.fontWeightSemibold,
                color: KedaYaTokens.colorText,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space2),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: hasConsent,
              title: const Text('我已阅读并同意该模块的隐私说明'),
              subtitle: const Text('可随时撤回；撤回后该模块立即不可用'),
              onChanged: (bool next) async {
                final ConsentController controller = ref.read(
                  consentControllerProvider.notifier,
                );
                try {
                  if (next) {
                    await controller.grant(module.id);
                  } else {
                    await controller.revoke(module.id);
                  }
                } on Object catch (error) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(
                      context,
                    ).showSnackBar(SnackBar(content: Text('$error')));
                  }
                }
              },
            ),
          ],
          const SizedBox(height: KedaYaTokens.space5),
          Container(
            padding: const EdgeInsets.all(KedaYaTokens.space4),
            decoration: BoxDecoration(
              color: KedaYaTokens.colorSurfaceAlt,
              borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text(
                  '实现状态',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: KedaYaTokens.colorText,
                  ),
                ),
                const SizedBox(height: KedaYaTokens.space2),
                Text(
                  module.id == 'groupbuy'
                      ? '本模块已实现：列表 + 详情 + 参团，走 domain/ports 的 GroupbuyPort。'
                      : '本模块尚未实现：只有冻结契约里的路由与权限信息，'
                            '没有页面、没有 mock 数据、没有假成功。',
                  style: const TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    height: KedaYaTokens.lineHeightNormal,
                    color: KedaYaTokens.colorTextMuted,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: KedaYaTokens.space1),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
            width: 96,
            child: Text(
              label,
              style: const TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: KedaYaTokens.colorTextMuted,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: KedaYaTokens.colorText,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
