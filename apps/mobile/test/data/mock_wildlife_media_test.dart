import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/data/mock/mock_fixtures.dart';
import 'package:kedaya/data/mock/mock_media_picker.dart';
import 'package:kedaya/data/mock/mock_wildlife_repository.dart';
import 'package:kedaya/data/mock/wildlife_fixtures.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/geo.dart';
import 'package:kedaya/domain/models/result.dart';
import 'package:kedaya/domain/models/wildlife_sighting.dart';
import 'package:kedaya/domain/ports/media_picker_port.dart';

/// 图片上传链路（规格 §4 / §11.5）与自动分类降级（规格 §5 / §11.6）的行为测试。
void main() {
  MockWildlifeRepository buildRepository({bool classifierEnabled = false}) =>
      MockWildlifeRepository(
        controls: MockControls(latency: Duration.zero),
        now: mockNow,
        classifierEnabled: classifierEnabled,
      );

  UploadWildlifeMediaCommand command({
    required String clientPhotoId,
    List<int>? bytes,
  }) =>
      UploadWildlifeMediaCommand(
        bytes: bytes ?? mockPngBytes,
        clientPhotoId: clientPhotoId,
        fileName: 'cat.png',
        mimeType: 'image/png',
      );

  group('上传：幂等与校验（规格 §4.5 / §11.5 T35-T37）', () {
    test('同一 clientPhotoId 重试 → 相同 mediaId，且不重复存储', () async {
      final MockWildlifeRepository repository = buildRepository();
      final WildlifeMedia first = (await repository.uploadMedia(
        command(clientPhotoId: 'cp-1'),
      ))
          .unwrap;
      final WildlifeMedia retry = (await repository.uploadMedia(
        command(clientPhotoId: 'cp-1'),
      ))
          .unwrap;
      expect(retry.mediaId, first.mediaId);
      expect(repository.mediaCount, 1);
    });

    test('不同 clientPhotoId → 不同 mediaId', () async {
      final MockWildlifeRepository repository = buildRepository();
      final WildlifeMedia first = (await repository.uploadMedia(
        command(clientPhotoId: 'cp-1'),
      ))
          .unwrap;
      final WildlifeMedia second = (await repository.uploadMedia(
        command(clientPhotoId: 'cp-2'),
      ))
          .unwrap;
      expect(second.mediaId, isNot(first.mediaId));
      expect(repository.mediaCount, 2);
      expect(second.clientPhotoId, 'cp-2');
    });

    test('返回的 mimeType 是**嗅探**出来的，不是客户端声明的', () async {
      final MockWildlifeRepository repository = buildRepository();
      final WildlifeMedia media = (await repository.uploadMedia(
        UploadWildlifeMediaCommand(
          bytes: mockPngBytes,
          clientPhotoId: 'cp-3',
          // 客户端撒谎：声明成 jpeg，实际是 png。
          mimeType: 'image/jpeg',
        ),
      ))
          .unwrap;
      expect(media.mimeType, 'image/png');
      expect(media.sha256, startsWith('mock-fnv1a-'));
    });

    test('非图片文件 → VALIDATION_FAILED / MEDIA_UNSUPPORTED_TYPE', () async {
      final MockWildlifeRepository repository = buildRepository();
      final Result<WildlifeMedia> result = await repository.uploadMedia(
        command(
          clientPhotoId: 'cp-4',
          bytes: 'this is not an image'.codeUnits,
        ),
      );
      expect(result.errorOrNull!.code, ApiErrorCode.validationFailed);
      expect(
        (result.errorOrNull!.details! as Map<String, Object?>)['reason'],
        reasonMediaUnsupportedType,
      );
      expect(repository.mediaCount, 0);
    });

    test('超过 5 MB → MEDIA_TOO_LARGE', () async {
      final MockWildlifeRepository repository = buildRepository();
      final Result<WildlifeMedia> result = await repository.uploadMedia(
        command(
          clientPhotoId: 'cp-5',
          bytes: <int>[0xFF, 0xD8, 0xFF, ...List<int>.filled(maxMediaBytes, 0)],
        ),
      );
      expect(
        (result.errorOrNull!.details! as Map<String, Object?>)['reason'],
        reasonMediaTooLarge,
      );
    });

    test('mock 选图返回的是一张**真实**的 PNG（魔数校验能过）', () async {
      final InMemoryMediaPicker picker = InMemoryMediaPicker();
      final List<PickedPhoto> photos = await picker.pickImages();
      expect(photos, hasLength(1));
      expect(looksLikeImage(photos.single.bytes), isTrue);
      expect(photos.single.mimeType, 'image/png');
    });

    test('取消选图返回空列表（不是错误）', () async {
      final InMemoryMediaPicker picker = InMemoryMediaPicker(
        mode: InMemoryMediaPickerMode.none,
      );
      expect(await picker.pickImages(), isEmpty);
    });

    test('选图上限为 3 张（契约 photoUrls ≤3）', () async {
      final InMemoryMediaPicker picker = InMemoryMediaPicker(
        mode: InMemoryMediaPickerMode.threePhotos,
      );
      expect(await picker.pickImages(maxCount: 3), hasLength(3));
      expect(await picker.pickImages(maxCount: 2), hasLength(2));
    });
  });

  group('媒体与观测的关联（规格 §10.3 MEDIA_ALREADY_LINKED）', () {
    test('上报带上 mediaIds 后会生成 photoUrls；同一媒体不能被两条观测使用', () async {
      final MockWildlifeRepository repository = buildRepository();
      final WildlifeMedia media = (await repository.uploadMedia(
        command(clientPhotoId: 'cp-10'),
      ))
          .unwrap;

      final WildlifeSighting created = (await repository.createSighting(
        WildlifeSightingDraft(
          speciesId: mockSpeciesCat,
          observedAt: mockNow.subtract(const Duration(hours: 1)),
          geo: const Wgs84Point(lat: 31.17855, lng: 121.59010),
          mediaIds: <String>[media.mediaId],
          ethicsAcknowledged: true,
        ),
      ))
          .unwrap;
      expect(created.photoUrls, hasLength(1));
      expect(created.photoUrls.single, contains(media.mediaId));

      final Result<WildlifeSighting> reused = await repository.createSighting(
        WildlifeSightingDraft(
          speciesId: mockSpeciesCat,
          observedAt: mockNow.subtract(const Duration(hours: 1)),
          geo: const Wgs84Point(lat: 31.17855, lng: 121.59010),
          mediaIds: <String>[media.mediaId],
          ethicsAcknowledged: true,
        ),
      );
      expect(
        (reused.errorOrNull!.details! as Map<String, Object?>)['reason'],
        reasonMediaAlreadyLinked,
      );
    });

    test('不带照片也能提交（规格 §4.5 的最后一行）', () async {
      final MockWildlifeRepository repository = buildRepository();
      final WildlifeSighting created = (await repository.createSighting(
        WildlifeSightingDraft(
          speciesId: mockSpeciesCat,
          observedAt: mockNow.subtract(const Duration(hours: 1)),
          geo: const Wgs84Point(lat: 31.17855, lng: 121.59010),
          ethicsAcknowledged: true,
        ),
      ))
          .unwrap;
      expect(created.photoUrls, isEmpty);
    });
  });

  group('自动分类：可离线降级（规格 §5.2 / §11.6 T41-T44）', () {
    test('默认（manual 模式）返回空数组，不是 5xx', () async {
      final MockWildlifeRepository repository = buildRepository();
      final WildlifeClassifyResult result = (await repository.classify(
        const WildlifeClassifyRequest(mediaId: 'wm-1'),
      ))
          .unwrap;
      expect(result.available, isFalse);
      expect(result.items, isEmpty);
      expect(result.preselection, isNull);
    });

    test('启用分类器后有建议，且 top-1 置信度 ≥ 0.55', () async {
      final MockWildlifeRepository repository =
          buildRepository(classifierEnabled: true);
      final WildlifeClassifyResult result = (await repository.classify(
        const WildlifeClassifyRequest(mediaId: 'wm-1'),
      ))
          .unwrap;
      expect(result.available, isTrue);
      expect(result.items, isNotEmpty);
      expect(result.top!.confidence, greaterThanOrEqualTo(0.55));
      expect(result.top!.confidence, lessThanOrEqualTo(0.95));
      // 同一 mediaId 永远给同一结果（确定性，便于复现）。
      final WildlifeClassifyResult again = (await repository.classify(
        const WildlifeClassifyRequest(mediaId: 'wm-1'),
      ))
          .unwrap;
      expect(again.top!.speciesId, result.top!.speciesId);
      expect(again.top!.confidence, result.top!.confidence);
    });

    test('置信度 < 0.60 时不预选（T44）', () async {
      final MockWildlifeRepository repository =
          buildRepository(classifierEnabled: true)
            ..classifierForcedConfidence = 0.42;
      final WildlifeClassifyResult result = (await repository.classify(
        const WildlifeClassifyRequest(mediaId: 'wm-1'),
      ))
          .unwrap;
      expect(result.top!.confidence, 0.42);
      expect(result.top!.confidenceLabel, '无法确定');
      expect(result.preselection, isNull);
    });

    test('故障注入时分类请求失败（UI 静默降级到手动）', () async {
      final MockWildlifeRepository repository = MockWildlifeRepository(
        controls: MockControls(latency: Duration.zero),
        now: mockNow,
        classifierEnabled: true,
      );
      repository.controls.failureMode = MockFailureMode.upstreamUnavailable;
      final Result<WildlifeClassifyResult> result = await repository.classify(
        const WildlifeClassifyRequest(mediaId: 'wm-1'),
      );
      expect(result.isErr, isTrue);
      expect(result.errorOrNull!.code, ApiErrorCode.upstreamUnavailable);
    });
  });
}
