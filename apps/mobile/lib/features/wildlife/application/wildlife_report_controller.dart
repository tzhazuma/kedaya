import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/app_providers.dart';
import '../../../domain/models/api_error.dart';
import '../../../domain/models/geo.dart';
import '../../../domain/models/result.dart';
import '../../../domain/models/wildlife.dart';
import '../../../domain/models/wildlife_sighting.dart';
import '../../../domain/ports/location_port.dart';
import '../../../domain/ports/media_picker_port.dart';
import '../../../domain/ports/wildlife_port.dart';
import 'wildlife_providers.dart';

T _require<T>(Result<T> result) => switch (result) {
      Ok<T>(:final T value) => value,
      Err<T>(:final ApiError error, :final String? traceId) =>
        throw ApiException(error, traceId: traceId),
    };

/// 位置来源（决定 UI 文案："来自定位" / "在地图上点选"）。
enum WildlifeLocationSource {
  none('未设置'),
  gps('来自设备定位'),
  map('在地图上点选');

  const WildlifeLocationSource(this.label);

  final String label;
}

/// 一张草稿照片的上传状态。
enum WildlifePhotoStatus { uploading, uploaded, failed }

/// 草稿照片。
final class WildlifeDraftPhoto {
  const WildlifeDraftPhoto({
    required this.clientPhotoId,
    required this.bytes,
    this.fileName,
    this.mimeType,
    this.status = WildlifePhotoStatus.uploading,
    this.mediaId,
    this.error,
    this.attempts = 0,
  });

  /// 客户端幂等键：**重试必须复用**（规格 §4.5），否则服务端会存两份。
  final String clientPhotoId;

  final List<int> bytes;
  final String? fileName;
  final String? mimeType;
  final WildlifePhotoStatus status;

  /// 上传成功后的服务端 id；提交上报时用它。
  final String? mediaId;

  /// 失败原因（面向用户的中文）。
  final String? error;

  final int attempts;

  bool get isUploaded =>
      status == WildlifePhotoStatus.uploaded && mediaId != null;

  bool get isUploading => status == WildlifePhotoStatus.uploading;

  bool get hasFailed => status == WildlifePhotoStatus.failed;

  int get byteSize => bytes.length;

  WildlifeDraftPhoto copyWith({
    WildlifePhotoStatus? status,
    String? mediaId,
    String? error,
    int? attempts,
    bool clearError = false,
  }) =>
      WildlifeDraftPhoto(
        clientPhotoId: clientPhotoId,
        bytes: bytes,
        fileName: fileName,
        mimeType: mimeType,
        status: status ?? this.status,
        mediaId: mediaId ?? this.mediaId,
        error: clearError ? null : (error ?? this.error),
        attempts: attempts ?? this.attempts,
      );

  @override
  String toString() =>
      'WildlifeDraftPhoto($clientPhotoId, ${status.name}, $mediaId)';
}

/// 上报表单的完整状态（纯数据，可被单测直接构造）。
final class WildlifeReportState {
  const WildlifeReportState({
    this.photos = const <WildlifeDraftPhoto>[],
    this.speciesId,
    this.observedAt,
    this.geo,
    this.geoAccuracyM,
    this.locationSource = WildlifeLocationSource.none,
    this.zoneId,
    this.note = '',
    this.isAnonymous = false,
    this.ethicsAcknowledged = false,
    this.healthConcern = false,
    this.individualName = '',
    this.selectedIndividualId,
    this.classify,
    this.autoSpeciesId,
    this.autoConfidence,
    this.classifiedBy = ClassifiedBy.manual,
    this.isClassifying = false,
    this.isSubmitting = false,
    this.formNotice,
    this.submitError,
    this.submitted,
  });

  final List<WildlifeDraftPhoto> photos;
  final String? speciesId;
  final DateTime? observedAt;
  final Wgs84Point? geo;
  final int? geoAccuracyM;
  final WildlifeLocationSource locationSource;

  /// 由坐标自动判定（规格 §8.3：落在 `forbidden` 区域要出红色警告条）。
  final String? zoneId;

  final String note;
  final bool isAnonymous;
  final bool ethicsAcknowledged;
  final bool healthConcern;

  /// 手动命名（R6）：非空时提交前会先创建 / 复用该个体。
  final String individualName;

  final String? selectedIndividualId;

  final WildlifeClassifyResult? classify;
  final String? autoSpeciesId;
  final double? autoConfidence;
  final ClassifiedBy classifiedBy;

  final bool isClassifying;
  final bool isSubmitting;

  /// 非致命提示（取消选图 / 定位被拒 / 识别不可用）。
  final String? formNotice;

