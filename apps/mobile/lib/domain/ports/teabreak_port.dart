import '../models/result.dart';
import '../models/teabreak.dart';

/// `teabreak` 业务端口（契约 §4.1 `teabreak`；规则见
/// `packages/contracts/src/teabreaks.ts`）。
///
/// 敏感级 **低**、**无同意门**（与 `buddy` / `wildlife` 同类）：
///
/// - **读**（[list]）不需要登录 —— 判断「现在哪栋楼有免费茶歇」不该先要账号；
/// - **写**（[confirm] / [create]）需要登录（服务端据此限流与追责）；
/// - 本端口**不携带**第一级身份（没有学号 / 姓名 / token），身份走 `AuthPort`。
///
/// ## 刻意**没有**的能力
///
/// 契约开头第 3 条写明：不做「会议室实时人数」，也不做「预约茶歇」。
/// 因此这里没有 `countPeople` / `reserve` / `join` 之类的方法 ——
/// 这类功能在类型上就写不出来。
///
/// ## 为什么 `confirm` 返回 `Unit` 而不是 `void`
///
/// `domain/models/result.dart` 的文档已经定了：`void` 不适合做泛型实参
/// （`Result<T>.valueOrNull` 会变成 `void?`，取值即编译错），因此"成功但没有值"
/// 一律用 [Unit]。这与 `TechpiePort.unbind` / `WildlifePort.deleteSighting` 同构。
abstract interface class TeabreakPort {
  /// `GET /api/v1/teabreak/items` —— 茶歇列表。
  ///
  /// 返回的是**未排序**的原始集合：排序是纯领域函数
  /// [sortTeabreaks]，由调用方注入 `now` 后再排 —— 服务端的顺序不参与决策。
  Future<Result<List<Teabreak>>> list();

  /// `POST /api/v1/teabreak/items/:id/confirms` —— 「我去看了，还有」。
  ///
  /// 契约没有规定"只能在茶歇时间窗内确认"，服务端也不该替用户拒绝一次
  /// 诚实上报；UI 只在已经 `over` 的条目上不显示这个按钮。
  Future<Result<Unit>> confirm(String id);

  /// `POST /api/v1/teabreak/items` —— 报一条茶歇。
  ///
  /// 校验（长度 / 时间窗 / 是否已结束）是**纯领域函数**
  /// [validateTeabreakDraft]：客户端先用它做即时反馈，
  /// 服务端仍然必须用同一套规则再校验一次（客户端入参一律不可信）。
  Future<Result<Teabreak>> create(TeabreakDraft draft);
}
