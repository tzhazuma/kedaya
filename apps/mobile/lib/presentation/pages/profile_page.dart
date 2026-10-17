import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/app_providers.dart';
import '../../application/campus_bindings_controller.dart';
import '../../application/consent_controller.dart';
import '../../application/session_controller.dart';
import '../../application/theme_controller.dart';
import '../../domain/models/auth_session.dart';
import '../../domain/models/campus_binding.dart';
import '../../domain/models/theme_mode.dart';
import '../../platform/platform_info.dart';
import '../components/kedaya_shell.dart';
import '../components/unofficial_platform_notice.dart';
import '../theme/kedaya_tokens.dart';

/// "我的"页：会话、校园系统绑定、同意记录、外观、运行环境。
///
/// 这一页把契约 §5 的**两级身份模型**直接呈现出来：
/// 上面是身份层（KedaYa 会话），下面是能力层（校园系统绑定）——两者互不越界。
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
          const UnofficialPlatformNotice(dense: true),
          const SizedBox(height: KedaYaTokens.space5),
          const _SectionTitle('第一级 · 身份（KedaYa 会话）'),
          const SizedBox(height: KedaYaTokens.space2),
          if (session.isLoading)
            const LinearProgressIndicator()
          else if (session.hasError)
            Text(
              '登录失败：${session.error}',
              style: const TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: KedaYaTokens.colorDanger,
              ),
            )
          else
            _SessionTile(session: session.valueOrNull),
          const SizedBox(height: KedaYaTokens.space3),
          Row(
            children: <Widget>[
              FilledButton(
                onPressed: () async {
                  await ref.read(sessionControllerProvider.notifier).signIn();
                },
                child: const Text('统一身份登录'),
              ),
              const SizedBox(width: KedaYaTokens.space3),
              OutlinedButton(
                onPressed: () async {
                  await ref.read(sessionControllerProvider.notifier).signOut();
                },
                child: const Text('退出登录'),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space6),
          const _SectionTitle('第二级 · 校园系统绑定（能力层）'),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '凭据只保存在系统安全存储里，界面拿到的永远只是绑定状态（契约 §5）。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: Theme.of(context).colorScheme.outline,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          for (final CampusSystem system in CampusSystem.values)
            _BindingTile(
                system: system,
                binding: _bindingFor(bindings.valueOrNull, system)),
          const SizedBox(height: KedaYaTokens.space6),
          const _SectionTitle('二次同意记录（契约 §9）'),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            granted.isEmpty ? '尚未对任何敏感模块表示同意' : granted.join('、'),
            style: const TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              color: KedaYaTokens.colorText,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space6),
          const _SectionTitle('外观（契约 §11.5）'),
          const SizedBox(height: KedaYaTokens.space2),
          SegmentedButton<KedaYaThemeMode>(
            showSelectedIcon: false,
            segments: <ButtonSegment<KedaYaThemeMode>>[
              for (final KedaYaThemeMode mode in KedaYaThemeMode.values)
                ButtonSegment<KedaYaThemeMode>(
                    value: mode, label: Text(mode.label)),
            ],
            selected: <KedaYaThemeMode>{themeMode},
            onSelectionChanged: (Set<KedaYaThemeMode> selection) async {
              await ref
                  .read(themeModeControllerProvider.notifier)
                  .setMode(selection.first);
            },
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '选择会被记住（本地缓存，启动时同步读回，不会闪一下再切）。',
            style: const TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: KedaYaTokens.colorTextMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space6),
          const _SectionTitle('运行环境'),
          const SizedBox(height: KedaYaTokens.space2),
          _KeyValueRow(label: '平台', value: PlatformInfo.current.label),
          _KeyValueRow(
              label: '适配器', value: usesMock ? '内存 mock（无后端）' : '远端 API'),
          const _KeyValueRow(label: '客户端', value: 'Flutter · kedaya 0.1.0'),
        ],
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

class _SessionTile extends StatelessWidget {
  const _SessionTile({required this.session});

  final AuthSession? session;

  @override
  Widget build(BuildContext context) {
    final AuthSession? current = session;
    if (current == null) {
      return const Text(
        '未登录 · 浏览类功能仍可用（契约 §5 硬规则 3：可以"已登录但未绑定"）',
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeSm,
          color: KedaYaTokens.colorTextMuted,
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        _KeyValueRow(label: '用户', value: current.user.displayNameOrId),
        _KeyValueRow(label: '学号', value: current.user.studentId ?? '—'),
        _KeyValueRow(label: '院系', value: current.user.department ?? '—'),
        _KeyValueRow(
          label: '令牌',
          value: current.hasTokens ? '已持有' : '待后台恢复（契约 §8）',
        ),
      ],
    );
  }
}

class _BindingTile extends StatelessWidget {
  const _BindingTile({required this.system, this.binding});

  final CampusSystem system;
  final CampusBinding? binding;

  @override
  Widget build(BuildContext context) {
    final CampusBinding? current = binding;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(
        current == null ? Icons.link_off : Icons.link,
        color: current == null
            ? KedaYaTokens.colorTextMuted
            : KedaYaTokens.colorSuccess,
      ),
      title: Text(system.label),
      subtitle: Text(
        current == null
            ? '未绑定 · 依赖它的功能会返回 CAMPUS_BINDING_REQUIRED'
            : '已绑定 ${current.displayName ?? '（无显示名）'}',
        style: const TextStyle(fontSize: KedaYaTokens.fontSizeXs),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);

  final String title;

  @override
  Widget build(BuildContext context) => Text(
        title,
        style: const TextStyle(
          fontSize: KedaYaTokens.fontSizeMd,
          fontWeight: KedaYaTokens.fontWeightSemibold,
          color: KedaYaTokens.colorText,
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
