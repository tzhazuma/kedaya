/// `wildlife` 观测记录：模型 / 图片上传 / 自动分类 / 上报草稿校验。
///
/// 规格 `docs/features/wildlife-map.md`：
///   - §2.6 `WildlifeSighting`（契约 §2.10 冻结字段 + 本规格新增字段）
///   - §2.9 `WildlifeMedia` + §4 图片上传链路（客户端参数与限制）
///   - §5 自动分类（可离线降级 / 置信度 / 人工纠正闭环）
///   - §8.2 伦理确认是**表单校验**而不是同意门
///   - §10.3 `POST /items` 的字段校验与 `details.reason`
///
/// 隐私边界（§9.6 / T15）：本端模型**没有** `reporterId` 字段 ——
/// 不是"记得别展示"，而是**根本不存在**。
library;

import 'api_request.dart';
import 'geo.dart';
import 'json_read.dart';
import 'wildlife.dart';

/// 分类来源（规格 §2.6 `classifiedBy`）。
enum ClassifiedBy {
  manual('manual', '手动选择'),
  visionApi('vision_api', '自动识别'),
  ondevice('ondevice', '端侧识别'),
  fallback('fallback', '自动识别不可用'),

  /// 未知取值收敛：**当成"不是手动"**，因此仍然会显示"识别结果仅供参考"。
  unknown('unknown', '未知来源');

  const ClassifiedBy(this.wire, this.label);

  final String wire;
  final String label;

  static ClassifiedBy fromWire(String wire) {
    for (final ClassifiedBy source in ClassifiedBy.values) {
      if (wireEquals(source.wire, wire)) return source;
    }
    return ClassifiedBy.unknown;
  }

  /// 是否来自自动分类（决定是否必须显示"仅供参考，请确认"，规格 §5.7）。
  bool get isAutomatic => this != ClassifiedBy.manual;
}

/// 图片限制（规格 §4.2 的客户端侧镜像）。
const int maxMediaBytes = 5 * 1024 * 1024;

/// 单次上报最多 3 张（契约 `photoUrls` ≤3）。
const int maxMediaPerSighting = 3;

/// 接受的格式（服务端还会做魔数校验，见 [looksLikeImage]）。
const List<String> allowedMediaMimeTypes = <String>[
  'image/jpeg',
  'image/png',
  'image/webp',
];

/// 备注长度上限（规格 §10.3：≤200 字）。
const int maxSightingNoteLength = 200;

/// 个体名长度上限（规格 §2.8：≤24 字）。
const int maxIndividualNameLength = 24;

/// GPS 精度合法区间（规格 §10.3：1–10000 米）。
const int minGeoAccuracyM = 1;
const int maxGeoAccuracyM = 10000;

/// `observedAt` 允许的最大未来偏移（规格 §11.10 A：容忍客户端时钟漂移 5 分钟）。
const Duration observedAtMaxFutureSkew = Duration(minutes: 5);

/// `observedAt` 允许的最大回溯（规格 §11.10 A：防止误填远古时间污染轨迹）。
const Duration observedAtMaxPastWindow = Duration(days: 30);

/// 自动分类的预选阈值（规格 §5.5：< 0.60 不预选）。
const double classifyPreselectMinConfidence = 0.6;

/// 自动分类的"很确定"阈值（规格 §5.5：≥ 0.85）。
const double classifyCertainMinConfidence = 0.85;

/// 服务端 `details.reason` 的规范取值（规格 §10.3）。**禁止**各端自造字符串。
const String reasonUnknownSpecies = 'UNKNOWN_SPECIES';
const String reasonObservedAtOutOfRange = 'OBSERVED_AT_OUT_OF_RANGE';
const String reasonCoordinateOutOfCampus = 'COORDINATE_OUT_OF_CAMPUS';
const String reasonInvalidAccuracy = 'INVALID_ACCURACY';
const String reasonMediaAlreadyLinked = 'MEDIA_ALREADY_LINKED';
const String reasonContentRejected = 'CONTENT_REJECTED';
const String reasonEthicsNotAcknowledged = 'ETHICS_NOT_ACKNOWLEDGED';
const String reasonInvalidClassifierSource = 'INVALID_CLASSIFIER_SOURCE';
const String reasonMediaTooLarge = 'MEDIA_TOO_LARGE';
const String reasonMediaUnsupportedType = 'MEDIA_UNSUPPORTED_TYPE';
const String reasonIdempotencyKeyRequired = 'IDEMPOTENCY_KEY_REQUIRED';
const String reasonIndividualNameInvalid = 'INDIVIDUAL_NAME_INVALID';

