import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/app_providers.dart';
import '../../../../application/session_controller.dart';
import '../../../../data/mock/mock_controls.dart';
import '../../../../domain/models/campus_card.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/mock_state_menu.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/techpie_providers.dart';
import '../components/techpie_cards.dart';

/// 校园卡页（路由 `/campus-card`）。
///
/// ⚠️ 校园卡走**独立 OPENID 通道**（规格 §2.5）：它不依赖校园会话代持，
/// 因此这一页**完全不需要** `CampusSessionPort` / `TechpiePort`，
/// 只用 `CampusCardPort`。这也是它可以整体平移到 `features/campus_card/`
/// 的原因（见 README 的"偏离"一节）。
///
/// 状态分层（与契约 §5 一致）：
///   - 未登录 → 引导登录（一级身份，走 `sessionControllerProvider`）；
///   - 已登录未开通 → 引导开通（OPENID 通道，**不是**错误）；
///   - 已开通 → 余额 / 流水 / 付款码。
class CampusCardPage extends ConsumerWidget {
  const CampusCardPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bool signedIn =
        ref.watch(sessionControllerProvider).valueOrNull != null;
    final AsyncValue<CampusCardSnapshot> value = ref.watch(
      campusCardControllerProvider,
    );
    final MockControls? mockControls = ref.watch(mockControlsProvider);

    return KedaYaPageScaffold(
      title: '校园卡',
      padding: EdgeInsets.zero,
      actions: <Widget>[
        if (mockControls != null)
          MockStateMenu(
            controls: mockControls,
            onChanged: () => ref.invalidate(campusCardControllerProvider),
          ),
        IconButton(
          tooltip: '刷新',
          onPressed: () => unawaited(
            ref.read(campusCardControllerProvider.notifier).refresh(),
          ),
          icon: const Icon(Icons.refresh),
        ),
      ],
      child: signedIn
          ? AsyncStateView<CampusCardSnapshot>(
              value: value,
              loadingMessage: '正在读取校园卡…',
              onRetry: () => unawaited(
                ref.read(campusCardControllerProvider.notifier).refresh(),
              ),
              builder: (BuildContext context, CampusCardSnapshot snapshot) =>
                  snapshot.isLinked
                      ? _LinkedBody(snapshot: snapshot)
                      : _OpenBody(snapshot: snapshot),
            )
          : const _SignInBody(),
    );
  }
}

/// 未登录：引导登录（**不是**"请先绑定校园系统"）。
class _SignInBody extends ConsumerWidget {
  const _SignInBody();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(KedaYaTokens.space6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.login, size: 40, color: colors.info),
            const SizedBox(height: KedaYaTokens.space3),
            Text(
              '还没有登录',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeMd,
                fontWeight: KedaYaTokens.fontWeightSemibold,
                color: colors.text,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              '这是第一级身份的问题（UNAUTHENTICATED）：先完成上科大统一身份认证，'
              '再回来开通校园卡。校园卡与校园会话代持无关，开通后也不会产生任何校园会话凭据。',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.textMuted,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space4),
            FilledButton(
              onPressed: () async {
                await ref.read(sessionControllerProvider.notifier).signIn();
              },
              child: const Text('去登录'),
            ),
          ],
        ),
      ),
    );
  }
}

/// 已登录但未开通：引导走 OPENID 通道（**不是**错误页）。
class _OpenBody extends ConsumerWidget {
  const _OpenBody({required this.snapshot});

  final CampusCardSnapshot snapshot;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final bool isMock = ref.watch(mockControlsProvider) != null;
    final bool needsRebind = snapshot.link.state.needsRebind;
    return ListView(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      children: <Widget>[
        Container(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          decoration: BoxDecoration(
            color: colors.surface,
            borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
            border: Border.all(color: colors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                needsRebind ? '校园卡授权已过期' : '校园卡尚未开通',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeMd,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  color: colors.text,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                '校园卡走 eCard 自己的 OPENID 通道（规格 §2.5）：'
                '它不需要我们代持任何校园会话，因此开通校园卡不会产生任何校园会话凭据，'
                '也不需要信息办对 U7 的批准。\n'
                '接口在未开通时返回 CAMPUS_BINDING_REQUIRED（409）而不是 '
                'UNAUTHENTICATED（401）—— 因为用户其实已经登录了。',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  height: KedaYaTokens.lineHeightLoose,
                  color: colors.textMuted,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space4),
              if (isMock)
                FilledButton.icon(
                  onPressed: () async {
                    await ref
                        .read(campusCardControllerProvider.notifier)
                        .connect(openId: 'mock-openid-20240001');
                  },
                  icon: const Icon(Icons.qr_code, size: 18),
                  label: const Text('（mock）模拟 eCard 授权回调并开通'),
                )
              else
                Text(
                  '开通需要一个真实的 OPENID，它必须来自 eCard 官方授权流程。'
                  '原生侧授权流程尚未实现，因此真实运行时这里没有可用按钮 ——'
                  '本端不伪造 OPENID。',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.warning,
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: KedaYaTokens.space3),
        const CredentialFreeNotice(
          extra: 'OPENID 只在开通请求里出现一次，之后由服务端保管；'
              '客户端只保留一个脱敏尾巴（例如 ****a1b2）。',
        ),
      ],
    );
  }
}

/// 已开通：余额 + 付款码 + 流水。
class _LinkedBody extends ConsumerWidget {
  const _LinkedBody({required this.snapshot});

  final CampusCardSnapshot snapshot;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final AsyncValue<CampusPaymentCode> code = ref.watch(
      campusPaymentCodeProvider,
    );
    return ListView(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      children: <Widget>[
        if (snapshot.account != null)
          CampusCardBalanceCard(account: snapshot.account!),
        const SizedBox(height: KedaYaTokens.space3),
        Text(
          '付款码',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeMd,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space2),
        // 付款码状态用 `autoDispose` provider：离开本页即丢弃，因此不会被缓存。
        // AsyncStateView 的三态在 ListView 的无界主轴下会**收缩包裹**（Align 在
        // 无界方向 shrink-wrap），因此这里不需要额外的定高盒子。
        AsyncStateView<CampusPaymentCode>(
          value: code,
          loadingMessage: '正在取付款码…',
          onRetry: () => ref.invalidate(campusPaymentCodeProvider),
          builder: (BuildContext context, CampusPaymentCode paymentCode) =>
              CampusPaymentCodeCard(
            code: paymentCode,
            onRefresh: () => ref.invalidate(campusPaymentCodeProvider),
          ),
        ),
        const SizedBox(height: KedaYaTokens.space3),
        Text(
          '流水',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeMd,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space2),
        if (snapshot.hasNoTransactions)
          const KedaYaEmptyState(
            title: '还没有流水',
            description: '这张卡目前没有消费或充值记录。空态不是错误。',
            icon: Icons.receipt_long_outlined,
          )
        else
          for (final CampusCardTransaction item in snapshot.transactions)
            Padding(
              padding: const EdgeInsets.only(bottom: KedaYaTokens.space2),
              child: CampusCardTransactionTile(transaction: item),
            ),
        const SizedBox(height: KedaYaTokens.space3),
        const CredentialFreeNotice(),
        const SizedBox(height: KedaYaTokens.space3),
        OutlinedButton(
          onPressed: () async {
            await ref.read(campusCardControllerProvider.notifier).disconnect();
          },
          child: const Text('解除开通（幂等）'),
        ),
      ],
    );
  }
}
