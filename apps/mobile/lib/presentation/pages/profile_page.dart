import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_providers.dart';
import '../../app/app_version.dart';
import '../../application/campus_bindings_controller.dart';
import '../../application/consent_controller.dart';
import '../../application/module_catalog.dart';
import '../../application/session_controller.dart';
import '../../application/theme_controller.dart';
import '../../domain/models/auth_session.dart';
import '../../domain/models/campus_binding.dart';
import '../../domain/models/theme_mode.dart';
import '../../platform/platform_info.dart';
import '../components/kedaya_shell.dart';
import '../components/unofficial_platform_notice.dart';
import '../theme/kedaya_theme_extension.dart';
import '../theme/kedaya_tokens.dart';

/// 「我的」：账号、校园绑定、偏好设置与关于。
///
/// 页面面向使用者而不是开发者：不出现契约条款号、适配器名这类实现细节，
/// 需要排障的信息收在「关于 → 运行环境」里。两级身份模型仍然成立 ——
/// 账号登录与校园系统绑定是两组独立的入口，互不越界。
class ProfilePage extends ConsumerWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<AuthSession?> session =
        ref.watch(sessionControllerProvider);
    final AsyncValue<List<CampusBinding>> bindings = ref.watch(
      campusBindingsControllerProvider,
    );
    final Set<String> granted =
        ref.watch(consentControllerProvider).valueOrNull ?? const <String>{};
    final KedaYaThemeMode themeMode = ref.watch(themeModeControllerProvider);
    final bool usesMock = ref.watch(appEnvironmentProvider).usesMockAdapters;

    return KedaYaPageScaffold(
      title: '我的',
      child: ListView(
        children: <Widget>[
          _AccountCard(session: session),
          const SizedBox(height: KedaYaTokens.space5),
          const _SectionTitle('校园账号'),
          const SizedBox(height: KedaYaTokens.space2),
          _Group(
            children: <Widget>[
              for (final CampusSystem system in CampusSystem.values)
                _BindingRow(
                  system: system,
                  binding: _bindingFor(bindings.valueOrNull, system),
                  onTap: () => context.push('/techpie/bindings'),
                ),
              const Divider(height: 0.5, thickness: 0.5),
              _NavRow(
                icon: Icons.tune_outlined,
                title: '绑定管理',
                subtitle: '发起绑定、解绑与手动续期',
                onTap: () => context.push('/techpie/bindings'),
              ),
              const Divider(height: 0.5, thickness: 0.5),
              _NavRow(
                icon: Icons.checklist_outlined,
                title: '能力清单',
                subtitle: '哪些功能可用、哪些需要先绑定',
                onTap: () => context.push('/techpie/capabilities'),
              ),
              const Divider(height: 0.5, thickness: 0.5),
              _NavRow(
                icon: Icons.school_outlined,
                title: '校园服务',
                subtitle: 'E云课堂、课程录播、教务与请假',
                onTap: () => context.push('/campus-services'),
              ),
              const Divider(height: 0.5, thickness: 0.5),
              _NavRow(
                icon: Icons.credit_card_outlined,
                title: '校园卡',
                subtitle: '余额、流水与付款码',
                onTap: () => context.push('/campus-card'),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space5),
          const _SectionTitle('偏好'),
          const SizedBox(height: KedaYaTokens.space2),
          _Group(
            children: <Widget>[
              Padding(
                padding: const EdgeInsets.all(KedaYaTokens.space4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const Text('外观'),
                    const SizedBox(height: KedaYaTokens.space2),
                    SegmentedButton<KedaYaThemeMode>(
                      showSelectedIcon: false,
                      segments: <ButtonSegment<KedaYaThemeMode>>[
                        for (final KedaYaThemeMode mode
                            in KedaYaThemeMode.values)
                          ButtonSegment<KedaYaThemeMode>(
                              value: mode, label: Text(mode.label)),
                      ],
                      selected: <KedaYaThemeMode>{themeMode},
                      onSelectionChanged:
                          (Set<KedaYaThemeMode> selection) async {
                        await ref
                            .read(themeModeControllerProvider.notifier)
                            .setMode(selection.first);
                      },
                    ),
                  ],
                ),
              ),
              const Divider(height: 0.5, thickness: 0.5),
              _NavRow(
                icon: Icons.notifications_outlined,
                title: '通知与提醒',
                subtitle: '站内信与设备推送开关',
                onTap: () => context.push('/notifications'),
              ),
              const Divider(height: 0.5, thickness: 0.5),
              _NavRow(
                icon: Icons.privacy_tip_outlined,
                title: '敏感模块授权',
                subtitle: granted.isEmpty
                    ? '尚未授权任何敏感模块'
                    : granted
                        .map((String id) =>
                            ref.read(moduleByIdProvider(id))?.nameZh ?? id)
                        .join('、'),
                onTap: () => _showConsents(context, granted, ref),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space5),
          const _SectionTitle('关于'),
          const SizedBox(height: KedaYaTokens.space2),
          _Group(
            children: <Widget>[
              const _NavRow(
                icon: Icons.info_outline,
                title: '版本',
                subtitle: '可达鸭 $kKedayaVersion',
              ),
              const Divider(height: 0.5, thickness: 0.5),
              ExpansionTile(
                leading: const Icon(Icons.settings_ethernet_outlined, size: 20),
                title: const Text('运行环境'),
                subtitle: Text(
                  PlatformInfo.current.label,
                  style: const TextStyle(fontSize: KedaYaTokens.fontSizeXs),
                ),
                children: <Widget>[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      KedaYaTokens.space4,
                      0,
                      KedaYaTokens.space4,
                      KedaYaTokens.space3,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        _KeyValueRow(
                            label: '平台', value: PlatformInfo.current.label),
                        _KeyValueRow(
                          label: '数据来源',
                          value: usesMock ? '本机演示（未连接后端）' : '远端服务',
                        ),
                        const _KeyValueRow(
                            label: '客户端', value: 'Flutter · kedaya'),
                        _KeyValueRow(label: '版本号', value: kKedayaVersion),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space4),
          if (session.valueOrNull != null)
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () async {
                  await ref.read(sessionControllerProvider.notifier).signOut();
                },
                icon: const Icon(Icons.logout, size: 18),
                label: const Text('退出登录'),
              ),
            ),
          const SizedBox(height: KedaYaTokens.space4),
          const UnofficialPlatformNotice(dense: true),
        ],
      ),
    );
  }

  void _showConsents(BuildContext context, Set<String> granted, WidgetRef ref) {
    showModalBottomSheet<void>(
      context: context,
      builder: (BuildContext context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          children: <Widget>[
            const Text(
              '敏感模块授权',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeMd,
                fontWeight: KedaYaTokens.fontWeightSemibold,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space2),
            const Text(
              '这些模块涉及更敏感的信息，需要你单独同意。'
              '随时可以在模块页面里撤回，撤回后该模块立即不可用。',
              style: TextStyle(fontSize: KedaYaTokens.fontSizeXs),
            ),
            const SizedBox(height: KedaYaTokens.space3),
            if (granted.isEmpty)
              const Text('尚未授权任何敏感模块。')
            else
              for (final String id in granted)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(ref.read(moduleByIdProvider(id))?.nameZh ?? id),
                  trailing: TextButton(
                    onPressed: () async {
                      await ref
                          .read(consentControllerProvider.notifier)
                          .revoke(id);
                      if (context.mounted) Navigator.of(context).pop();
                    },
                    child: const Text('撤回'),
                  ),
                ),
          ],
        ),
      ),
    );
  }
}