/// 一条字段级校验失败（规格 §10.3 的 `details.reason` + 中文文案）。
final class WildlifeValidationIssue {
  const WildlifeValidationIssue(this.reason, this.message);

  final String reason;
  final String message;

  @override
  String toString() => '$reason: $message';
}

/// 校验结果集合。
final class WildlifeValidationResult {
  const WildlifeValidationResult(this.issues);

  static const WildlifeValidationResult valid = WildlifeValidationResult(
    <WildlifeValidationIssue>[],
  );

  final List<WildlifeValidationIssue> issues;

  bool get isValid => issues.isEmpty;

  bool get isInvalid => issues.isNotEmpty;

  String? get firstReason => issues.isEmpty ? null : issues.first.reason;

  String? get firstMessage => issues.isEmpty ? null : issues.first.message;

  List<String> get reasons => issues
      .map((WildlifeValidationIssue issue) => issue.reason)
      .toList(growable: false);

  bool has(String reason) =>
      issues.any((WildlifeValidationIssue issue) => issue.reason == reason);

  @override
  String toString() => isValid ? 'valid' : 'invalid(${reasons.join(', ')})';
}

/// 文件头魔数嗅探（规格 §4.2：**不信任** `Content-Type` / 扩展名）。
///
/// 客户端做这件事不是为了替代服务端校验（§4.3 明确服务端必须自己校验），
/// 而是**不要发起一次注定 422 的上传**。
bool looksLikeImage(List<int> bytes) => sniffMimeType(bytes) != null;

/// 按文件头返回真实 MIME；不认识返回 null。
String? sniffMimeType(List<int> bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF) {
    return 'image/jpeg';
  }
  if (bytes[0] == 0x89 &&
      bytes[1] == 0x50 &&
      bytes[2] == 0x4E &&
      bytes[3] == 0x47 &&
      bytes[4] == 0x0D &&
      bytes[5] == 0x0A &&
      bytes[6] == 0x1A &&
      bytes[7] == 0x0A) {
    return 'image/png';
  }
  if (bytes[0] == 0x52 &&
      bytes[1] == 0x49 &&
      bytes[2] == 0x46 &&
      bytes[3] == 0x46 &&
      bytes[8] == 0x57 &&
      bytes[9] == 0x45 &&
      bytes[10] == 0x42 &&
      bytes[11] == 0x50) {
    return 'image/webp';
  }
  return null;
}

/// 上传图片的命令（`POST /api/v1/wildlife/media`，规格 §4.1）。
///
/// 图片走**服务端代理上传**（不是对象存储直传），因为 EXIF 剥离是隐私要求，
/// **不能是"客户端承诺"**（规格 §4.1 的取舍表）。因此客户端只负责：
/// 压缩、魔数预检、生成幂等键 [clientPhotoId]。
final class UploadWildlifeMediaCommand {
  const UploadWildlifeMediaCommand({
    required this.bytes,
    required this.clientPhotoId,
    this.fileName,
    this.mimeType,
    this.widthPx,
    this.heightPx,
  });

  /// 图片字节（`domain` 层只允许 `dart:core`，因此用 `List<int>` 而不是 `Uint8List`）。
  final List<int> bytes;

  /// 客户端生成的幂等键（UUID v4 语义）：**重试必须复用**（规格 §4.5）。
  final String clientPhotoId;

  final String? fileName;

  /// 客户端声明的 MIME；服务端仍会做魔数校验。
  final String? mimeType;

  final int? widthPx;
  final int? heightPx;

  int get byteSize => bytes.length;

  /// 服务端会用的真实类型（客户端自己嗅探，避免上传一次注定失败的请求）。
  String? get sniffedMimeType => sniffMimeType(bytes);

  WildlifeValidationResult validate() {
    final List<WildlifeValidationIssue> issues = <WildlifeValidationIssue>[];
    if (bytes.isEmpty) {
      issues.add(
        const WildlifeValidationIssue(
            reasonMediaUnsupportedType, '图片内容为空，请重新选择'),
      );
    } else if (byteSize > maxMediaBytes) {
      issues.add(
        WildlifeValidationIssue(
          reasonMediaTooLarge,
          '图片超过 ${maxMediaBytes ~/ (1024 * 1024)} MB，请压缩后重试',
        ),
      );
    } else if (sniffedMimeType == null) {
      issues.add(
        const WildlifeValidationIssue(
          reasonMediaUnsupportedType,
          '这个文件不是图片（仅支持 JPEG / PNG / WebP）',
        ),
      );
    } else if (mimeType != null &&
        mimeType!.isNotEmpty &&
        !allowedMediaMimeTypes.contains(mimeType)) {
      issues.add(
        WildlifeValidationIssue(
          reasonMediaUnsupportedType,
          '不支持的图片格式：$mimeType',
        ),
      );
    }
    if (clientPhotoId.trim().isEmpty) {
      issues.add(
        const WildlifeValidationIssue(reasonIdempotencyKeyRequired, '缺少图片幂等键'),
      );
    }
    return WildlifeValidationResult(issues);
  }