  /// 提交失败的原因（阻断性）。
  final String? submitError;

  final WildlifeSighting? submitted;

  List<String> get mediaIds => <String>[
        for (final WildlifeDraftPhoto photo in photos)
          if (photo.isUploaded) photo.mediaId!,
      ];

  bool get isUploading =>
      photos.any((WildlifeDraftPhoto photo) => photo.isUploading);

  bool get hasUploadFailure =>
      photos.any((WildlifeDraftPhoto photo) => photo.hasFailed);

  bool get hasPhoto => photos.isNotEmpty;

  bool get hasLocation => geo != null;

  /// 提交按钮的可用条件（与服务端校验**同一套**规则，见 [WildlifeSightingDraft.validate]）。
  bool get canSubmit =>
      !isSubmitting &&
      !isUploading &&
      speciesId != null &&
      observedAt != null &&
      geo != null &&
      ethicsAcknowledged;

  /// 还差什么（用于按钮下方提示，避免用户不知道为什么点不动）。
  String get blockingReason {
    if (isUploading) return '照片正在上传…';
    if (speciesId == null) return '请选择物种';
    if (observedAt == null) return '请选择发现时间';
    if (geo == null) return '请定位或在地图上点选位置';
    if (!ethicsAcknowledged) return '请先阅读并勾选「$wildlifeEthicsAckLabel」';
    return '';
  }

  bool get isDone => submitted != null;

  WildlifeReportState copyWith({
    List<WildlifeDraftPhoto>? photos,
    String? speciesId,
    DateTime? observedAt,
    Wgs84Point? geo,
    int? geoAccuracyM,
    WildlifeLocationSource? locationSource,
    String? zoneId,
    String? note,
    bool? isAnonymous,
    bool? ethicsAcknowledged,
    bool? healthConcern,
    String? individualName,
    String? selectedIndividualId,
    WildlifeClassifyResult? classify,
    String? autoSpeciesId,
    double? autoConfidence,
    ClassifiedBy? classifiedBy,
    bool? isClassifying,
    bool? isSubmitting,
    String? formNotice,
    String? submitError,
    WildlifeSighting? submitted,
    bool clearFormNotice = false,
    bool clearSubmitError = false,
    bool clearSubmitted = false,
    bool clearZoneId = false,
    bool clearSelectedIndividualId = false,
  }) =>
      WildlifeReportState(
        photos: photos ?? this.photos,
        speciesId: speciesId ?? this.speciesId,
        observedAt: observedAt ?? this.observedAt,
        geo: geo ?? this.geo,
        geoAccuracyM: geoAccuracyM ?? this.geoAccuracyM,
        locationSource: locationSource ?? this.locationSource,
        zoneId: clearZoneId ? null : (zoneId ?? this.zoneId),
        note: note ?? this.note,
        isAnonymous: isAnonymous ?? this.isAnonymous,
        ethicsAcknowledged: ethicsAcknowledged ?? this.ethicsAcknowledged,
        healthConcern: healthConcern ?? this.healthConcern,
        individualName: individualName ?? this.individualName,
        selectedIndividualId: clearSelectedIndividualId
            ? null
            : (selectedIndividualId ?? this.selectedIndividualId),
        classify: classify ?? this.classify,
        autoSpeciesId: autoSpeciesId ?? this.autoSpeciesId,
        autoConfidence: autoConfidence ?? this.autoConfidence,
        classifiedBy: classifiedBy ?? this.classifiedBy,
        isClassifying: isClassifying ?? this.isClassifying,
        isSubmitting: isSubmitting ?? this.isSubmitting,
        formNotice: clearFormNotice ? null : (formNotice ?? this.formNotice),
        submitError:
            clearSubmitError ? null : (submitError ?? this.submitError),
        submitted: clearSubmitted ? null : (submitted ?? this.submitted),
      );

  @override
  String toString() =>
      'WildlifeReportState(photos=${photos.length}, species=$speciesId, '
      'geo=${geo == null ? 'none' : locationSource.name}, submitted=${submitted?.id})';
}

final wildlifeReportControllerProvider =
    NotifierProvider<WildlifeReportController, WildlifeReportState>(
  WildlifeReportController.new,
);

/// 上报表单的编排（application 层：**不含 IO**，只调用端口）。
///
/// 它把规格里最容易漏掉的几条规则固化成代码：
///   - 照片先上传拿 `mediaId`，再创建 sighting（§4.5 的时序）；
///   - 重试**复用** `clientPhotoId`（§4.5 幂等）；
///   - 伦理确认是**表单校验**（缺它只拒绝该次提交，不阻塞浏览）；
///   - 低置信度**不预选**物种（§5.5 / T44）；
///   - 手动命名先创建个体，名字冲突时**复用**已有个体（§2.8 的唯一约束）。
final class WildlifeReportController extends Notifier<WildlifeReportState> {
  int _sequence = 0;

