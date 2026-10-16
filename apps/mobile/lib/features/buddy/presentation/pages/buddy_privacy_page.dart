import 'package:flutter/material.dart';

import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 找搭子的隐私说明（规格 §6.1–§6.4 / §1.2 / §6.3）。
///
/// 这一页是**产品承诺的落点**：下面每一条都能在代码里找到对应实现，
/// 不是宣传文案（见 `lib/features/buddy/README.md` §4 的「承诺 ↔ 实现」对照表）。
///
/// 特别说明**为什么这里没有同意门**：契约 §9 的判定规则
/// （`packages/contracts/src/modules.test.ts`）把 `buddy` 定为敏感级**低**、
/// **无同意门**。这是刻意的 —— 一旦加入 dating 板块，就必须新增同意门 +
/// 新 ADR + 新 PIA 条目（规格 §1.3 / 契约 §11.10-G），所以本模块**不做 dating**。
class BuddyPrivacyPage extends StatelessWidget {
  const BuddyPrivacyPage({super.key});

  static const List<(String, String)> _items = <(String, String)>[
    (
      '默认不参与匹配',
      '匹配开关（matchEnabled）默认是关的。不主动打开，你的兴趣与可用时段就不会进入推荐池。'
          '「找搭子」本身不需要任何校园系统能力，也不需要二次同意（敏感级：低）。',
    ),
    (
      '可随时撤回',
      '删除匹配资料会硬删这一份数据（含服务端生成的向量），立即从推荐池移除。'
          '账号资料不受影响 —— 匹配资料与「我是谁」是两份独立的数据。',
    ),
    (
      '匹配资料对任何人不可见',
      '你的兴趣标签、可用时段、常去区域、院系与自述，对任何人都不直接可见，'
          '包括活动发起人。算法只输出「分数 + 聚合后的理由短语」'
          '（例如「共同兴趣：羽毛球」），不会暴露你的完整标签集。',
    ),
    (
      '不采集敏感属性',
      '匹配资料里没有性别、年龄、出生日期、MBTI、婚恋字段，也没有精确坐标 —— '
          '只有校园地点的区域粒度。性别偏好是发起人的准入约束，不参与打分。',
    ),
    (
      '不进通用画像',
      '「兴趣 + 可用时段」是典型的画像输入，因此本模块主动禁止 ai-portrait 读取'
          '匹配资料与匹配反馈。这条禁令在服务端 Guard 的拒绝列表里，不靠自觉。',
    ),
    (
      '反馈针对活动，不针对人',
      'like / dislike / skip 记的是「我对这个活动感不感兴趣」，不是对某个同学的评价。'
          '同一板块内对同一活动的反馈可覆盖（不会累积），换板块互不影响。',
    ),
    (
      '联系方式不落在活动上',
      '活动说明里写手机号 / 微信号 / QQ 号会被直接拒绝，页面也不展示任何人的联系方式。'
          '只有申请被发起人接受后，系统才通过站内通知帮双方交换。',
    ),
    (
      '不做交友 / 约会板块',
      '「找搭子」只有学术自习、日常（吃饭出行）、运动组队三个板块。'
          '不做 dating 是明确的契约裁决 —— 校园平台做择偶匹配的合规与舆情风险'
          '显著高于「找搭子」，且实名身份与婚恋倾向同表存储的泄漏后果不可逆。',
    ),
    (
      '保留期与审计',
      '匹配资料与账号同生命周期，账号注销后 30 天内硬删。本模块敏感级为低，'
          '不做逐次读写审计（只审计管理员的下架操作）。',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Scaffold(
      appBar: AppBar(title: const Text('找搭子 · 隐私说明')),
      body: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          Container(
            padding: const EdgeInsets.all(KedaYaTokens.space4),
            decoration: BoxDecoration(
              color: colors.surfaceAlt,
              borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
              border: Border.all(color: colors.border),
            ),
            child: Text(
              '「找搭子」的匹配要用的只有：参与板块、兴趣与活动标签、每周可用时段、'
              '常去区域、运动水平、院系、一句话自述。这些信息只被算法使用。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                height: KedaYaTokens.lineHeightLoose,
                color: colors.text,
              ),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space4),
          for (final (String, String) item in _items) ...<Widget>[
            _PrivacyItem(title: item.$1, body: item.$2),
            const SizedBox(height: KedaYaTokens.space3),
          ],
          const SizedBox(height: KedaYaTokens.space3),
          Text(
            '本平台由学生社区维护，与上海科技大学官方系统无关。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}

class _PrivacyItem extends StatelessWidget {
  const _PrivacyItem({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
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
          Text(
            title,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              fontWeight: KedaYaTokens.fontWeightSemibold,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            body,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}