  @override
  String toString() =>
      'UploadWildlifeMediaCommand($clientPhotoId, $byteSize bytes)';
}

/// 上传结果（规格 §4.1 响应：`{ mediaId, thumbUrl, widthPx, heightPx, sha256 }`）。
final class WildlifeMedia {
  const WildlifeMedia({
    required this.mediaId,
    this.thumbUrl,
    this.url,
    this.widthPx,
    this.heightPx,
    this.byteSize,
    this.mimeType,
    this.sha256,
    this.clientPhotoId,
  });

  factory WildlifeMedia.fromJson(Map<String, Object?> json) => WildlifeMedia(
        mediaId: readStringOr(json, 'mediaId', readStringOr(json, 'id', '')),
        thumbUrl: readStringOrNull(json, 'thumbUrl'),
        url: readStringOrNull(json, 'url'),
        widthPx: readIntOrNull(json, 'widthPx'),
        heightPx: readIntOrNull(json, 'heightPx'),
        byteSize: readIntOrNull(json, 'byteSize'),
        mimeType: readStringOrNull(json, 'mimeType'),
        sha256: readStringOrNull(json, 'sha256'),
        clientPhotoId: readStringOrNull(json, 'clientPhotoId'),
      );

  final String mediaId;
  final String? thumbUrl;
  final String? url;
  final int? widthPx;
  final int? heightPx;
  final int? byteSize;
  final String? mimeType;

  /// 内容哈希，服务端用于去重（规格 §2.9）。
  final String? sha256;

  /// 客户端幂等键回显；服务端按 `(sightingId, clientPhotoId)` 唯一。
  final String? clientPhotoId;

  Map<String, Object?> toJson() => <String, Object?>{
        'mediaId': mediaId,
        'thumbUrl': thumbUrl,
        'url': url,
        'widthPx': widthPx,
        'heightPx': heightPx,
        'byteSize': byteSize,
        'mimeType': mimeType,
        'sha256': sha256,
        'clientPhotoId': clientPhotoId,
      };

  @override
  bool operator ==(Object other) =>
      other is WildlifeMedia && other.mediaId == mediaId;

  @override
  int get hashCode => mediaId.hashCode;

  @override
  String toString() => 'WildlifeMedia($mediaId)';
}

/// 一条公开的观测记录（规格 §2.6）。
///
/// **两个必须讲清的点**：
///   1. [geo] 是**模糊化后**的公开坐标（服务端算好才下发）；本端从不持有精确坐标。
///   2. [geo] 可以是 `null`：规格 §9.3 ① 规定敏感区**不输出任何坐标**，只给
///      `zoneId`。契约 §2.6 把 `geo` 写成必填，两者冲突时以**隐私要求**为准
///      （本端把 `geo` 建模为可空，并在 UI 上明确说明"该区域不公开坐标"）。
///      这处偏离已上报 Lead（见 `lib/features/wildlife/README.md`）。
final class WildlifeSighting {
  const WildlifeSighting({
    required this.id,
    required this.speciesId,
    required this.status,
    required this.observedAt,
    required this.createdAt,
    this.geo,
    this.observedAtFuzzed,
    this.speciesNameZh,
    this.zoneId,
    this.zoneName,
    this.photoUrls = const <String>[],
    this.healthConcern = false,
    this.isAnonymous = false,
    this.individualId,
    this.individualName,
    this.autoSpeciesId,
    this.autoConfidence,
    this.classifiedBy = ClassifiedBy.manual,
    this.correctedFromSpeciesId,
    this.note,
    this.reporterDisplayName,
  });

