import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../application/consent_controller.dart';
import '../../application/module_catalog.dart';
import '../../domain/models/kedaya_module.dart';
import '../components/kedaya_shell.dart';
import '../theme/kedaya_theme_extension.dart';
import '../theme/kedaya_tokens.dart';

/// 已实现垂直切片的入口路由（契约 §4 的模块 id → 该模块的落地路由）。
///
/// 未列出的模块仍然只有"尚未实现"的如实说明，没有假页面、没有假成功。
const Map<String, String> implementedModuleRoutes = <String, String>{
  'groupbuy': '/groupbuy',
  'buddy': '/buddy',
  'forum': '/forum',
  'faq': '/faq',
  'wildlife': '/wildlife',
  'techpie': '/techpie',
  'campus-card': '/campus-card',
  'teabreak': '/teabreak',
};

/// 模块落地页 —— **注册表驱动**，不含任何伪造的业务数据。
///
/// 已实现的模块（`groupbuy` / `forum` / `faq`）从这里给出真实入口；
/// 其余模块如实说明"尚未实现"，并展示它在契约里的冻结信息
/// （路由前缀 / 敏感级 / 是否需要二次同意）。这样"未实现"是**可见的**，
/// 而不是假装成功。
class ModuleDetailPage extends ConsumerWidget {
  const ModuleDetailPage({required this.moduleId, super.key});

  final String moduleId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final KedayaModule? module = ref.watch(moduleByIdProvider(moduleId));
    if (module == null) {
      return KedaYaPageScaffold(
        title: '未知模块',
        child: Center(
          child: Text(
            '模块 "$moduleId" 不在冻结注册表里（契约 §4）。',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              color: colors.textMuted,
            ),
          ),
        ),
      );
    }

    final bool hasConsent =
        ref.watch(consentControllerProvider).valueOrNull?.contains(module.id) ??
            false;

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
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightLoose,
              color: colors.text,
            ),
          ),
          if (module.requiresConsent) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space5),
            Text(
              '敏感模块 · 二次同意（契约 §9）',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeMd,
                fontWeight: KedaYaTokens.fontWeightSemibold,
                color: colors.text,
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
              color: colors.surfaceAlt,
              borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  '实现状态',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
                const SizedBox(height: KedaYaTokens.space2),
                Text(
                  switch (module.id) {
                    'groupbuy' => '本模块已实现：列表 + 详情 + 参团，'
                        '走 domain/ports 的 GroupbuyPort。',
                    'buddy' => '本模块已实现：三板块分栏列表（游标分页）+ 详情 + 申请/审批/关闭 + '
                        '发布（封闭标签选择器）+ 我的匹配资料（可用时段含跨零点）+ '
                        '可解释推荐（展示匹配理由）+ like/dislike/skip 反馈 + 隐私说明，'
                        '走 BuddyPort。**不含 dating 板块**（契约 §11.10-G）。',
                    'forum' => '本模块已实现：版块筛选 + 主题列表（游标分页）+ 主题详情 + '
                        '回复 + 发帖（含匿名开关）+ 举报 + 分享，走 ForumPort。',
                    'faq' => '本模块已实现：分类导航 + 搜索 + 手风琴展开 + '
                        '「有用」（幂等）+ 我的工单，走 FaqPort。',
                    'wildlife' => '本模块已实现：静态底图 + 叠加层（区域/聚合热点/推断轨迹）+ '
                        '观测列表与详情 + 区域与告示位 + 上报（选图/定位/分类建议/命名个体/'
                        '伦理确认）+ 推断轨迹页，走 WildlifePort。',
                    'techpie' => '本模块已实现 **Phase 0**：绑定管理（列表 / 发起绑定 / 解绑 / '
                        '手动续期，响应不含凭证）+ 能力清单（未绑定项显示 '
                        'CAMPUS_BINDING_REQUIRED 引导，**不是**报错）+ 校园系统 WebView 直连'
                        '（一次性票据；票据不缓存、不进日志），走 TechpiePort。'
                        '**未实现**：Phase 1（结构化校园数据，阻塞于信息办书面回复）、'
                        'Phase 2（场馆预约 / 会话注入）、Phase 3（自动续期）。'
                        '**不做**：任何校园会话落库路径。',
                    'teabreak' => '本模块已实现：列表（按 worthGoing → freshness → '
                        '结束时间排序）+「确认还有」+ 新建表单 + 三态与空态，'
                        '走 TeabreakPort。时效规则（20 分钟）与校验规则全部来自'
                        '契约的纯函数镜像，**页面里没有规则副本**。'
                        '**不做**：会议室实时人数、预约茶歇（契约开头第 3 条）。',
                    'campus-card' => '本模块已实现：余额 / 流水 / 付款码，走 CampusCardPort ——'
                        '**独立 OPENID 通道**（规格 §2.5），与校园会话代持完全解耦，'
                        '因此不产生任何 CASTGC。未开通时接口返回 409 '
                        'CAMPUS_BINDING_REQUIRED（不是 401）。',
                    _ => '本模块尚未实现：只有冻结契约里的路由与权限信息，'
                        '没有页面、没有 mock 数据、没有假成功。',
                  },
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.textMuted,
                  ),
                ),
                if (implementedModuleRoutes[module.id] != null) ...<Widget>[
                  const SizedBox(height: KedaYaTokens.space4),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: () =>
                          context.push(implementedModuleRoutes[module.id]!),
                      icon: const Icon(Icons.arrow_forward, size: 18),
                      label: const Text('进入模块'),
                    ),
                  ),
                ],
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
    final KedaYaColors colors = context.kedayaColors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: KedaYaTokens.space1),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
            width: 96,
            child: Text(
              label,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: colors.textMuted,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: colors.text,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
