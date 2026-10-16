import '../models/page.dart';
import '../models/result.dart';
import '../models/wellbeing_appointment.dart';

/// 心理治疗业务端口（契约 §4.1 `wellbeing`，敏感级 **critical**）。
///
/// 契约 §9 约束实现：
///   - 读写全部落审计日志；
///   - 数据**不进入**通用画像，`ai-portrait` 不得读取；
///   - 首次进入必须先经 `ConsentPort` 二次同意；
///   - 危机干预出口必须本地可用、且不可被埋进二级菜单。
abstract interface class WellbeingPort {
  /// 危机干预资源。**同步且本地可用**：无网络时也必须能展示。
  ///
  /// 实现应合并本地内置资源与服务端资源；返回空列表视为实现缺陷。
  List<CrisisResource> crisisResources();

  /// `GET /api/v1/wellbeing/items`（游标分页，仅本人可见）。
  Future<Result<Page<WellbeingAppointment>>> listAppointments({String? cursor, int limit});

  /// `GET /api/v1/wellbeing/items/:id`。
  Future<Result<WellbeingAppointment>> getAppointment(String id);

  /// `POST /api/v1/wellbeing/items`。
  Future<Result<WellbeingAppointment>> bookAppointment(
    BookWellbeingAppointmentCommand command,
  );

  /// `POST /api/v1/wellbeing/items/:id/cancel`。
  Future<Result<WellbeingAppointment>> cancelAppointment(String id);
}