  @override
  WildlifeReportState build() => const WildlifeReportState();

  /// 清空表单（进入页面 / 提交成功后）。
  void reset() => state = const WildlifeReportState();

  /// 发现时间默认"现在"（用户可以改）。**不在 `build()` 里取时间**，
  /// 这样测试可以注入固定时刻。
  void ensureDefaults({DateTime? now}) {
    if (state.observedAt != null) return;
    state = state.copyWith(observedAt: now ?? DateTime.now());
  }

  // ------------------------------------------------------------- 照片

  Future<void> pickPhotos() async {
    final MediaPickerPort picker = ref.read(mediaPickerProvider);
    final List<PickedPhoto> picked = await picker.pickImages(
      maxCount: maxMediaPerSighting,
    );
    if (picked.isEmpty) {
      state = state.copyWith(
        formNotice: '没有选择照片（可能是取消了选择，或未授予相册权限）',
      );
      return;
    }
    final List<WildlifeDraftPhoto> photos = <WildlifeDraftPhoto>[
      ...state.photos
    ];
    for (final PickedPhoto photo in picked) {
      if (photos.length >= maxMediaPerSighting) break;
      photos.add(
        WildlifeDraftPhoto(
          clientPhotoId: _newClientPhotoId(),
          bytes: photo.bytes,
          fileName: photo.fileName,
          mimeType: photo.mimeType,
        ),
      );
    }
    state = state.copyWith(photos: photos, clearFormNotice: true);
    await _uploadPendingPhotos();
  }

  void removePhoto(String clientPhotoId) {
    state = state.copyWith(
      photos: <WildlifeDraftPhoto>[
        for (final WildlifeDraftPhoto photo in state.photos)
          if (photo.clientPhotoId != clientPhotoId) photo,
      ],
    );
  }

  /// 重试失败的上传（**复用同一个 `clientPhotoId`**，服务端据此幂等）。
  Future<void> retryPhoto(String clientPhotoId) async {
    state = state.copyWith(
      photos: _mapPhoto(
        clientPhotoId,
        (WildlifeDraftPhoto photo) => photo.copyWith(
          status: WildlifePhotoStatus.uploading,
          clearError: true,
        ),
      ),
      clearFormNotice: true,
    );
    await _uploadPendingPhotos();
  }

  Future<void> _uploadPendingPhotos() async {
    final WildlifePort port = ref.read(wildlifeRepositoryProvider);
    for (final WildlifeDraftPhoto photo in <WildlifeDraftPhoto>[
      ...state.photos
    ]) {
      if (photo.isUploaded) continue;
      final Result<WildlifeMedia> result = await port.uploadMedia(
        UploadWildlifeMediaCommand(
          bytes: photo.bytes,
          clientPhotoId: photo.clientPhotoId,
          fileName: photo.fileName,
          mimeType: photo.mimeType,
        ),
      );
      final WildlifeMedia? media = result.valueOrNull;
      if (media != null) {
        state = state.copyWith(
          photos: _mapPhoto(
            photo.clientPhotoId,
            (WildlifeDraftPhoto item) => item.copyWith(
              status: WildlifePhotoStatus.uploaded,
              mediaId: media.mediaId,
              attempts: item.attempts + 1,
              clearError: true,
            ),
          ),
        );
      } else {
        state = state.copyWith(
          photos: _mapPhoto(
            photo.clientPhotoId,
            (WildlifeDraftPhoto item) => item.copyWith(
              status: WildlifePhotoStatus.failed,
              error: result.errorOrNull?.userMessage ?? '上传失败',
              attempts: item.attempts + 1,
            ),
          ),
        );
      }
    }
  }

  // ------------------------------------------------------------- 表单字段

  void setSpecies(String? speciesId) {
    // 用户"接受"自动建议时保留 `vision_api`；自己改选则记为 `manual`
    // （服务端据此记录 correctedFromSpeciesId，形成标注样本，规格 §5.5）。
    final bool acceptedSuggestion = speciesId != null &&
        speciesId == state.autoSpeciesId &&
        (state.classify?.available ?? false);
    state = state.copyWith(
      speciesId: speciesId,
      classifiedBy:
          acceptedSuggestion ? ClassifiedBy.visionApi : ClassifiedBy.manual,
      clearSubmitError: true,
    );
  }

