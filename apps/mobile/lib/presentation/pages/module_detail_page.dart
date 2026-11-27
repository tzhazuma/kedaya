import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../application/consent_controller.dart';
import '../../application/module_catalog.dart';
import '../../application/module_entries.dart';
import '../../domain/models/kedaya_module.dart';
import '../components/kedaya_shell.dart';
import '../theme/kedaya_theme_extension.dart';
import '../theme/kedaya_tokens.dart';

/// 已实现垂直切片的入口路由（契约 §4 的模块 id → 该模块的落地路由）。
///
/// 唯一真相在 `application/module_entries.dart`；这里保留旧名字，
/// 避免既有引用与测试失效。
const Map<String, String> implementedModuleRoutes = moduleEntryRoutes;

/// 模块落地页 —— **注册表驱动**，不含任何伪造的业务数据。
///
/// 目录里的卡片默认直达真实页面（见 `application/module_entries.dart`），
/// 本页只承担两种角色：尚未实现的模块在这里如实说明；已实现模块的
/// 契约信息与二次同意开关仍可从本页查看（`/module/:id` 直接打开）。
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
                    'techpie' => '这些校园能力已经并入常用入口，不再有独立模块：'
                        '校园系统直连在「校园服务」，余额 / 流水 / 付款码在「校园卡」，'
                        '绑定管理与能力清单在「我的」。'
                        '**不做**：任何校园会话落库路径。',
                    'teabreak' => '本模块已实现：列表（按 worthGoing → freshness → '
                        '结束时间排序）+「确认还有」+ 新建表单 + 三态与空态，'
                        '走 TeabreakPort。时效规则（20 分钟）与校验规则全部来自'
                        '契约的纯函数镜像，**页面里没有规则副本**。'
                        '**不做**：会议室实时人数、预约茶歇（契约开头第 3 条）。',
                    'activities' => '本模块已实现：独立活动域（**不混进课程 DDL**）——'
                        '列表 + 来源/状态筛选 + 详情 + 确认/忽略 + 手动创建 + '
                        '公众号单篇导入 + 复制报名/来源链接 + 站内信提醒状态，'
                        '走 ActivitiesPort。候选活动确认后才允许创建提醒；'
                        '无法确定的报名截止只保留原文，不补 23:59。'
                        '**不做**：公众号自动发现/批量抓取、反检测、系统推送。',
                    'notifications' =>
                      '本模块已实现：通知设置支持用户主动启用 APNs / FCM / HMS 原生设备登记与撤销，服务端按发件箱派发；未配置厂商时明确报错，桌面端保留站内信。',
                    'zhishu' =>
                      '本模块已实现：知枢工作台含日报、JARVIS 本地引用检索、资料库、知乎条目与 QQ 文本导入五页，共用本机持久化工作区。在线知乎、公众号与 QQ 同步需另行授权，不读取或结束其他应用进程。',
                    'campus-card' => '本模块已实现：余额 / 流水 / 付款码，走 CampusCardPort ——'
                        '**独立 OPENID 通道**（规格 §2.5），与校园会话代持完全解耦，'
                        '因此不产生任何 CASTGC。未开通时接口返回 409 '
                        'CAMPUS_BINDING_REQUIRED（不是 401）。',
                    'takeout-guard' =>
                      '本模块已实现：本人可见的外卖报备记录（新增 / 标记已解决 / 删除），'
                          '本机演示，不会通知任何人，也不做公开举报墙。',
                    'lost-found' =>
                      '本模块已实现：寻物 / 招领列表 + 搜索 + 状态筛选 + 详情 + 标记解决，'
                          '联系方式只存本机，公开前请自行脱敏。',
                    'flea-market' =>
                      '本模块已实现：二手列表（分类 / 搜索 / 价格排序）+ 发布 + 详情 + '
                          '复制联系文案 + 下架/重新上架，全部本机演示数据。',
                    'errand' =>
                      '本模块已实现：待接单 / 进行中 / 已完成三 Tab、发布、详情与接单→完成流转；'
                          '演示：不会真的通知对方。',
                    'dorm-harmony' =>
                      '本模块已实现：匿名倾诉板（楼栋筛选 / 匿名发帖 / 回复）。'
                          '不点名、不做公开举报墙；涉及安全请直接联系辅导员/保卫处。',
                    'schedule' =>
                      '本模块已实现：今天 / 本周课表，进行中课程高亮；演示课表，真实课表需接教务。',
                    'deadlines' =>
                      '本模块已实现：DDL 列表（排序 / 筛选 / 逾期提示 / 新增 / 完成 / 删除）+ 统计条；'
                          'DDL 不写入课程表。',
                    'canteen' =>
                      '本模块已实现：营养管家（今日汇总 / 按食堂看菜品 / 记一餐 / 今日记录），'
                          '营养值为演示估算；记录只保存在本机。',
                    'campus-map' =>
                      '本模块已实现：校园地点目录（分类 / 搜索 / 详情 / 复制位置与坐标）；'
                          '未接入地图 SDK，坐标仅演示。',
                    'facility' =>
                      '本模块已实现：场馆列表 + 日期/时段选择 + 预约 + 我的预约与取消，'
                          '含同场馆同时段冲突检测；演示数据，不会真的锁定场馆。',
                    'petition' =>
                      '本模块已实现：建议与诉求（提交 / 我的提交 / 状态时间线 / 撤回）；'
                          '演示版：只保存在本机，不会发送给学校。',
                    'wellbeing' =>
                      '本模块已实现：首屏热线卡 + 二次同意门 + 本机预约 + 我的预约 + 清空记录；'
                          '只做倾听与预约，不做诊断 / 治疗 / 量表。',
                    'ai-portrait' =>
                      '本模块已实现：只读画像 + 标签来源与更新时间 + 空态 + 删除本机画像；'
                          '心理支持与宿舍矛盾不参与画像。',
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
                      label: const Text('打开'),
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
