import 'package:flutter/material.dart';

import '../theme/kedaya_tokens.dart';

/// "第三方非官方平台"声明（契约 §9：全站显著标注，不冒充学校官方系统）。
///
/// 放在首页与"我的"页顶部，**不可**被折叠进二级菜单。
class UnofficialPlatformNotice extends StatelessWidget {
  const UnofficialPlatformNotice({this.dense = false, super.key});

  final bool dense;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding:
          EdgeInsets.all(dense ? KedaYaTokens.space3 : KedaYaTokens.space4),
      decoration: BoxDecoration(
        color: KedaYaTokens.colorBrandSoft,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Icon(
            Icons.info_outline,
            size: 18,
            color: KedaYaTokens.colorBrandStrong,
          ),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              '可达鸭是第三方非官方校园服务平台，由学生社区维护，'
              '与上海科技大学官方系统无关；数据以学校系统为准。',
              style: TextStyle(
                fontSize:
                    dense ? KedaYaTokens.fontSizeXs : KedaYaTokens.fontSizeSm,
                height: KedaYaTokens.lineHeightNormal,
                color: KedaYaTokens.colorInkSoft,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
