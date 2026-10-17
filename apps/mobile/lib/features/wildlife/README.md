# feature: `wildlife`（野生动物活动区域与轨迹）

契约 §4.1 的 `wildlife`（敏感级：**低**，**无同意门**）。规格文档：
`docs/features/wildlife-map.md`。

需求原话 → 落地：**R1** 区域（`WildlifeZone`）+ **R2** 校园地图为背景（§1 方案 B：
静态底图 + 叠加层）+ **R3** 上传动物图片（服务端代理上传 + 强制剥离 EXIF）+
**R4** 发现时间与地点（`observedAt` 与 `createdAt` 分离）+ **R5** 自动分类
（可离线降级 + 置信度 + 人工纠正）+ **R6** 手动选物种 / 给个体起名 +
**R7** 推断轨迹（**显著标注"非实测路径"**）+ **R8** 管理（投喂规范告示位 / 审核队列）。

---

## 1. 该模块的 ports

| 端口 | 位置 | 说明 |
| --- | --- | --- |
| `WildlifePort` | `lib/domain/ports/wildlife_port.dart` | 观测 / 区域 / 热点 / 轨迹 / 个体 / 图片 / 分类的唯一入口 |
| `MediaPickerPort` | `lib/domain/ports/media_picker_port.dart` | 选照片（相册 / 相机）；mock 运行时是内存实现 |
| `LocationPort` | `lib/domain/ports/location_port.dart` | 定位（**WGS84**）；不可用时降级到地图点选 |

实现（适配器）：

| 实现 | 位置 | 用途 |
| --- | --- | --- |
| `RemoteWildlifeRepository` | `lib/data/repositories/remote_wildlife_repository.dart` | 走 `/api/v1/wildlife/*`；写操作带 `Idempotency-Key`；图片走 multipart |
| `MockWildlifeRepository` | `lib/data/mock/mock_wildlife_repository.dart` | 内存实现，**默认装配**，无后端可跑（还扮演服务端做模糊化 / 敏感区 / 审核过滤） |
| `InMemoryMediaPicker` | `lib/data/mock/mock_media_picker.dart` | 返回一张**真实**的 1×1 PNG（能过魔数校验） |
| `InMemoryLocationPort` | `lib/data/mock/mock_location_port.dart` | 固定校园内坐标；可切成"被拒"以演示降级 |
| `ImagePickerMediaPicker` | `lib/platform/image_picker_media_picker.dart` | 真机相册（新增依赖 `image_picker`） |
| `MethodChannelLocation` | `lib/platform/method_channel_location.dart` | 原生定位 channel `kedaya/location`（**原生侧未实现**，见 §5） |

端口方法 ↔ HTTP（规格 §10.1）：

| 方法 | HTTP | 备注 |
| --- | --- | --- |
| `getBasemap()` | `GET wildlife/basemap` | 含 `affine` / `attribution` / `license`；**客户端也校验** §1.4 的 CI 约束 |
| `listSpecies()` | `GET wildlife/species` | 裸数组或 `{items}` 都接受 |
| `listZones()` / `getZone(id)` | `GET wildlife/zones[/:id]` | 含 `feedingPolicy` / `noticeText` / `isSensitive` |
| `listSpots(query)` | `GET wildlife/spots` | **只读**；`minConfidence` 默认 0.3 |
| `listTracks(query)` / `getTrack(id)` | `GET wildlife/tracks[/:id]` | `isInferred` 恒 true |
| `listIndividuals({species})` | `GET wildlife/individuals` | 只返回已审核的个体 |
| `createIndividual(command)` | `POST wildlife/individuals` | 命名个体（R6），走 PENDING |
| `listSightings(query)` | `GET wildlife/items` | **仅 PUBLISHED** |
| `getSighting(id)` | `GET wildlife/items/:id` | 未公开记录对非上报人按 `NOT_FOUND` |
| `uploadMedia(command)` | `POST wildlife/media` | **multipart 服务端代理上传**；幂等键 = `clientPhotoId` |
| `createSighting(draft)` | `POST wildlife/items` | 带 `Idempotency-Key`；`ethicsAcknowledged` 恒 true |
| `classify(request)` | `POST wildlife/classify` | 无能力时返回**空数组**（不是 5xx） |
| `correctSpecies(id, speciesId)` | `PATCH wildlife/items/:id` | JSON Merge Patch（`application/merge-patch+json`，契约 §11.1） |
| `deleteSighting(id)` | `DELETE wildlife/items/:id` | 撤回自己的上报（软删） |

