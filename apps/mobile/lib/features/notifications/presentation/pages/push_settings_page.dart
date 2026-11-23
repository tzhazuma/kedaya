import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../domain/ports/push_port.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/push_providers.dart';

class PushSettingsPage extends ConsumerStatefulWidget {
  const PushSettingsPage({super.key});

  @override
  ConsumerState<PushSettingsPage> createState() => _PushSettingsPageState();
}

class _PushSettingsPageState extends ConsumerState<PushSettingsPage> {
  PushStatus? _status;
  final Map<PushChannel, String> _tokens = <PushChannel, String>{};
  String? _message;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    Future<void>.delayed(Duration.zero, _refresh);
  }

  Future<void> _refresh() async {
    try {
      final status = await ref.read(pushPortProvider).status();
      if (mounted) setState(() => _status = status);
    } on Object catch (error) {
      if (mounted) setState(() => _message = '$error');
    }
  }

  List<PushChannel> get _channels => switch (defaultTargetPlatform) {
        TargetPlatform.android => const <PushChannel>[
            PushChannel.fcm,
            PushChannel.hms
          ],
        TargetPlatform.iOS => const <PushChannel>[PushChannel.apns],
        _ => const <PushChannel>[],
      };

  Future<void> _enable(PushChannel channel) async {
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final token = await ref.read(pushTokenPortProvider).register(channel);
      await ref.read(pushPortProvider).register(channel, token);
      _tokens[channel] = token;
      if (mounted)
        setState(() =>
            _message = '${channel.name.toUpperCase()} 已启用，设备 token 已安全登记');
      await _refresh();
    } on Object catch (error) {
      if (mounted) setState(() => _message = '启用失败：$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _revoke(PushChannel channel) async {
    final token = _tokens[channel];
    if (token == null) {
      setState(() => _message = '本次会话没有该渠道 token；可在原启用设备的会话中撤销');
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(pushPortProvider).revoke(channel, token);
      await ref.read(pushTokenPortProvider).unregister(channel);
      _tokens.remove(channel);
      if (mounted)
        setState(() => _message = '${channel.name.toUpperCase()} 已撤销');
      await _refresh();
    } on Object catch (error) {
      if (mounted) setState(() => _message = '撤销失败：$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final channels = _channels;
    return Scaffold(
      appBar: AppBar(title: const Text('通知与推送')),
      body: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          const Text('只有点击启用后才会申请系统通知权限并登记设备。完整 token 不会显示在页面上。'),
          const SizedBox(height: KedaYaTokens.space3),
          if (_status != null)
            Text(
                '服务端已配置：${_status!.configured.map((channel) => channel.name.toUpperCase()).join('、')}',
                key: const Key('push-configured')),
          if (_message != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space3),
            Text(_message!),
          ],
          if (channels.isEmpty) const Text('当前桌面平台不提供厂商远程推送；活动提醒仍保留站内信。'),
          for (final channel in channels) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space3),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(KedaYaTokens.space4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(channel.name.toUpperCase(),
                        style: Theme.of(context).textTheme.titleMedium),
                    Text(_status?.configured.contains(channel) == true
                        ? '服务端已配置，可登记设备'
                        : '服务端未配置或尚未读取状态，启用时会明确报错'),
                    OverflowBar(
                      children: <Widget>[
                        FilledButton(
                          onPressed: _busy ? null : () => _enable(channel),
                          child: Text('启用 ${channel.name.toUpperCase()}'),
                        ),
                        TextButton(
                          onPressed: _busy ? null : () => _revoke(channel),
                          child: const Text('撤销'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
          if (_busy) const LinearProgressIndicator(),
        ],
      ),
    );
  }
}