  factory WildlifeSighting.fromJson(Map<String, Object?> json) {
    final Map<String, Object?>? geo = readMapOrNull(json, 'geo');
    return WildlifeSighting(
      id: readString(json, 'id'),
      speciesId: readStringOr(json, 'species', ''),
      status: WildlifeModerationStatus.fromWire(
          readStringOr(json, 'status', 'PENDING')),
      observedAt: readDateTime(json, 'observedAt'),
      createdAt: readDateTimeOrNull(json, 'createdAt') ??
          readDateTime(json, 'observedAt'),
      geo: geo == null ? null : Wgs84Point.fromJson(geo),
      observedAtFuzzed: readDateTimeOrNull(json, 'observedAtFuzzed'),
      speciesNameZh: readStringOrNull(json, 'speciesNameZh'),
      zoneId: readStringOrNull(json, 'zoneId'),
      zoneName: readStringOrNull(json, 'zoneName'),
      photoUrls: readStringList(json, 'photoUrls'),
      healthConcern: readBoolOr(json, 'healthConcern', false),
      isAnonymous: readBoolOr(json, 'isAnonymous', false),
      individualId: readStringOrNull(json, 'individualId'),
      individualName: readStringOrNull(json, 'individualName'),
      autoSpeciesId: readStringOrNull(json, 'autoSpeciesId'),
      autoConfidence: readDoubleOrNull(json, 'autoConfidence'),
      classifiedBy:
          ClassifiedBy.fromWire(readStringOr(json, 'classifiedBy', 'manual')),
      correctedFromSpeciesId: readStringOrNull(json, 'correctedFromSpeciesId'),
      note: readStringOrNull(json, 'note'),
      reporterDisplayName: readStringOrNull(json, 'reporterDisplayName'),
    );
  }

  final String id;

  /// 冻结字段名是 `species`，语义是 `WildlifeSpecies.id`（规格 §2.6）。
  final String speciesId;

  final String? speciesNameZh;
  final WildlifeModerationStatus status;

  /// 公开坐标（**已模糊化**）；敏感区为 `null`。
  final Wgs84Point? geo;

  /// **发现时间**（用户选的），与 [createdAt]（上报时间）分离 —— 需求 R4。
  final DateTime observedAt;

  /// 公开的粗化时间（规格 §9.5：普通区到小时、敏感区到天）。
  final DateTime? observedAtFuzzed;

  /// 上报时间（服务端入库时刻）。只用于审计与排序兜底（契约 §11.10 A）。
  final DateTime createdAt;

  final String? zoneId;
  final String? zoneName;
  final List<String> photoUrls;

  /// 疑似受伤/异常（触发通知社团，且审核优先级提升到队首）。
  final bool healthConcern;

  /// 匿名上报：此时 [reporterDisplayName] 为 null，UI 显示「匿名同学」。
  final bool isAnonymous;

  final String? individualId;
  final String? individualName;

  /// 自动分类结果（**只是建议**，公开的物种是用户确认后的 [speciesId]）。
  final String? autoSpeciesId;
  final double? autoConfidence;
  final ClassifiedBy classifiedBy;

  /// 用户纠正了自动结果 → 训练样本（规格 §5.5 的闭环）。
  final String? correctedFromSpeciesId;

  final String? note;

  /// 后端下发的展示名；**没有** `reporterId` 字段（规格 §9.6 / T15）。
  final String? reporterDisplayName;

  bool get hasGeo => geo != null;

  bool get isPublished => status.isPublic;

  bool get isAutoClassified => classifiedBy.isAutomatic;

  bool get wasCorrected => correctedFromSpeciesId != null;

  /// 位置说明：**不得**声称"完全匿名"，只能说模糊到片区级（规格 §9.3）。
  String get locationLabel =>
      hasGeo ? wildlifeLocationFuzzedNotice : '敏感区：只公开所属区域，不公开坐标';

  /// 上报人展示文案：匿名一律「匿名同学」，**绝不**回退到任何实名标识。
  String get reporterLabel {
    if (isAnonymous) return '匿名同学';
    final String? name = reporterDisplayName?.trim();
    return (name == null || name.isEmpty) ? '同学' : name;
  }

  /// 自动分类的免责说明（规格 §5.7：`classifiedBy != manual` 时**必须**显示）。
  String get classificationNotice =>
      isAutoClassified ? '识别结果仅供参考，请确认（$classifiedByLabel）' : '';

  String get classifiedByLabel => classifiedBy.label;

