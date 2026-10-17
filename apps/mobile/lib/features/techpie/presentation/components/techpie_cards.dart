import 'package:flutter/material.dart';

import '../../../../domain/models/campus_capability.dart';
import '../../../../domain/models/campus_card.dart';
import '../../../../domain/models/techpie_link.dart';
import '../../../../presentation/components/money_text.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// `techpie` / `campus-card` 的展示组件。
///
/// 所有颜色都来自 [KedaYaColors]（生成的设计令牌），因此**亮暗两套自动可用**，
/// 组件里不存在任何硬编码色值（`tool/selfcheck.py` 的 hardcoded-color 检查兜底）。

// ------------------------------------------------------------------ 语义色

/// 绑定状态 → 设计令牌。**唯一**的颜色映射点。
Color campusBindingTone(CampusBindingStatus status, KedaYaColors colors) =>
    switch (status) {
      CampusBindingStatus.linked => colors.success,
      CampusBindingStatus.linking => colors.info,
      CampusBindingStatus.expired => colors.warning,
      CampusBindingStatus.revoked => colors.warning,
      CampusBindingStatus.unlinked => colors.textMuted,
    };

/// 能力状态 → 设计令牌。
///
/// 注意 `bindingRequired`（引导绑定）与 `unauthenticated`（引导登录）用**不同**的
/// 色与图标：这两个状态在 UI 上也必须一眼可分辨（契约 §5 硬规则 3）。
Color campusCapabilityTone(CampusCapabilityState state, KedaYaColors colors) =>
    switch (state) {
      CampusCapabilityState.available => colors.success,
      CampusCapabilityState.bindingRequired => colors.warning,
      CampusCapabilityState.unauthenticated => colors.info,
      CampusCapabilityState.upstreamUnavailable => colors.warning,
      CampusCapabilityState.unsupported => colors.textMuted,
      CampusCapabilityState.notImplemented => colors.textMuted,
      CampusCapabilityState.unknown => colors.textMuted,
    };

IconData campusCapabilityIcon(CampusCapabilityState state) => switch (state) {
      CampusCapabilityState.available => Icons.check_circle_outline,
      CampusCapabilityState.bindingRequired => Icons.link,
      CampusCapabilityState.unauthenticated => Icons.login,
      CampusCapabilityState.upstreamUnavailable => Icons.cloud_off,
      CampusCapabilityState.unsupported => Icons.block,
      CampusCapabilityState.notImplemented => Icons.construction,
      CampusCapabilityState.unknown => Icons.help_outline,
    };

IconData campusBindingIcon(CampusBindingStatus status) => switch (status) {
      CampusBindingStatus.linked => Icons.check_circle_outline,
      CampusBindingStatus.linking => Icons.hourglass_empty,
      CampusBindingStatus.expired => Icons.schedule,
      CampusBindingStatus.revoked => Icons.link_off,
      CampusBindingStatus.unlinked => Icons.link,
    };

/// 小徽章（状态胶囊）。
class TechpieBadge extends StatelessWidget {
  const TechpieBadge({
    required this.label,
    required this.tone,
    required this.icon,
    super.key,
  });

  final String label;
  final Color tone;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(
          horizontal: KedaYaTokens.space2,
          vertical: KedaYaTokens.space1,
        ),
        decoration: BoxDecoration(
          color: tone.withValues(alpha: 0.14),
          borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
          border: Border.all(color: tone.withValues(alpha: 0.6)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: 14, color: tone),
            const SizedBox(width: KedaYaTokens.space1),
            Text(
              label,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                fontWeight: KedaYaTokens.fontWeightSemibold,
                color: tone,
              ),
            ),
          ],
        ),
      );
}

// ------------------------------------------------------------------ 通用说明

/// 「本页不含凭证」的常驻说明。
///
/// 它不是装饰：规格 §8.3 明确要求绑定响应**不得**出现 8 个凭证键名，
/// 而把这条承诺直接写在界面上，用户与评审都能一眼核对。
class CredentialFreeNotice extends StatelessWidget {
  const CredentialFreeNotice({this.extra, super.key});

  /// 额外一行说明（可选）。
  final String? extra;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.shield_outlined, size: 18, color: colors.info),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              extra == null
                  ? '本页只展示绑定**元数据**（状态 / 有效期 / 对端标识），'
                      '不含任何凭证：没有会话串、没有网站凭据、没有会话票据。'
                  : '本页只展示绑定**元数据**（状态 / 有效期 / 对端标识），'
                      '不含任何凭证：没有会话串、没有网站凭据、没有票据。\n$extra',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.textMuted,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 「登录」与「绑定」是两件事（契约 §5 的两级模型）。
