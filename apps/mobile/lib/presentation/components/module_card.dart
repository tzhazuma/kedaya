import 'package:flutter/material.dart';

import '../../domain/models/kedaya_module.dart';
import '../theme/kedaya_tokens.dart';

/// 模块卡片：**完全由注册表驱动**（契约 §4：禁止在各端硬编码模块清单）。
class ModuleCard extends StatelessWidget {
  const ModuleCard({required this.module, this.onTap, super.key});

  final KedayaModule module;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        child: Padding(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: KedaYaTokens.colorBrandSoft,
                  borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
                ),
                alignment: Alignment.center,
                child: Text(
                  module.nameZh.isEmpty ? '?' : module.nameZh.substring(0, 1),
                  style: const TextStyle(
                    fontSize: KedaYaTokens.fontSizeLg,
                    fontWeight: KedaYaTokens.fontWeightBold,
                    color: KedaYaTokens.colorInk,
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
                            module.nameZh,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: KedaYaTokens.fontSizeMd,
                              fontWeight: KedaYaTokens.fontWeightSemibold,
                              color: KedaYaTokens.colorText,
                            ),
                          ),
                        ),
                        if (module.requiresConsent) ...<Widget>[
                          const SizedBox(width: KedaYaTokens.space2),
                          const _Badge(label: '需同意', tone: _BadgeTone.warning),
                        ],
                        if (module.sensitivity.isSensitive) ...<Widget>[
                          const SizedBox(width: KedaYaTokens.space2),
                          _Badge(
                            label:
                                module.sensitivity == ModuleSensitivity.critical
                                    ? '最高敏感'
                                    : '高敏感',
                            tone: _BadgeTone.danger,
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: KedaYaTokens.space1),
                    Text(
                      module.summary,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: KedaYaTokens.fontSizeSm,
                        color: KedaYaTokens.colorTextMuted,
                        height: KedaYaTokens.lineHeightNormal,
                      ),
                    ),
                    const SizedBox(height: KedaYaTokens.space2),
                    Text(
                      '/api/v1/${module.route}',
                      style: const TextStyle(
                        fontSize: KedaYaTokens.fontSizeXs,
                        fontFamily: KedaYaTokens.fontFamilyMono,
                        color: KedaYaTokens.colorTextMuted,
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

enum _BadgeTone { warning, danger }

class _Badge extends StatelessWidget {
  const _Badge({required this.label, required this.tone});

  final String label;
  final _BadgeTone tone;

  @override
  Widget build(BuildContext context) {
    final Color background = switch (tone) {
      _BadgeTone.warning => KedaYaTokens.colorBrandSoft,
      // 从令牌色派生透明度，而不是手写一个十六进制色值（契约 §6.2）。
      _BadgeTone.danger => KedaYaTokens.colorDanger.withValues(alpha: 0.1),
    };
    final Color foreground = switch (tone) {
      _BadgeTone.warning => KedaYaTokens.colorBrandStrong,
      _BadgeTone.danger => KedaYaTokens.colorDanger,
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space2,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusSm),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeXs,
          fontWeight: KedaYaTokens.fontWeightMedium,
          color: foreground,
        ),
      ),
    );
  }
}