  /// 发现时间与上报时间相差多久（用于详情页说明"补录"）。
  Duration get reportingDelay => createdAt.difference(observedAt);

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'species': speciesId,
        'speciesNameZh': speciesNameZh,
        'status': status.wire,
        // geo 为 null 时**不写该键**：宁可缺字段，也不要让下游把 null 当坐标。
        if (geo != null) 'geo': geo!.toJson(),
        'observedAt': isoUtc(observedAt),
        'observedAtFuzzed':
            observedAtFuzzed == null ? null : isoUtc(observedAtFuzzed!),
        'createdAt': isoUtc(createdAt),
        'zoneId': zoneId,
        'zoneName': zoneName,
        'photoUrls': photoUrls,
        'healthConcern': healthConcern,
        'isAnonymous': isAnonymous,
        'individualId': individualId,
        'individualName': individualName,
        'autoSpeciesId': autoSpeciesId,
        'autoConfidence': autoConfidence,
        'classifiedBy': classifiedBy.wire,
        'correctedFromSpeciesId': correctedFromSpeciesId,
        'note': note,
        'reporterDisplayName': reporterDisplayName,
      };

  @override
  bool operator ==(Object other) => other is WildlifeSighting && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() =>
      'WildlifeSighting($id, ${speciesNameZh ?? speciesId}, ${status.wire}, '
      'geo=${geo == null ? 'none' : 'fuzzed'})';

  /// 只改字段、不改语义。注意 [geo] 与 [correctedFromSpeciesId] 这类可空字段
  /// **不能用 `??` 清空**：需要清空时请显式构造新对象（本端只有 mock 会用到）。
  WildlifeSighting copyWith({
    String? id,
    String? speciesId,
    String? speciesNameZh,
    WildlifeModerationStatus? status,
    Wgs84Point? geo,
    DateTime? observedAt,
    DateTime? observedAtFuzzed,
    DateTime? createdAt,
    String? zoneId,
    String? zoneName,
    List<String>? photoUrls,
    bool? healthConcern,
    bool? isAnonymous,
    String? individualId,
    String? individualName,
    String? autoSpeciesId,
    double? autoConfidence,
    ClassifiedBy? classifiedBy,
    String? correctedFromSpeciesId,
    String? note,
    String? reporterDisplayName,
  }) =>
      WildlifeSighting(
        id: id ?? this.id,
        speciesId: speciesId ?? this.speciesId,
        speciesNameZh: speciesNameZh ?? this.speciesNameZh,
        status: status ?? this.status,
        geo: geo ?? this.geo,
        observedAt: observedAt ?? this.observedAt,
        observedAtFuzzed: observedAtFuzzed ?? this.observedAtFuzzed,
        createdAt: createdAt ?? this.createdAt,
        zoneId: zoneId ?? this.zoneId,
        zoneName: zoneName ?? this.zoneName,
        photoUrls: photoUrls ?? this.photoUrls,
        healthConcern: healthConcern ?? this.healthConcern,
        isAnonymous: isAnonymous ?? this.isAnonymous,
        individualId: individualId ?? this.individualId,
        individualName: individualName ?? this.individualName,
        autoSpeciesId: autoSpeciesId ?? this.autoSpeciesId,
        autoConfidence: autoConfidence ?? this.autoConfidence,
        classifiedBy: classifiedBy ?? this.classifiedBy,
        correctedFromSpeciesId:
            correctedFromSpeciesId ?? this.correctedFromSpeciesId,
        note: note ?? this.note,
        reporterDisplayName: reporterDisplayName ?? this.reporterDisplayName,
      );
}

/// 观测列表查询（规格 §10.1 #9：游标分页，**仅 PUBLISHED**）。
final class WildlifeSightingQuery {
  const WildlifeSightingQuery({
    this.speciesId,
    this.zoneId,
    this.healthConcernOnly = false,
    this.cursor,
    this.limit = defaultPageSize,
  });

  final String? speciesId;
  final String? zoneId;

  /// 只看疑似受伤（用于社团/关注者视角）。
  final bool healthConcernOnly;

  final String? cursor;
  final int limit;

  Map<String, Object?> toQuery() => <String, Object?>{
        ...PageQuery(cursor: cursor, limit: limit).toQuery(),
        if (speciesId != null && speciesId!.isNotEmpty) 'species': speciesId,
        if (zoneId != null && zoneId!.isNotEmpty) 'zoneId': zoneId,
        if (healthConcernOnly) 'healthConcern': true,
      };

  WildlifeSightingQuery copyWith({
    String? speciesId,
    String? zoneId,
    bool? healthConcernOnly,
    String? cursor,
    int? limit,
  }) =>
      WildlifeSightingQuery(
        speciesId: speciesId ?? this.speciesId,
        zoneId: zoneId ?? this.zoneId,
        healthConcernOnly: healthConcernOnly ?? this.healthConcernOnly,
        cursor: cursor ?? this.cursor,
        limit: limit ?? this.limit,
      );
}

