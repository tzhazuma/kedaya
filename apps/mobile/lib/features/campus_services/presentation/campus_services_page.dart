import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/app_providers.dart';
import '../../../domain/ports/webview_port.dart';
import '../../../presentation/components/kedaya_shell.dart';
import '../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../presentation/theme/kedaya_tokens.dart';
import '../domain/campus_service.dart';

/// 校园服务直达：打开学校公开入口，不代持任何会话。
class CampusServicesPage extends ConsumerWidget {
  const CampusServicesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final Map<CampusServiceGroup, List<CampusService>> groups =
        groupCampusServices(campusServices);

    return KedaYaPageScaffold(
      title: '校园服务',
      child: ListView(
        children: <Widget>[
          Text(
            '登录在学校页面内完成，本机不保存校园会话。'
            '桌面端若没有内嵌浏览器，会退化为复制链接。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
              height: KedaYaTokens.lineHeightNormal,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space4),
          for (final MapEntry<CampusServiceGroup, List<CampusService>> entry
              in groups.entries) ...<Widget>[
            Padding(
              padding: const EdgeInsets.only(
                left: KedaYaTokens.space1,
                bottom: KedaYaTokens.space2,
              ),
              child: Text(
                entry.key.label,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  color: colors.textMuted,
                ),
              ),
            ),
            Container(
              decoration: BoxDecoration(
                color: colors.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: colors.border),
              ),
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: <Widget>[
                  for (int i = 0; i < entry.value.length; i++) ...<Widget>[
                    _ServiceRow(
                      service: entry.value[i],
                      onOpen: () => _open(context, ref, entry.value[i]),
                      onCopy: () => _copy(context, ref, entry.value[i]),
                    ),
                    if (i != entry.value.length - 1)
                      Divider(
                        height: 0.5,
                        thickness: 0.5,
                        color: colors.border,
                      ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: KedaYaTokens.space4),
          ],
        ],
      ),
    );
  }

  Future<void> _open(
    BuildContext context,
    WidgetRef ref,
    CampusService service,
  ) async {
    final WebViewPort port = ref.read(webViewProvider);
    final bool opened = await port.openOneTimeUrl(service.url);
    if (!context.mounted) return;
    if (!opened) {
      await ref.read(shareProvider).copyToClipboard(service.url);
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(campusServiceFallbackMessage(service))),
      );
    }
  }

  Future<void> _copy(
    BuildContext context,
    WidgetRef ref,
    CampusService service,
  ) async {
    await ref.read(shareProvider).copyToClipboard(service.url);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('已复制「${service.name}」链接')),
    );
  }
}

class _ServiceRow extends StatelessWidget {
  const _ServiceRow({
    required this.service,
    required this.onOpen,
    required this.onCopy,
  });

  final CampusService service;
  final VoidCallback onOpen;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return InkWell(
      onTap: onOpen,
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
              child: Text(
                service.name.substring(0, 1),
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
                  Text(
                    service.name,
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeMd,
                      color: colors.text,
                    ),
                  ),
                  const SizedBox(height: 1),
                  Text(
                    service.description,
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
            IconButton(
              tooltip: '复制链接',
              onPressed: onCopy,
              icon: Icon(Icons.link, size: 18, color: colors.textMuted),
            ),
            Icon(Icons.chevron_right, size: 18, color: colors.textMuted),
          ],
        ),
      ),
    );
  }
}

/// 建议路由。
const String campusServicesRoutePath = '/campus-services';

/// 供 `app_router.dart` 使用的路由。
List<RouteBase> campusServicesRoutes() => <RouteBase>[
      GoRoute(
        path: campusServicesRoutePath,
        name: 'campus-services',
        builder: (BuildContext context, GoRouterState state) =>
            const CampusServicesPage(),
      ),
    ];