**没有 `moderate`**：审核是管理员能力，学生端不提供入口。该 action 名已登记在契约
§11.2（`wildlife.moderate`），管理端可直接使用。

---

## 2. 坐标系（本模块最大的坑，规格 §3）

**结论：本端完全不经过 GCJ-02。**

- 规格 §1.2 采用**方案 B：静态校园底图 + 叠加层**，§3.4 用
  「WGS84 → 局部 ENU 米制平面 → 仿射变换 → 图像像素」完成映射。
  底图是**像素空间**，不是 GCJ-02 地图空间，因此 §3.1 那个"偏移 300–700 米"的陷阱
  在本端**不存在**（规格 §3.2 规则 4 的原话："这直接绕开了本模块最大的技术陷阱"）。
- `lib/domain/models/geo.dart` 把这条结论做成**类型层面的事实**：
  - `GeoDatum` **只有 `wgs84` 一个成员** → 想构造一个 GCJ-02 坐标，编译期就没有类型；
  - 本端**不提供** `wgs84ToGcj02` / `gcj02ToWgs84` → 不可能有代码"忘记转换"；
  - 唯一的 GCJ-02 消费点（"在腾讯/高德地图里打开"，规格 §1.2 的逃生口）
    **刻意不提供**：它的前提是 §11.1 T4 的人工控制点数据（未决问题 U4，**至今未采集**），
    在没有可验证对照数据前提供一个未经验证的坐标转换，风险高于收益。
- **`domain` 层禁止 `dart:math`**（冻结契约 §7 硬规则 1 + `tool/selfcheck.py`），
  因此 `geoCosDegrees` / `geoSqrt` 是纯 `dart:core` 实现，精度由单测锁定
  （cos 误差 ~2e-14、sqrt 相对误差 ~1e-16，实现时另用 Python 独立复算过）。

守门测试：
- `test/domain/wildlife_geo_test.dart`：**像素 → 经纬度 → 像素 往返误差 < 1 px**、
  最小二乘标定能还原仿射矩阵、`lat`/`lng` 写反被 `assertInCampus` 拒绝、
  30 m 对应 25–35 px（规格 T7）。
- `test/domain/wildlife_datum_boundary_test.dart`：`GeoDatum` 只有一个成员、
  序列化里没有 `gcj*` 键、payload 里的 `gcjLat`/`exactLat`/`reporterId` 一律被忽略、
  **机械扫描源码里不存在 gcj 标识符**（剥掉注释后）。

---

## 3. 用例清单（application 层）

| 文件 | 内容 |
| --- | --- |
| `application/wildlife_providers.dart` | 物种筛选（地图与列表共用）、地图聚合状态（底图+区域+热点+轨迹+物种，**一个三态**）、观测列表（游标分页 + 翻页失败保留列表）、详情、区域列表/详情、轨迹列表/详情、个体列表、写操作集合（纠正 / 撤回） |
| `application/wildlife_report_controller.dart` | 上报表单状态机：选图 → **先上传**拿 `mediaId` → 发现时间 → 定位或地图点选（自动判定区域）→ 自动分类建议（低置信度**不预选**）→ 手动选物种 → 手动命名个体（同名**复用**）→ 伦理勾选 → 提交（客户端先按 §10.3 校验） |

### 三态

`AsyncStateView` 统一渲染 **loading / error / empty**：地图页、观测列表、区域列表、
轨迹列表都用它。详情页沿用 `groupbuy` / `forum` 的既有形状
（`value.when` + `NOT_FOUND → KedaYaEmptyState`），因为 `AsyncStateView` 没有
"错误码 → 空态"的映射参数（**没有**为它单独改公共组件）。

---

