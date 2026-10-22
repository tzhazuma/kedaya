# feature: `teabreak`（学术会议茶歇分享）

契约 §4.1 的 `teabreak`（敏感级：**低**，**无同意门**）。规则层：
`packages/contracts/src/teabreaks.ts`（**本端只镜像，不新增规则**）。

一句话：同学把校内学术会议的时间、地点和有没有茶歇报上来，其他人据此判断
「**现在**哪栋楼有免费茶歇」。

---

## 1. 这个模块为什么不能按普通列表做

| 约束 | 落地 |
| --- | --- |
| 茶歇有保质期（通常 15–30 分钟） | `teabreakFreshnessMs = 20 分钟`；`teabreakStatus()` 给 `fresh` / `stale` / `over` / `notStarted` |
| 排序不是按时间，是按"值不值得现在跑一趟" | `sortTeabreaks()`：`worthGoing` → `fresh` 先于 `stale` → 结束早的先冲 → 开始时间 |
| `stale` 仍然值得去，但文案必须说清"可能还有" | `TeabreakFreshness.stale.label` = 「20 分钟没人确认了」；卡片同时显示「多久没确认」 |
| 蹭会有风险，但不说破 | `TeabreakAccess` 三种取值 + 每种一句**风险提示**（`TeabreakAccess.hint`），不去评判用户 |
| 不变成骚扰工具 | 端口**没有**实时人数 / 预约 / 参会者列表；`TeabreakPort` 只有 3 个方法 |

## 2. 分层

| 层 | 文件 | 说明 |
| --- | --- | --- |
| domain 模型 | `lib/domain/models/teabreak.dart` | `Teabreak` / `TeabreakConfirm` / `TeabreakStatus` / `TeabreakDraft`；纯函数 `teabreakStatus` / `sortTeabreaks` / `validateTeabreakDraft` / 文案 |
| domain 端口 | `lib/domain/ports/teabreak_port.dart` | `list()` / `confirm(id)` / `create(draft)` |
| data（mock） | `lib/data/mock/teabreak_fixtures.dart` | **相对 `now` 生成**的 4 条演示数据 |
| data（mock） | `lib/data/mock/mock_teabreak_repository.dart` | 内存实现：确认会真的追加、新建会真的跑校验 |
| data（remote） | `lib/data/repositories/remote_teabreak_repository.dart` | `teabreak/items`（**端点形状是客户端假设**，见文件头注释） |
| application | `lib/features/teabreak/application/teabreak_providers.dart` | 列表控制器（取回后统一排序）、写操作集合、`teabreakClockProvider`（可注入的"现在"） |
| presentation | `.../presentation/pages/teabreak_list_page.dart` | 排序列表 / 确认还有 / 三态 / 空态说明 |
| presentation | `.../presentation/pages/teabreak_compose_page.dart` | 新建表单（默认时间窗合法，只填名字 + 地点即可发布） |
| presentation | `.../presentation/components/teabreak_card.dart` | 卡片与徽章；时效 / access / 倒计时同时可见 |

路由：`/teabreak`（列表）、`/teabreak/compose`（新建）；
模块入口：`kedaya_module.dart` 的 `businessModules` + `implementedModuleRoutes`。

## 3. 演示数据为什么不会"过几天就全过期"

演示数据不是常量，而是 `buildMockTeabreaks(now)`：

- `fresh` = 茶歇窗 `now-15m … now+15m`，5 分钟前有人确认；
- `stale` = 茶歇窗 `now-2h30m … now+30m`，2 小时前确认；
- `notStarted` = **下一个本地 15:00** 的下午场（茶歇 15:30–16:00）——无论几点打开都成立；
- `over` = 昨天下午的茶歇。

仓库默认用注入的 clock 生成（`MockTeabreakRepository(clock: …)`），
测试里传固定时刻即可对文案做确定性断言。

## 4. 本模块**不做**的事

- 不做会议室实时人数、不做预约/占位（契约开头第 3 条）；
- 不做"信誉分 / 举报"：规则层没有定义，本端不自造；
- mock 运行时之外的写操作依赖后端，`services/api` 尚无 `teabreak` 模块。
