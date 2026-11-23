enum PushChannel {
  apns('apns'),
  fcm('fcm'),
  hms('hms'),
  wechatSubscribe('wechat-subscribe');

  const PushChannel(this.wire);
  final String wire;

  static PushChannel fromWire(String value) => PushChannel.values.firstWhere(
        (PushChannel channel) => channel.wire == value,
        orElse: () => throw FormatException('未知推送渠道：$value'),
      );
}

final class PushTargetView {
  const PushTargetView(
      {required this.channel, required this.status, this.templateId});

  final PushChannel channel;
  final String status;
  final String? templateId;
}

final class PushStatus {
  const PushStatus({required this.configured, required this.targets});

  final List<PushChannel> configured;
  final List<PushTargetView> targets;
}

abstract interface class PushPort {
  Future<PushTargetView> register(PushChannel channel, String token);
  Future<bool> revoke(PushChannel channel, String token);
  Future<PushStatus> status();
}