  void setObservedAt(DateTime observedAt) =>
      state = state.copyWith(observedAt: observedAt, clearSubmitError: true);

  void setNote(String note) => state = state.copyWith(note: note);

  void toggleAnonymous() =>
      state = state.copyWith(isAnonymous: !state.isAnonymous);

  void setEthicsAcknowledged(bool acknowledged) => state =
      state.copyWith(ethicsAcknowledged: acknowledged, clearSubmitError: true);

  void toggleHealthConcern() =>
      state = state.copyWith(healthConcern: !state.healthConcern);

  void setIndividualName(String name) => state =
      state.copyWith(individualName: name, clearSelectedIndividualId: true);

  /// 选择一只**已存在的**命名个体（R6 的"这是某只熟悉的动物吗"）。
  void selectIndividual(String? individualId) => state = state.copyWith(
        selectedIndividualId: individualId,
        clearSelectedIndividualId: individualId == null,
      );

  void setZone(String? zoneId) => state = state.copyWith(
        zoneId: zoneId,
        clearZoneId: zoneId == null,
      );

  // ------------------------------------------------------------- 位置

  /// 使用设备定位（WGS84）。失败时**不阻塞**：提示用户改用地图点选。
  Future<void> useCurrentLocation() async {
    final LocationPort location = ref.read(locationProvider);
    LocationPermission permission = await location.permissionStatus();
    if (permission != LocationPermission.granted) {
      permission = await location.requestPermission();
    }
    if (permission != LocationPermission.granted) {
      state = state.copyWith(
        formNotice: '定位不可用（${permission.label}），请在地图上点选位置',
      );
      return;
    }
    final LocationFix? fix = await location.currentFix();
    if (fix == null) {
      state = state.copyWith(formNotice: '暂时拿不到定位，请在地图上点选位置');
      return;
    }
    state = state.copyWith(
      geo: fix.point,
      geoAccuracyM: fix.accuracyM,
      locationSource: WildlifeLocationSource.gps,
      clearFormNotice: true,
      clearSubmitError: true,
    );
    await _autoSelectZone(fix.point);
  }

  /// 在地图上点选位置（既是降级路径，也是纠正 GPS 漂移的正常手段）。
  Future<void> setLocationFromMap(Wgs84Point point) async {
    state = state.copyWith(
      geo: point,
      geoAccuracyM: null,
      locationSource: WildlifeLocationSource.map,
      clearFormNotice: true,
      clearSubmitError: true,
    );
    await _autoSelectZone(point);
  }

  /// 用点选坐标自动判定所属区域（规格 §8.3：命中 `forbidden` 区域要警告）。
  Future<void> _autoSelectZone(Wgs84Point point) async {
    final WildlifePort port = ref.read(wildlifeRepositoryProvider);
    final Result<List<WildlifeZone>> result = await port.listZones();
    final List<WildlifeZone> zones =
        result.valueOrNull ?? const <WildlifeZone>[];
    if (zones.isEmpty) return;
    final WildlifeZone? zone = zoneContaining(point, zones);
    state = state.copyWith(
      zoneId: zone?.id,
      clearZoneId: zone == null,
    );
  }

  // ------------------------------------------------------------- 自动分类

  /// 请求自动分类建议（规格 §5.2：**分类是增强，不是前置条件**）。
  Future<void> requestClassify() async {
    final List<String> mediaIds = state.mediaIds;
    if (mediaIds.isEmpty) {
      state = state.copyWith(formNotice: '请先选择照片（也可以不带照片提交）');
      return;
    }
    state = state.copyWith(isClassifying: true, clearFormNotice: true);
    final WildlifePort port = ref.read(wildlifeRepositoryProvider);
    final Result<WildlifeClassifyResult> result = await port.classify(
      WildlifeClassifyRequest(mediaId: mediaIds.first),
    );
    final WildlifeClassifyResult? classify = result.valueOrNull;
    if (classify == null) {
      // 静默降级到手动（规格 §5.2 的 fallback 分支）。
      state = state.copyWith(
        isClassifying: false,
        classifiedBy: ClassifiedBy.fallback,
        formNotice: '自动识别暂时不可用，请手动选择物种（不影响上报）',
      );
      return;
    }
    final WildlifeClassifySuggestion? preselection = classify.preselection;
    state = state.copyWith(
      isClassifying: false,
      classify: classify,
      autoSpeciesId: classify.top?.speciesId,
      autoConfidence: classify.top?.confidence,
      classifiedBy:
          classify.available ? ClassifiedBy.visionApi : ClassifiedBy.fallback,
      // 低置信度**不预选**（规格 §5.5 / T44）：用户必须自己选。
      speciesId: preselection?.speciesId,
      formNotice: classify.available ? null : classify.fallbackNotice,
      clearFormNotice: classify.available,
    );
  }

