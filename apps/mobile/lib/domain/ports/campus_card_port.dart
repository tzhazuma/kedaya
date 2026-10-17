import '../models/api_request.dart';
import '../models/campus_card.dart';
import '../models/page.dart';
import '../models/result.dart';

/// 第二级 · 能力层的**校园卡端口（独立 OPENID 通道）**。
///
/// 规格 §2.5 的关键发现：校园卡**不依赖**校园会话（CASTGC），
/// 它走 eCard 自己的 **OPENID** 会话。
///
/// 因此这里**单独**定义端口，而不是塞进 `TechpiePort`：
///
///   - 它不需要任何校园会话代持 → **零合规风险**，可独立落地；
///   - 它没有、也不可能有"取校园 cookie"的方法（类型上就写不出来）；
///   - 「校园卡能不能用」与「eGate 有没有绑定」是两个**独立**的问题，
///     合成一个端口会让两级/两条通道的边界在实现层被悄悄耦合。
///
/// 与 `TechpiePort` 的关系：两者都是第二级能力层，但**通道不同**。
/// 二者都**不**携带第一级身份（契约 §5 硬规则 1）。
abstract interface class CampusCardPort {
  /// 校园卡开通状态（`GET /campus-card/link`）。
  Future<Result<CampusCardLink>> linkStatus();

  /// 用 OPENID 开通校园卡（规格 §2.5 的 `connect(openId, channel)`）。
  ///
  /// [openId] 只在本方法入参里出现一次；实现**不得**把它写进日志、
  /// 错误信息或本地存储。返回的元数据只带**脱敏尾巴**。
  Future<Result<CampusCardLink>> connect({
    required String openId,
    String channel = 'wechat',
  });

  /// 解除开通（幂等）。
  Future<Result<Unit>> disconnect();

  /// 余额（金额为**整数分**，契约 §6.1）。
  Future<Result<CampusCardAccount>> account();

  /// 流水（游标分页）。
  Future<Result<Page<CampusCardTransaction>>> listTransactions({
    String? cursor,
    int limit = defaultPageSize,
  });

  /// 付款码（短时效支付凭据）。
  ///
  /// 实现**不得**缓存或落盘它；调用方用完即弃。
  Future<Result<CampusPaymentCode>> paymentCode();
}