///
/// presentation 层**刻意**分两次读取两级状态，因此这个组件需要两个独立入参，
/// 而不是一个合并后的对象 —— 合并对象正是契约 §5 要防的东西。
class TwoTierIdentityNotice extends StatelessWidget {
  const TwoTierIdentityNotice({
    required this.signedIn,
    required this.identityLabel,
    required this.bindingSummary,
    super.key,
  });

  /// 第一级：有没有登录。
  final bool signedIn;

  /// 第一级：登录主体（未登录时为 null）。
  final String? identityLabel;

  /// 第二级：绑定概况（例如「2 个校园系统，其中 1 个已过期」）。
  final String bindingSummary;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            '两级身份（契约 §5）',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              fontWeight: KedaYaTokens.fontWeightSemibold,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Row(
            children: <Widget>[
              TechpieBadge(
                label: signedIn ? '一级 · 已登录' : '一级 · 未登录',
                tone: signedIn ? colors.success : colors.info,
                icon: signedIn ? Icons.badge_outlined : Icons.login,
              ),
              const SizedBox(width: KedaYaTokens.space2),
              TechpieBadge(
                label: '二级 · $bindingSummary',
                tone: colors.textMuted,
                icon: Icons.hub_outlined,
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            signedIn
                ? '当前身份：${identityLabel ?? '（无显示名）'}'
                    '。已登录但未绑定是**合法状态** —— 校园功能会提示去绑定，'
                    '而不是把你踢回登录页。'
                : '还没有登录。校园自有功能（论坛 / 找搭子 / 拼单 / 校园动物）'
                    '在未登录时依然可用；校园系统能力需要先登录、再绑定。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------ 绑定卡

/// 一条绑定（**只含元数据**）。
class TechpieLinkCard extends StatelessWidget {
  const TechpieLinkCard({
    required this.link,
    this.onUnbind,
    this.onRenew,
    this.busy = false,
    this.now,
    super.key,
  });

  final TechpieLink link;
  final VoidCallback? onUnbind;
  final VoidCallback? onRenew;

  /// 操作进行中（按钮禁用，避免重复提交）。
  final bool busy;

  /// 可注入的"当前时刻"（测试用；UI 默认用真实时间）。
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final DateTime clock = now ?? DateTime.now();
    final bool usable = link.isUsableAt(clock);
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  link.platform.label,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeMd,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
              ),
              TechpieBadge(
                label: usable ? '可用' : link.status.label,
                tone: campusBindingTone(link.status, colors),
                icon: campusBindingIcon(link.status),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          _MetaRow(label: '绑定 id', value: link.id),
          _MetaRow(
            label: '对端标识',
            value: link.summary.externalUserId ?? '（服务端未返回）',
          ),
          _MetaRow(
            label: '有效期至',
            value: link.summary.expiresAt == null
                ? '由服务端决定'
                : _formatUtc(link.summary.expiresAt!),
          ),
          _MetaRow(
            label: '最近同步',
            value: link.summary.lastSyncAt == null
                ? '（暂无）'
                : _formatUtc(link.summary.lastSyncAt!),
          ),
          if (link.status.needsRebind) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              '绑定已失效：**登录状态不受影响**（契约 §5 硬规则 3）。'
              '重新绑定即可恢复该平台的校园能力。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.warning,
              ),
            ),
          ],
          const SizedBox(height: KedaYaTokens.space3),
          Row(
            children: <Widget>[
              OutlinedButton(
                onPressed: busy ? null : onUnbind,
                child: const Text('解绑'),
              ),
              const SizedBox(width: KedaYaTokens.space2),
              OutlinedButton(
                onPressed: busy || !link.canRenew ? null : onRenew,
                child: const Text('手动续期'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------ 能力卡

/// 一条能力（未绑定项显示**引导**，不是报错）。
class CampusCapabilityTile extends StatelessWidget {
  const CampusCapabilityTile({
    required this.capability,
    this.onGuide,
    this.guideLabel,
    super.key,
  });

  final CampusCapability capability;

  /// 引导动作（去绑定 / 去登录）。为 null 时只展示说明。
  final VoidCallback? onGuide;
  final String? guideLabel;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final Color tone = campusCapabilityTone(capability.state, colors);
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  capability.title,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeMd,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
              ),
              TechpieBadge(
                label: capability.state.wire,
                tone: tone,
                icon: campusCapabilityIcon(capability.state),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            capability.description,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Row(
            children: <Widget>[
              TechpieBadge(
                label: capability.phase.label,
                tone: capability.phase.isImplemented
                    ? colors.info
                    : colors.textMuted,
                icon: capability.phase.isImplemented
                    ? Icons.check_circle_outline
                    : Icons.lock_clock,
              ),
              if (capability.platform != null) ...<Widget>[
                const SizedBox(width: KedaYaTokens.space2),
                TechpieBadge(
                  label: capability.platform!.label,
                  tone: colors.textMuted,
                  icon: Icons.dns_outlined,
                ),
              ],
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            capability.state.guidance,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.text,
            ),
          ),
          if (!capability.phase.isImplemented) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space1),
            Text(
              capability.phase.blockingNote,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.textMuted,
              ),
            ),
          ],
          if (capability.reason != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space1),
            Text(
              '上游原因：${capability.reason}',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
          ],
          if (onGuide != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space3),
            FilledButton(
              onPressed: onGuide,
              child: Text(guideLabel ?? '去处理'),
            ),
          ],
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------ 校园卡

/// 余额卡。
class CampusCardBalanceCard extends StatelessWidget {
  const CampusCardBalanceCard({required this.account, super.key});

  final CampusCardAccount account;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      decoration: BoxDecoration(
        color: colors.brandSoft,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusXl),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            '校园卡余额',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              color: colors.inkSoft,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          MoneyText(
            account.balanceFen,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeDisplay,
              fontWeight: KedaYaTokens.fontWeightBold,
              color: colors.ink,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '${account.holderName} · ${account.cardNumberMasked}',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.inkSoft,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            '更新于 ${_formatUtc(account.updatedAt)}',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.inkSoft,
            ),
          ),
        ],
      ),
    );
  }
}