  // ------------------------------------------------------------- 提交

  Future<void> submit() async {
    final Wgs84Point? geo = state.geo;
    final String? speciesId = state.speciesId;
    final DateTime? observedAt = state.observedAt;
    if (geo == null || speciesId == null || observedAt == null) {
      state = state.copyWith(submitError: '请先补齐物种、发现时间与位置');
      return;
    }

    final WildlifeSightingDraft draft = WildlifeSightingDraft(
      speciesId: speciesId,
      observedAt: observedAt,
      geo: geo,
      geoAccuracyM: state.geoAccuracyM,
      zoneId: state.zoneId,
      mediaIds: state.mediaIds,
      healthConcern: state.healthConcern,
      individualId: state.selectedIndividualId,
      note: state.note.trim().isEmpty ? null : state.note.trim(),
      isAnonymous: state.isAnonymous,
      autoSpeciesId: state.autoSpeciesId,
      autoConfidence: state.autoConfidence,
      classifiedBy: state.classifiedBy,
      ethicsAcknowledged: state.ethicsAcknowledged,
    );

    state = state.copyWith(isSubmitting: true, clearSubmitError: true);
    final WildlifePort port = ref.read(wildlifeRepositoryProvider);

    // 客户端先按服务端的同一套规则校验（规格 §10.3）：能本地拒绝的就不发请求。
    final List<WildlifeSpecies> species = _require<List<WildlifeSpecies>>(
      await port.listSpecies(),
    );
    final WildlifeValidationResult validation = draft.validate(
      now: DateTime.now(),
      knownSpeciesIds: species.map((WildlifeSpecies item) => item.id).toSet(),
    );
    if (validation.isInvalid) {
      state = state.copyWith(
        isSubmitting: false,
        submitError: validation.firstMessage ?? '请检查表单',
      );
      return;
    }

    // 手动命名（R6）：先建个体；同名冲突时**复用**已有个体，而不是报错卡住用户。
    String? individualId = state.selectedIndividualId;
    final String name = state.individualName.trim();
    if (individualId == null && name.isNotEmpty) {
      final Result<WildlifeIndividual> created = await port.createIndividual(
        CreateWildlifeIndividualCommand(name: name, speciesId: speciesId),
      );
      final WildlifeIndividual? individual = created.valueOrNull;
      if (individual != null) {
        individualId = individual.id;
      } else if (created.errorOrNull?.code == ApiErrorCode.conflict) {
        final List<WildlifeIndividual> existing =
            _require<List<WildlifeIndividual>>(
          await port.listIndividuals(speciesId: speciesId),
        );
        for (final WildlifeIndividual item in existing) {
          if (item.name == name) {
            individualId = item.id;
            break;
          }
        }
        if (individualId == null) {
          state = state.copyWith(
            isSubmitting: false,
            submitError: '「$name」已被占用，请换一个名字',
          );
          return;
        }
      } else {
        state = state.copyWith(
          isSubmitting: false,
          submitError: created.errorOrNull?.userMessage ?? '命名失败',
        );
        return;
      }
    }

    final Result<WildlifeSighting> result = await port.createSighting(
      draft.copyWith(individualId: individualId),
    );
    final WildlifeSighting? created = result.valueOrNull;
    if (created == null) {
      state = state.copyWith(
        isSubmitting: false,
        submitError: result.errorOrNull?.userMessage ?? '上报失败，请稍后再试',
      );
      return;
    }

    state = state.copyWith(isSubmitting: false, submitted: created);
    // 写成功后失效读 provider，让列表/地图重新拉取。
    ref.invalidate(wildlifeSightingListControllerProvider);
    ref.invalidate(wildlifeMapControllerProvider);
  }

  // ------------------------------------------------------------- 内部

  List<WildlifeDraftPhoto> _mapPhoto(
    String clientPhotoId,
    WildlifeDraftPhoto Function(WildlifeDraftPhoto photo) update,
  ) =>
      <WildlifeDraftPhoto>[
        for (final WildlifeDraftPhoto photo in state.photos)
          if (photo.clientPhotoId == clientPhotoId) update(photo) else photo,
      ];

  /// 客户端幂等键。
  ///
  /// 不用 UUID 包（本端没有该依赖）：时间戳 + 进程内自增足以保证
  /// "同一张图的重试复用同一个键、不同张图不同键"这个唯一要求。
  String _newClientPhotoId() =>
      'cp-${DateTime.now().microsecondsSinceEpoch}-${_sequence++}';
}
