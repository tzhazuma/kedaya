import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/app_providers.dart';
import '../../../../data/campus/ecard_api_client.dart' show EcardException;
import '../../../../data/campus/ecard_bind_client.dart';
import '../../../../data/campus/ecard_bind_config.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/techpie_providers.dart';

/// 「输入小程序绑定码」对话框。
///
/// 流程按学校一卡通小程序的方式：小程序首页显示一次性 6 位绑定码，
/// 用户抄到客户端 → 客户端换 OPENID → 落到加密存储 → 刷新校园卡状态。
///
/// 三条纪律：
/// - 密钥来自构建期配置，页面**不接触**它；
/// - 换到的 OPENID 只经 [CampusCardPort.connect] 入参出现一次，不显示、不打印；
/// - 没配置密钥时这个入口根本不该出现（调用方负责判断）。
Future<bool?> showEcardBindDialog(BuildContext context) {
  return showDialog<bool>(
    context: context,
    builder: (BuildContext context) => const _EcardBindDialog(),
  );
}

class _EcardBindDialog extends ConsumerStatefulWidget {
  const _EcardBindDialog();

  @override
  ConsumerState<_EcardBindDialog> createState() => _EcardBindDialogState();
}

class _EcardBindDialogState extends ConsumerState<_EcardBindDialog> {
  final TextEditingController _code = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting) return;
    final String raw = _code.text;
    if (raw.replaceAll(RegExp(r'\s+'), '').isEmpty) {
      setState(() => _error = '请输入小程序里的绑定码');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });

    final EcardBindConfig config = EcardBindConfig.fromDartDefine();
    try {
      final EcardBindClient client = EcardBindClient(
        bindToken: config.bindToken,
        baseUrl: config.baseUrl,
      );
      final EcardBindResult binding = await client.exchange(raw);

      // OPENID 只在这里出现一次：交给端口落盘，随后丢弃。
      final result = await ref
          .read(campusCardRepositoryProvider)
          .connect(openId: binding.openId, channel: binding.channel);
      if (result.isErr) {
        setState(() {
          _submitting = false;
          _error = result.errorOrNull!.userMessage;
        });
        return;
      }

      // 交换用过的码立刻失效；把它从输入框里也抹掉，避免被截图留在屏幕上。
      _code.clear();
      ref.invalidate(campusCardControllerProvider);
      if (mounted) Navigator.of(context).pop(true);
    } on EcardException catch (error) {
      setState(() {
        _submitting = false;
        _error = error.message;
      });
    } catch (error) {
      setState(() {
        _submitting = false;
        _error = '绑定失败：$error';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return AlertDialog(
      title: const Text('输入绑定码'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            '在微信里打开学校一卡通小程序，点首页顶部的「绑定码」，'
            '把显示的 6 位码填到这里。绑定码一次性有效，几分钟后过期。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          TextField(
            controller: _code,
            autofocus: true,
            enabled: !_submitting,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(
              labelText: '绑定码',
              hintText: '例如 A1B2C3',
            ),
            onSubmitted: (_) => _submit(),
          ),
          if (_error != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              _error!,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.danger,
              ),
            ),
          ],
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: _submitting ? null : () => Navigator.of(context).pop(false),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: _submitting ? null : _submit,
          child: _submitting
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('绑定'),
        ),
      ],
    );
  }
}