/// 上报草稿（`POST /api/v1/wildlife/items` 的请求体，规格 §10.3）。
///
/// 它是**纯数据 + 纯校验**：没有任何 IO，因此「什么时候该拒绝提交」可以被单测锁住，
/// 而不是散落在表单 widget 的 `if` 里。
final class WildlifeSightingDraft {
  const WildlifeSightingDraft({
    required this.speciesId,
    required this.observedAt,
    required this.geo,
    this.geoAccuracyM,
    this.zoneId,
    this.mediaIds = const <String>[],
    this.healthConcern = false,
    this.individualId,
    this.note,
    this.isAnonymous = false,
    this.autoSpeciesId,
    this.autoConfidence,
    this.classifiedBy = ClassifiedBy.manual,
    this.ethicsAcknowledged = false,
  });

  /// 用户**确认后**的物种（自动分类只是建议）。
  final String speciesId;

  final DateTime observedAt;

  /// 用户采集的**精确**坐标（WGS84）。服务端负责模糊化后才公开。
  final Wgs84Point geo;

  final int? geoAccuracyM;
  final String? zoneId;
  final List<String> mediaIds;
  final bool healthConcern;
  final String? individualId;
  final String? note;
  final bool isAnonymous;
  final String? autoSpeciesId;
  final double? autoConfidence;
  final ClassifiedBy classifiedBy;

  /// 伦理确认（规格 §8.2：**表单校验**，不是同意门）。
  final bool ethicsAcknowledged;

  int get noteLength => (note ?? '').trim().length;

  /// 规格 §10.3 的字段校验。
  ///
  /// [now] 由调用方注入（**不用 `DateTime.now()`**）：这样"发现时间是否越界"
  /// 这条规则可以被确定性地单测。
  WildlifeValidationResult validate({
    required DateTime now,
    required Set<String> knownSpeciesIds,
    CampusBounds bounds = CampusBounds.campus,
  }) {
    final List<WildlifeValidationIssue> issues = <WildlifeValidationIssue>[];

    if (speciesId.trim().isEmpty || !knownSpeciesIds.contains(speciesId)) {
      issues.add(
        const WildlifeValidationIssue(reasonUnknownSpecies, '请选择一个有效的物种'),
      );
    }
    if (autoSpeciesId != null &&
        autoSpeciesId!.isNotEmpty &&
        !knownSpeciesIds.contains(autoSpeciesId)) {
      issues.add(
        const WildlifeValidationIssue(reasonUnknownSpecies, '自动分类结果对应的物种不存在'),
      );
    }
    if (classifiedBy == ClassifiedBy.unknown) {
      issues.add(
        const WildlifeValidationIssue(reasonInvalidClassifierSource, '分类来源不合法'),
      );
    }
    if (observedAt.isAfter(now.add(observedAtMaxFutureSkew))) {
      issues.add(
        const WildlifeValidationIssue(
          reasonObservedAtOutOfRange,
          '发现时间不能晚于当前时间（允许 5 分钟时钟漂移）',
        ),
      );
    }
    if (observedAt.isBefore(now.subtract(observedAtMaxPastWindow))) {
      issues.add(
        const WildlifeValidationIssue(
          reasonObservedAtOutOfRange,
          '发现时间不能早于 30 天前',
        ),
      );
    }
    if (!bounds.contains(geo)) {
      issues.add(
        const WildlifeValidationIssue(
          reasonCoordinateOutOfCampus,
          '位置不在校园范围内（请重新定位或在地图上点选）',
        ),
      );
    }
    if (geoAccuracyM != null &&
        (geoAccuracyM! < minGeoAccuracyM || geoAccuracyM! > maxGeoAccuracyM)) {
      issues.add(
        const WildlifeValidationIssue(reasonInvalidAccuracy, '定位精度数值不合法'),
      );
    }
    if (mediaIds.length > maxMediaPerSighting) {
      issues.add(
        WildlifeValidationIssue(
          reasonMediaAlreadyLinked,
          '一次最多上传 $maxMediaPerSighting 张照片',
        ),
      );
    }
    if (noteLength > maxSightingNoteLength) {
      issues.add(
        WildlifeValidationIssue(
          reasonContentRejected,
          '备注不能超过 $maxSightingNoteLength 字',
        ),
      );
    }
    if (!ethicsAcknowledged) {
      issues.add(
        const WildlifeValidationIssue(
          reasonEthicsNotAcknowledged,
          '请先阅读并勾选「$wildlifeEthicsAckLabel」',
        ),
      );
    }
    return WildlifeValidationResult(issues);
  }

