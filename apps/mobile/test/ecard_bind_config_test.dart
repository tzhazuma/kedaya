import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/campus/ecard_bind_config.dart';

/// 绑定密钥的构建期配置。
///
/// 这里守的是**默认不可用**：没注入密钥时必须 `isConfigured == false`，
/// 页面据此不显示入口。反过来（默认可用）会让普通构建里出现一个注定失败的按钮。
///
/// 注意：`String.fromEnvironment` 是**编译期**常量，测试进程里没有
/// `--dart-define`，所以本文件只能覆盖「未配置」这一支；
/// 「已配置」这一支由 `ecard_bind_client_test.dart` 用显式入参覆盖。
void main() {
  test('未注入密钥时视为未配置', () {
    final EcardBindConfig config = EcardBindConfig.fromDartDefine();
    expect(config.isConfigured, isFalse);
    expect(config.bindToken.trim(), isEmpty);
  });

  test('默认基址仍是校园卡站点', () {
    expect(
      EcardBindConfig.fromDartDefine().baseUrl,
      EcardBindConfig.defaultBaseUrl,
    );
    expect(EcardBindConfig.defaultBaseUrl, 'https://ecard.shanghaitech.edu.cn');
  });

  test('显式空白 token 也算未配置', () {
    expect(const EcardBindConfig(bindToken: '   ', baseUrl: 'x').isConfigured, isFalse);
    expect(const EcardBindConfig(bindToken: 'k', baseUrl: 'x').isConfigured, isTrue);
  });

  test('toString 不泄露密钥', () {
    const EcardBindConfig config = EcardBindConfig(
      bindToken: 'SUPER-SECRET-KEY',
      baseUrl: 'https://ecard.shanghaitech.edu.cn',
    );
    expect(config.toString(), isNot(contains('SUPER-SECRET-KEY')));
    expect(config.toString(), contains('已配置'));
  });
}