/// 在绑定列表里找某个校园系统；未绑定返回 null。
CampusBinding? _bindingFor(List<CampusBinding>? bindings, CampusSystem system) {
  if (bindings == null) return null;
  for (final CampusBinding item in bindings) {
    if (item.system == system) return item;
  }
  return null;
}

/// 顶部账户卡：登录态一目了然，未登录时主操作就是登录。
class _AccountCard extends ConsumerWidget {
  const _AccountCard({required this.session});

  final AsyncValue<AuthSession?> session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final AuthSession? current = session.valueOrNull;
    final String title = current?.user.displayNameOrId ?? '还未登录';
    final String subtitle = session.isLoading
        ? '正在读取登录状态…'
        : session.hasError
            ? '登录状态读取失败：${session.error}'
            : current == null
                ? '浏览类功能可以直接用，登录后解锁个人数据'
                : <String?>[
                    current.user.studentId,
                    current.user.department,
                  ].whereType<String>().where((String s) => s.isNotEmpty).join(' · ');

    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        children: <Widget>[
          Row(
            children: <Widget>[
              CircleAvatar(
                radius: 26,
                backgroundColor: colors.brandSoft,
                child: Text(
                  current == null
                      ? '鸭'
                      : title.substring(0, 1),
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
                      title,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeLg,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: colors.text,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle.isEmpty ? '已登录' : subtitle,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeXs,
                        height: KedaYaTokens.lineHeightNormal,
                        color: colors.textMuted,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space3),
          SizedBox(
            width: double.infinity,
            child: current == null
                ? FilledButton.icon(
                    onPressed: () => context.push('/campus-login'),
                    icon: const Icon(Icons.login, size: 18),
                    label: const Text('用学校统一身份登录'),
                  )
                : OutlinedButton.icon(
                    onPressed: () => context.push('/campus-login'),
                    icon: const Icon(Icons.swap_horiz, size: 18),
                    label: const Text('重新登录 / 切换账号'),
                  ),
          ),
        ],
      ),
    );
  }
}

class _BindingRow extends StatelessWidget {
  const _BindingRow({required this.system, this.binding, this.onTap});

  final CampusSystem system;
  final CampusBinding? binding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final CampusBinding? current = binding;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: KedaYaTokens.space4,
          vertical: KedaYaTokens.space3,
        ),
        child: Row(
          children: <Widget>[
            Icon(
              current == null ? Icons.link_off : Icons.link,
              size: 20,
              color: current == null ? colors.textMuted : colors.success,
            ),
            const SizedBox(width: KedaYaTokens.space3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(system.label),
                  Text(
                    current == null
                        ? '未绑定'
                        : '已绑定 ${current.displayName ?? ''}'.trim(),
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

class _Group extends StatelessWidget {
  const _Group({required this.children});

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
      child: Column(children: children),
    );
  }
}

class _NavRow extends StatelessWidget {
  const _NavRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

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
            Icon(icon, size: 20, color: colors.brandStrong),
            const SizedBox(width: KedaYaTokens.space3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(title),
                  const SizedBox(height: 1),
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      height: KedaYaTokens.lineHeightNormal,
                      color: colors.textMuted,
                    ),
                  ),
                ],
              ),
            ),
            if (onTap != null)
              Icon(Icons.chevron_right, size: 18, color: colors.textMuted),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);

  final String title;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(left: KedaYaTokens.space1),
        child: Text(
          title,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: context.kedayaColors.textMuted,
          ),
        ),
      );
}

class _KeyValueRow extends StatelessWidget {
  const _KeyValueRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            SizedBox(
              width: 72,
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