  /// 请求体（字段名与规格 §10.3 的示例一致）。
  ///
  /// `ethicsAcknowledged` **恒为 true**：草稿本身不合法时 `toJson()` 不该被调用
  /// （调用方必须先过 [validate]），这里不提供"悄悄不带确认"的写法。
  Map<String, Object?> toJson() => <String, Object?>{
        'species': speciesId,
        'observedAt': isoUtc(observedAt),
        'geo': geo.toJson(),
        if (geoAccuracyM != null) 'geoAccuracyM': geoAccuracyM,
        'zoneId': zoneId,
        'mediaIds': mediaIds,
        'healthConcern': healthConcern,
        'individualId': individualId,
        'note': note,
        'isAnonymous': isAnonymous,
        'autoSpeciesId': autoSpeciesId,
        'autoConfidence': autoConfidence,
        'classifiedBy': classifiedBy.wire,
        'ethicsAcknowledged': true,
      };

  WildlifeSightingDraft copyWith({
    String? speciesId,
    DateTime? observedAt,
    Wgs84Point? geo,
    int? geoAccuracyM,
    String? zoneId,
    List<String>? mediaIds,
    bool? healthConcern,
    String? individualId,
    String? note,
    bool? isAnonymous,
    String? autoSpeciesId,
    double? autoConfidence,
    ClassifiedBy? classifiedBy,
    bool? ethicsAcknowledged,
  }) =>
      WildlifeSightingDraft(
        speciesId: speciesId ?? this.speciesId,
        observedAt: observedAt ?? this.observedAt,
        geo: geo ?? this.geo,
        geoAccuracyM: geoAccuracyM ?? this.geoAccuracyM,
        zoneId: zoneId ?? this.zoneId,
        mediaIds: mediaIds ?? this.mediaIds,
        healthConcern: healthConcern ?? this.healthConcern,
        individualId: individualId ?? this.individualId,
        note: note ?? this.note,
        isAnonymous: isAnonymous ?? this.isAnonymous,
        autoSpeciesId: autoSpeciesId ?? this.autoSpeciesId,
        autoConfidence: autoConfidence ?? this.autoConfidence,
        classifiedBy: classifiedBy ?? this.classifiedBy,
        ethicsAcknowledged: ethicsAcknowledged ?? this.ethicsAcknowledged,
      );

  @override
  String toString() =>
      'WildlifeSightingDraft($speciesId, observedAt=$observedAt, media=${mediaIds.length})';
}

/// 分类建议请求（`POST /api/v1/wildlife/classify`，规格 §10.1 #17）。
///
/// 无能力时服务端返回**空数组**（不是 5xx）—— 客户端据此降级到手动选择，
/// 并把 `classifiedBy` 记为 `fallback`（规格 §5.2 的流程图）。
final class WildlifeClassifyRequest {
  const WildlifeClassifyRequest({required this.mediaId, this.topK = 3});

  final String mediaId;
  final int topK;

  Map<String, Object?> toJson() => <String, Object?>{
        'mediaId': mediaId,
        'topK': topK,
      };
}

/// 一条分类建议（规格 §5.3）。
final class WildlifeClassifySuggestion {
  const WildlifeClassifySuggestion({
    required this.speciesId,
    required this.confidence,
    this.speciesNameZh,
    this.serverPreselected,
  });

  factory WildlifeClassifySuggestion.fromJson(Map<String, Object?> json) =>
      WildlifeClassifySuggestion(
        speciesId:
            readStringOr(json, 'speciesId', readStringOr(json, 'id', '')),
        confidence: readDoubleOr(json, 'confidence', 0),
        speciesNameZh: readStringOrNull(json, 'speciesNameZh'),
        serverPreselected: readBoolOrNull(json, 'preselected'),
      );

  final String speciesId;

  /// 0..1。
  final double confidence;

  final String? speciesNameZh;

  /// 服务端给的预选标记（可空）。
  final bool? serverPreselected;

  /// 是否预选。
  ///
  /// **两个条件都要满足**：置信度 ≥ [classifyPreselectMinConfidence]
  /// **且**服务端没有明确说"不预选"。
  /// 也就是说，即使服务端出错（低置信度却给了 `preselected: true`），
  /// 客户端也不会替用户做决定（规格 §11.6 T44）。
  bool get shouldPreselect =>
      confidence >= classifyPreselectMinConfidence &&
      (serverPreselected ?? true);

  /// 规格 §5.5 的三档文案。
  String get confidenceLabel {
    if (confidence >= classifyCertainMinConfidence) return '很确定';
    if (confidence >= classifyPreselectMinConfidence) return '可能是';
    return '无法确定';
  }