## 4. 页面

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/wildlife` | `WildlifeMapPage` | 静态底图 + 叠加层（区域圈 / 聚合热点 / 推断轨迹）；点地图命中区域弹告示位气泡；图例 + 聚合延迟说明 + 底图署名；下方是各区域告示位卡片 |
| `/wildlife/report` | `WildlifeReportPage` | 上报（见 §3） |
| `/wildlife/sightings` `/:id` | 观测列表 / 详情 | 列表只含已发布；详情含发现时间 vs 上报时间、分类来源、隐私说明、纠正 / 撤回 |
| `/wildlife/zones` `/:id` | 区域列表 / 详情 | 投喂政策徽章、完整告示位、模糊半径、敏感区提示 |
| `/wildlife/tracks` `/:id` | 推断轨迹列表 / 详情 | **顶部固定**"推断轨迹 · 非实测路径"；详情说明"这条线是怎么来的"与"明确不做" |

### 隐私与伦理的落点（不是"记得加"，而是结构上做不到漏）

| 约束 | 落点 |
| --- | --- |
| 地图**不显示**单条观测（规格 §8.1 E10） | `WildlifeMapCanvas` **没有** `sightings` 参数（机械自检确认叠加层里 0 处引用） |
| 敏感区**不公开坐标**（§9.3 ①） | 模型 `WildlifeSighting.geo` 可空；mock 对 `isSensitive` 区域直接返回 `null`，且**不公开**该区域的热点；地图**不画**敏感区的圆圈 |
| 位置模糊化说明（§9） | `WildlifePrivacyNotice`（区分"已模糊化到片区级"与"敏感区不公开坐标"） |
| 热点不是实时位置（E10） | `WildlifeSpot.isRealtime` 恒 false + `WildlifeAggregationNotice` |
| 轨迹必须写"推断"（§6.1 / T18） | `WildlifeTrack.isInferred` 是**恒真的 getter**（不是可解析字段）+ `WildlifeInferredTrackBanner` |
| 伦理提示是**表单校验**不是同意门（§8.2） | `WildlifeEthicsNotice`（5 条 ≤20 字规则 + 勾选 + "不勾选只拒绝这次提交"的说明）；`WildlifeSightingDraft.ethicsAcknowledged` 必填 |
| 匿名（§9.6） | 模型**没有** `reporterId` 字段；匿名时展示名恒为「匿名同学」 |
| 自动分类只是建议（§5.7） | `classifiedBy != manual` 时**必须**显示"识别结果仅供参考，请确认" |
| 疑似受伤不得自行处理（E7） | `WildlifeHealthConcernNotice` + mock 里"审核前就通知社团" |

---

## 5. 已实现 / 未实现（如实）

### ✅ 已实现（无后端可跑，有测试）

- 静态底图 + `CustomPaint` 叠加层（区域 / 聚合热点 / 推断轨迹 / 点选准星），
  1×–4× 缩放（`InteractiveViewer`），**离线可用**（内置示意图，无需网络与资源文件）。
- 观测列表 + 详情、区域列表 + 详情、物种筛选、推断轨迹列表 + 详情。
- 上报全链路：`image_picker` 选图 → 魔数预检 → 服务端代理上传（幂等 + 重试）→
  发现时间选择 → 定位（MethodChannel / mock）或**地图点选** → 自动分类建议 →
  手动选物种 → 手动命名个体 → 伦理确认 → 提交（客户端按 §10.3 预校验）。
- 仿射标定（纯 Dart，可测）：ENU 投影、6 参数最小二乘、RMSE、像素↔经纬度往返。
- 伦理与隐私提示（投喂规范 / 不打扰 / 位置已模糊化 / 敏感区不公开坐标）。
- 三态齐全（复用 `AsyncStateView`）、亮/暗主题同时可用（颜色只来自 `KedaYaTokens`）。

### ❌ 未实现（没有用 TODO 占位函数冒充）

| 项 | 说明 |
| --- | --- |
| 真机 GPS | `MethodChannelLocation` 的**原生侧未实现**（`android/` `ios/` `ohos/` 目录尚未生成）。此时 UI 自动降级到「在地图上点选」——这条路径**完整可用**，不是占位。需要真机 GPS 时按 channel 契约实现原生侧即可，Dart 侧不用改 |
| 审核 / 管理端界面 | `moderate`（契约 §11.2 已登记）没有 UI：学生端不提供审核入口。审核队列、双人复核、敏感区多边形维护都属于管理端 |
| 图片压缩 | 只把 `imageQuality: 85` 交给平台；没有自己实现"任一边 > 2048px 或 > 2 MB 就再压一次"（规格 §4.2 的客户端压缩阈值） |
| EXIF 剥离 | **故意不做**：规格 §4.3 明确剥离必须是**服务端**行为（客户端处理会被绕过，等于没做） |
| 人脸检测 / 模糊 | 规格 §12 U13 的已知缺口，未设计 |
| 物种清单的真实性 | mock 的 7 个物种是**推测**（规格 U2），必须由校园动物社团 / 生物教师确认 |
| 底图授权 | 用的是**内置自绘示意图**（P1，零授权风险）；学校官方平面图（P3）授权状态未知（U1），拿到书面授权前不得入库 |

---

## 6. 对契约 / 规格的偏离与上报（**没有**擅自改 `docs/` 与 `packages/`）

1. **`WildlifeSighting.geo` 在本端是**可空**的。**
   契约 §2.6 把 `geo` 列为必填，但规格 §9.3 ① / T10 要求敏感区**不输出任何坐标**、
   只给 `zoneId`。两者冲突时本端以**隐私要求**为准：`geo` 可空，
   `hasGeo == false` 时 UI 明确显示"该区域是敏感区：只公开所属区域，不公开任何坐标"，
   并且序列化时**不写** `geo` 键。**请 Lead 裁定契约措辞**（建议把 `geo` 标注为
   敏感区可为空）。
2. **新增了 `KedayaApiPort.sendMultipart`**（契约 §11.4 冻结的是"不变式 + 能力集"，
   允许形状适配）。理由：规格 §4.1 要求图片走 **multipart 服务端代理上传**，
   而原来的端口只有 JSON 请求。同时给 `ApiRequest` 加了可选的 `contentType`
   （唯一消费点是契约 §11.1 的 `application/merge-patch+json`）。
   两处都是**纯增量**改动，没有改动既有行为。
3. **`/wildlife` 的列表响应同时接受裸数组与 `{items}`**：`species` / `zones` /
   `individuals` 这类有界字典在实现里常直接返回数组。客户端不该因形状差异整页失败。
4. **`pubspec.yaml` 新增依赖 `image_picker: ^1.1.2`**（任务要求用它选照片）。
   版本区间未在本机验证（没有 Flutter SDK）。
5. **mock 的"模糊化"只是网格吸附**：没有 HMAC 确定性加噪（需要服务端密钥）、
   没有 k-匿名检查、没有敏感区多边形（用区域圆代替）。mock 只保证
   **客户端能观察到的契约**：拿不到精确坐标、敏感区没有坐标、热点延迟 ≥24h。

---

## 7. 需要 `flutter analyze` 复核的点（本机无法验证）

1. `image_picker` 1.1.x 的 `pickMultiImage({imageQuality, limit})` 与 `XFile.readAsBytes()`
   / `XFile.mimeType` 的签名（**新增依赖，未在本机解析过**）。
2. `RadioListTile` 的 `groupValue` / `onChanged`：按 Flutter **3.27** 书写；
   若 SDK ≥3.32 会变成 deprecation 警告（需要改用 `RadioGroup`）。
3. `InteractiveViewer(constrained: false)` + `CustomPaint` 的手势坐标假设：
   点选模式假设"子画布左上角与视口左上角对齐"（恒等变换下成立）。
4. `Image.network` 在测试环境（`flutter_test` 的 mock HTTP 客户端）会走 `errorBuilder`；
   mock 运行时的底图 `imageUrl` 为空，因此**不会**发起网络请求。
5. `AsyncNotifier` / `Notifier` / `AsyncValue.guard` / `ref.invalidate` / `overrideWithValue`
   均按 flutter_riverpod **2.6.x** 书写（与既有三个切片一致）。
6. `FutureProvider.family<List<WildlifeIndividual>, String?>` 用**可空 String** 作 family 参数。
7. 全部测试**没有在本机执行过**（没有 Flutter SDK）。

---

## 8. 本机替代验证（**已实际执行**）

```bash
cd apps/mobile
/opt/homebrew/bin/python3 tool/selfcheck.py --verbose     # 10 项检查，174 个 Dart 文件，0 处违规
```

`tool/selfcheck.py` 的 10 项之外，本次还补跑了两类机械检查（见交付说明）：
GCJ-02 标识符扫描（24 个文件，0 命中）、伦理提示规模（5 条 / 最长 10 字）、
地图叠加层不得引用单条观测（0 命中）、`pubspec.yaml` 依赖字母序。

**它替代不了 `flutter analyze` / `flutter test`**：类型错误、API 版本不匹配、
运行时行为都不在它的覆盖范围内。
