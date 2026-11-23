import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/app_providers.dart';
import '../../../data/repositories/remote_push_repository.dart';
import '../../../domain/ports/push_port.dart';
import '../../../platform/push_token_channel.dart';

final pushPortProvider = Provider<PushPort>((ref) {
  final runtime = ref.watch(appRuntimeProvider);
  final api = runtime.api;
  if (api == null) throw StateError('Mock 运行时不注册真实推送设备');
  return RemotePushRepository(api);
});

final pushTokenPortProvider = Provider<PushTokenPort>(
  (ref) => const MethodChannelPushTokenProvider(),
);