  String get notice {
    final String name = speciesNameZh ?? speciesId;
    if (confidence >= classifyCertainMinConfidence) return '识别为 $name（很确定）';
    if (confidence >= classifyPreselectMinConfidence) return '可能是 $name（请确认）';
    return '无法确定，可能是 $name';
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'speciesId': speciesId,
        'speciesNameZh': speciesNameZh,
        'confidence': confidence,
        if (serverPreselected != null) 'preselected': serverPreselected,
      };

  @override
  String toString() =>
      'WildlifeClassifySuggestion($speciesId, ${confidence.toStringAsFixed(2)})';
}

/// 分类结果集合（规格 §11.6 T43：无能力时是**空数组**，不是错误）。
final class WildlifeClassifyResult {
  const WildlifeClassifyResult({
    this.items = const <WildlifeClassifySuggestion>[],
    this.available = false,
  });

  /// 无能力 / 未配置分类器时的标准结果。
  static const WildlifeClassifyResult unavailable = WildlifeClassifyResult();

  factory WildlifeClassifyResult.fromJson(Map<String, Object?> json) {
    final List<Object?> raw = readListOrEmpty(json, 'items').isNotEmpty
        ? readListOrEmpty(json, 'items')
        : readListOrEmpty(json, 'suggestions');
    final List<WildlifeClassifySuggestion> items = <WildlifeClassifySuggestion>[
      for (final Object? item in raw)
        if (item is Map<String, Object?>)
          WildlifeClassifySuggestion.fromJson(item),
    ];
    return WildlifeClassifyResult(
      items: items,
      available: readBoolOr(json, 'available', items.isNotEmpty),
    );
  }

  final List<WildlifeClassifySuggestion> items;

  /// 服务端是否具备分类能力。
  final bool available;

  bool get isEmpty => items.isEmpty;

  /// 按置信度降序（服务端应已排序，客户端再排一次保证 UI 稳定）。
  List<WildlifeClassifySuggestion> get sortedByConfidence {
    final List<WildlifeClassifySuggestion> sorted =
        <WildlifeClassifySuggestion>[...items];
    sorted.sort(
      (WildlifeClassifySuggestion a, WildlifeClassifySuggestion b) =>
          b.confidence.compareTo(a.confidence),
    );
    return sorted;
  }

  WildlifeClassifySuggestion? get top {
    final List<WildlifeClassifySuggestion> sorted = sortedByConfidence;
    return sorted.isEmpty ? null : sorted.first;
  }

  /// 需要预选时返回该建议，否则 null（低置信度**必须**由用户自己选）。
  WildlifeClassifySuggestion? get preselection {
    final WildlifeClassifySuggestion? best = top;
    if (best == null || !best.shouldPreselect) return null;
    return best;
  }

  /// 降级说明（规格 §5.2：无能力时静默降级到手动）。
  String get fallbackNotice => available ? '' : '自动识别暂不可用，请手动选择物种（不影响上报）';

  Map<String, Object?> toJson() => <String, Object?>{
        'available': available,
        'items': items
            .map((WildlifeClassifySuggestion item) => item.toJson())
            .toList(growable: false),
      };

  @override
  String toString() =>
      'WildlifeClassifyResult(available=$available, n=${items.length})';
}

/// 创建命名个体（`POST /api/v1/wildlife/individuals`，规格 §2.8 / R6）。
final class CreateWildlifeIndividualCommand {
  const CreateWildlifeIndividualCommand({
    required this.name,
    required this.speciesId,
    this.description,
    this.coverPhotoUrl,
  });

  final String name;
  final String speciesId;
  final String? description;
  final String? coverPhotoUrl;

  WildlifeValidationResult validate() {
    final List<WildlifeValidationIssue> issues = <WildlifeValidationIssue>[];
    final String trimmed = name.trim();
    if (trimmed.isEmpty) {
      issues.add(
        const WildlifeValidationIssue(
            reasonIndividualNameInvalid, '请给这只动物起个名字'),
      );
    } else if (trimmed.length > maxIndividualNameLength) {
      issues.add(
        WildlifeValidationIssue(
          reasonIndividualNameInvalid,
          '名字不能超过 $maxIndividualNameLength 字',
        ),
      );
    }
    if (speciesId.trim().isEmpty) {
      issues.add(
        const WildlifeValidationIssue(reasonUnknownSpecies, '请先选择物种'),
      );
    }
    return WildlifeValidationResult(issues);
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'name': name.trim(),
        'speciesId': speciesId,
        'description': description,
        'coverPhotoUrl': coverPhotoUrl,
      };
}