/// 一笔流水。
class CampusCardTransactionTile extends StatelessWidget {
  const CampusCardTransactionTile({required this.transaction, super.key});

  final CampusCardTransaction transaction;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final bool debit =
        transaction.direction == CampusCardTransactionDirection.debit;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space4,
        vertical: KedaYaTokens.space3,
      ),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
        border: Border.all(color: colors.border),
      ),
      child: Row(
        children: <Widget>[
          Icon(
            debit ? Icons.remove_circle_outline : Icons.add_circle_outline,
            size: 18,
            color: debit ? colors.danger : colors.success,
          ),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  transaction.merchant,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightMedium,
                    color: colors.text,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${transaction.direction.label} · ${_formatUtc(transaction.occurredAt)}',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: colors.textMuted,
                  ),
                ),
              ],
            ),
          ),
          MoneyText(
            transaction.signedAmountFen,
            signed: true,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              fontWeight: KedaYaTokens.fontWeightSemibold,
              color: debit ? colors.danger : colors.success,
            ),
          ),
        ],
      ),
    );
  }
}

/// 付款码（短时效支付凭据）。
class CampusPaymentCodeCard extends StatelessWidget {
  const CampusPaymentCodeCard({
    required this.code,
    this.onRefresh,
    this.now,
    super.key,
  });

  final CampusPaymentCode code;
  final VoidCallback? onRefresh;
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final DateTime clock = now ?? DateTime.now();
    final bool expired = code.isExpiredAt(clock);
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  '付款码',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeMd,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
              ),
              TechpieBadge(
                label: expired ? '已失效' : '有效',
                tone: expired ? colors.textMuted : colors.success,
                icon: expired ? Icons.timer_off_outlined : Icons.timer_outlined,
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space3),
          Text(
            code.displayCode,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXl,
              fontWeight: KedaYaTokens.fontWeightBold,
              letterSpacing: 2,
              fontFamily: KedaYaTokens.fontFamilyMono,
              color: expired ? colors.textMuted : colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            expired
                ? '已过期，请重新取码。'
                : '有效期至 ${_formatUtc(code.expiresAt)}（${code.refreshAfterSec ?? 60} 秒后刷新）。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '付款码是短时效支付凭据：**不缓存、不落盘**，离开本页即失效；'
            '本页也不会把它写进任何日志。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
          if (onRefresh != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space3),
            OutlinedButton(onPressed: onRefresh, child: const Text('刷新付款码')),
          ],
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------ 内部

class _MetaRow extends StatelessWidget {
  const _MetaRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
            width: 72,
            child: Text(
              label,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.text,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// UTC ISO 时间的展示形式（契约 §6.1：时间统一是 ISO-8601 UTC）。
String _formatUtc(DateTime value) {
  final DateTime utc = value.toUtc();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${utc.year}-${two(utc.month)}-${two(utc.day)} '
      '${two(utc.hour)}:${two(utc.minute)} UTC';
}
