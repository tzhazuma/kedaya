import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../domain/models/geo.dart';
import '../../../../domain/models/wildlife.dart';
import '../../../../domain/models/wildlife_sighting.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/wildlife_providers.dart';
import '../../application/wildlife_report_controller.dart';
import '../components/wildlife_badges.dart';
import '../components/wildlife_ethics_notice.dart';
import '../components/wildlife_map_canvas.dart';
import '../components/wildlife_species_filter.dart';

/// 上报观测（规格 §4 图片链路 + §5 自动分类 + §8.2 伦理确认 + §10.3 字段校验）。
///
/// 链路：选照片 → **先上传**拿 `mediaId` → 发现时间 → 定位或地图点选 →
/// （可选）自动分类建议 → 手动选物种 → （可选）手动命名个体 → 勾选伦理 → 提交。
///
/// 几个**故意**的设计：
///   - **照片不是必须的**：上传失败也可以不带照片提交（规格 §4.5 的最后一行）；
///   - **分类不是前置条件**：没有分类能力时全流程照常可用（规格 §5.2）；
///   - 伦理勾选在**提交按钮上方**（规格 §8.2 指定的位置），且**不是同意门**；
///   - 发现时间默认"现在"，但可以改（补录场景）。
class WildlifeReportPage extends ConsumerStatefulWidget {
  const WildlifeReportPage({super.key});

  @override
  ConsumerState<WildlifeReportPage> createState() => _WildlifeReportPageState();
}

class _WildlifeReportPageState extends ConsumerState<WildlifeReportPage> {
  bool _pickingOnMap = false;

  @override
  void initState() {
    super.initState();
    // 发现时间默认"现在"。放在 post-frame 里做：**不能**在 build 阶段改 provider。
    WidgetsBinding.instance.addPostFrameCallback((Duration _) {
      if (!mounted) return;
      ref.read(wildlifeReportControllerProvider.notifier).ensureDefaults();
    });
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final WildlifeReportState state = ref.watch(wildlifeReportControllerProvider);
    final WildlifeReportController controller = ref.read(
      wildlifeReportControllerProvider.notifier,
    );
    final List<WildlifeSpecies> species =
        ref.watch(wildlifeSpeciesProvider).valueOrNull ?? const <WildlifeSpecies>[];
    final List<WildlifeZone> zones =
        ref.watch(wildlifeZonesProvider).valueOrNull ?? const <WildlifeZone>[];
    final CampusBasemap? basemap = ref.watch(wildlifeBasemapProvider).valueOrNull;
    final List<WildlifeIndividual> individuals = state.speciesId == null
        ? const <WildlifeIndividual>[]
        : (ref.watch(wildlifeIndividualsProvider(state.speciesId)).valueOrNull ??
              const <WildlifeIndividual>[]);
    final WildlifeZone? zone = _zoneById(zones, state.zoneId);
    final DateFormat dateFormat = DateFormat('yyyy-MM-dd HH:mm');

    if (state.isDone) {
      return _SuccessView(sighting: state.submitted!, onReset: controller.reset);
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('上报观测'),
        actions: <Widget>[
          IconButton(
            tooltip: '清空',
            onPressed: controller.reset,
            icon: const Icon(Icons.restart_alt),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          // ---------------------------------------------------------- 照片
          _SectionTitle(
            title: '照片（可选，最多 $maxMediaPerSighting 张）',
            subtitle: '上传到我们的服务器时会强制剥离 EXIF（含 GPS），'
                '原图不会泄漏拍摄位置。',
          ),
          const SizedBox(height: KedaYaTokens.space2),
          if (state.hasPhoto)
            SizedBox(
              height: 104,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: state.photos.length,
                separatorBuilder: (BuildContext context, int index) =>
                    const SizedBox(width: KedaYaTokens.space2),
                itemBuilder: (BuildContext context, int index) {
                  final WildlifeDraftPhoto photo = state.photos[index];
                  return _PhotoTile(
                    photo: photo,
                    onRemove: () => controller.removePhoto(photo.clientPhotoId),
                    onRetry: () => unawaited(controller.retryPhoto(photo.clientPhotoId)),
                  );
                },
              ),
            ),
          if (state.hasPhoto) const SizedBox(height: KedaYaTokens.space2),
          Row(
            children: <Widget>[
              OutlinedButton.icon(
                onPressed: state.photos.length >= maxMediaPerSighting
                    ? null
                    : () => unawaited(controller.pickPhotos()),
                icon: const Icon(Icons.add_photo_alternate_outlined, size: 16),
                label: const Text('添加照片'),
              ),
              const SizedBox(width: KedaYaTokens.space2),
              OutlinedButton.icon(
                onPressed: state.isClassifying || state.mediaIds.isEmpty
                    ? null
                    : () => unawaited(controller.requestClassify()),
                icon: state.isClassifying
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.auto_awesome, size: 16),
                label: const Text('自动识别'),
              ),
            ],
          ),
          if (state.hasUploadFailure) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              '有照片上传失败：可以点照片上的「重试」（会复用同一个幂等键，不会重复存储），'
              '也可以直接不带照片提交。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.danger,
              ),
            ),
          ],
          if (state.classify != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space3),
            _ClassifyCard(
              result: state.classify!,
              onApply: (String speciesId) => controller.setSpecies(speciesId),
            ),
          ],
          const SizedBox(height: KedaYaTokens.space5),

          // ---------------------------------------------------------- 物种
          _SectionTitle(
            title: '物种（必填）',
            subtitle: '识别只是建议，公开的物种以你确认的为准；不确定时选「猫」这类'
                '你能确定的大类也比乱选好。',
          ),
          const SizedBox(height: KedaYaTokens.space2),
          WildlifeSpeciesPicker(
            species: species,
            selectedSpeciesId: state.speciesId,
            suggestionId: state.classify?.available == true ? state.autoSpeciesId : null,
            onSelected: controller.setSpecies,
          ),
          const SizedBox(height: KedaYaTokens.space5),

          // ---------------------------------------------------------- 发现时间
          _SectionTitle(
            title: '发现时间（必填）',
            subtitle: '这是你「看到」它的时间，不是上传时间；补录也可以。',
          ),
          const SizedBox(height: KedaYaTokens.space2),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.schedule),
            title: Text(
              state.observedAt == null
                  ? '未选择'
                  : dateFormat.format(state.observedAt!.toLocal()),
              style: TextStyle(fontSize: KedaYaTokens.fontSizeSm, color: colors.text),
            ),
            trailing: TextButton(
              onPressed: () => unawaited(_pickObservedAt(controller, state)),
              child: const Text('选择'),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space5),

          // ---------------------------------------------------------- 位置
          _SectionTitle(
            title: '位置（必填）',
            subtitle: '坐标一律 WGS84。公开时会模糊化到片区级（约百米），'
                '敏感区（宿舍等）只公开区域、不公开坐标。',
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Row(
            children: <Widget>[
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => unawaited(controller.useCurrentLocation()),
                  icon: const Icon(Icons.my_location, size: 16),
                  label: const Text('使用当前位置'),
                ),
              ),
              const SizedBox(width: KedaYaTokens.space2),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => setState(() => _pickingOnMap = !_pickingOnMap),
                  icon: const Icon(Icons.touch_app_outlined, size: 16),
                  label: Text(_pickingOnMap ? '收起地图' : '在地图上点选'),
                ),
              ),
            ],
          ),
          if (state.geo != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Wrap(
              spacing: KedaYaTokens.space2,
              runSpacing: KedaYaTokens.space1,
              children: <Widget>[
                WildlifePill(
                  text: state.locationSource.label,
                  icon: Icons.place_outlined,
                  tone: colors.info,
                ),
                if (state.geoAccuracyM != null)
                  WildlifePill(text: '±${state.geoAccuracyM} m', icon: Icons.straighten),
                if (zone != null) WildlifePill(text: zone.name, icon: Icons.map_outlined),
              ],
            ),
          ],
          if (_pickingOnMap && basemap != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space3),
            ClipRRect(
              borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
              child: AspectRatio(
                aspectRatio: basemap.heightPx <= 0
                    ? 10 / 7
                    : basemap.widthPx / basemap.heightPx,
                child: WildlifeMapCanvas(
                  basemap: basemap,
                  zones: zones,
                  selection: state.geo,
                  onPickPoint: (Wgs84Point point) =>
                      unawaited(controller.setLocationFromMap(point)),
                ),
              ),
            ),
            const SizedBox(height: KedaYaTokens.space1),
            Text(
              '点击地图选择位置（校园外的点会被服务端拒绝）。',
              style: TextStyle(fontSize: KedaYaTokens.fontSizeXs, color: colors.textMuted),
            ),
          ],
          const SizedBox(height: KedaYaTokens.space5),

          // ---------------------------------------------------------- 命名个体
          _SectionTitle(
            title: '这是某只熟悉的动物吗？（可选）',
            subtitle: '给个体起名能让记录连起来（「大橘今天在食堂」比「一只猫在食堂」'
                '信息量大得多）。命名需要审核后才会公开。',
          ),
          const SizedBox(height: KedaYaTokens.space2),
          if (state.speciesId == null)
            Text(
              '先选择物种，才能选择或新建个体。',
              style: TextStyle(fontSize: KedaYaTokens.fontSizeXs, color: colors.textMuted),
            )
          else ...<Widget>[
            if (individuals.isNotEmpty)
              Wrap(
                spacing: KedaYaTokens.space2,
                runSpacing: KedaYaTokens.space1,
                children: <Widget>[
                  for (final WildlifeIndividual item in individuals)
                    ChoiceChip(
                      label: Text(item.name),
                      selected: state.selectedIndividualId == item.id,
                      onSelected: (bool selected) =>
                          controller.selectIndividual(selected ? item.id : null),
                    ),
                ],
              ),
            const SizedBox(height: KedaYaTokens.space2),
            TextField(
              onChanged: controller.setIndividualName,
              maxLength: maxIndividualNameLength,
              decoration: const InputDecoration(
                labelText: '新建个体名（如「大橘」）',
                helperText: '同名个体已存在时会直接复用，不会报错',
                border: OutlineInputBorder(),
              ),
            ),
          ],
          const SizedBox(height: KedaYaTokens.space5),

          // ---------------------------------------------------------- 备注与开关
          _SectionTitle(title: '备注（可选）', subtitle: '≤$maxSightingNoteLength 字，会经过内容安全。'),
          const SizedBox(height: KedaYaTokens.space2),
          TextField(
            onChanged: controller.setNote,
            maxLines: 3,
            maxLength: maxSightingNoteLength,
            decoration: const InputDecoration(
              hintText: '例如：在图书馆后草坪，两只，其中一只腿有点瘸',
              border: OutlineInputBorder(),
            ),
          ),
          SwitchListTile(
            value: state.healthConcern,
            onChanged: (bool _) => controller.toggleHealthConcern(),
            contentPadding: EdgeInsets.zero,
            title: const Text('疑似受伤 / 状态异常'),
            subtitle: Text(
              wildlifeHealthConcernNotice,
              style: TextStyle(fontSize: KedaYaTokens.fontSizeXs),
            ),
          ),
          SwitchListTile(
            value: state.isAnonymous,
            onChanged: (bool _) => controller.toggleAnonymous(),
            contentPadding: EdgeInsets.zero,
            title: const Text('匿名上报'),
            subtitle: Text(
              '匿名后你的实名身份不会与这条记录关联（列表里显示「匿名同学」）。',
              style: TextStyle(fontSize: KedaYaTokens.fontSizeXs),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space4),

          // ---------------------------------------------------------- 伦理提示
          WildlifeEthicsNotice(
            acknowledged: state.ethicsAcknowledged,
            onChanged: controller.setEthicsAcknowledged,
            // 选中的区域是 `forbidden` 时出红色警告条（规格 §8.3）。
            forbiddenZoneName:
                zone != null && zone.feedingPolicy.needsReportingWarning
                ? zone.name
                : null,
          ),
          const SizedBox(height: KedaYaTokens.space4),

          // ---------------------------------------------------------- 提交
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: state.canSubmit ? () => unawaited(controller.submit()) : null,
              icon: state.isSubmitting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.send_outlined, size: 18),
              label: Text(state.isSubmitting ? '正在提交…' : '提交上报'),
            ),
          ),
          if (!state.canSubmit && state.blockingReason.isNotEmpty) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              state.blockingReason,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: KedaYaTokens.fontSizeXs, color: colors.textMuted),
            ),
          ],
          if (state.formNotice != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              state.formNotice!,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: KedaYaTokens.fontSizeXs, color: colors.info),
            ),
          ],
          if (state.submitError != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              state.submitError!,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: KedaYaTokens.fontSizeSm, color: colors.danger),
            ),
          ],
          const SizedBox(height: KedaYaTokens.space6),
        ],
      ),
    );
  }

  Future<void> _pickObservedAt(
    WildlifeReportController controller,
    WildlifeReportState state,
  ) async {
    final DateTime now = DateTime.now();
    final DateTime initial = state.observedAt?.toLocal() ?? now;
    final DateTime? date = await showDatePicker(
      context: context,
      initialDate: initial.isAfter(now) ? now : initial,
      firstDate: now.subtract(observedAtMaxPastWindow),
      lastDate: now,
    );
    if (date == null || !mounted) return;
    final TimeOfDay? time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
    );
    if (time == null) return;
    controller.setObservedAt(
      DateTime(date.year, date.month, date.day, time.hour, time.minute),
    );
  }

  WildlifeZone? _zoneById(List<WildlifeZone> zones, String? zoneId) {
    if (zoneId == null) return null;
    for (final WildlifeZone zone in zones) {
      if (zone.id == zoneId) return zone;
    }
    return null;
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, this.subtitle});

  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          title,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeMd,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        if (subtitle != null) ...<Widget>[
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            subtitle!,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
        ],
      ],
    );
  }
}

/// 一张草稿照片：本地预览 + 上传状态 + 重试/删除。
class _PhotoTile extends StatelessWidget {
  const _PhotoTile({
    required this.photo,
    required this.onRemove,
    required this.onRetry,
  });

  final WildlifeDraftPhoto photo;
  final VoidCallback onRemove;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return SizedBox(
      width: 104,
      child: Column(
        children: <Widget>[
          Expanded(
            child: Stack(
              children: <Widget>[
                Positioned.fill(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
                    // 本地字节直接预览（mock 运行时也有真实 PNG 字节）。
                    child: Image.memory(
                      _asBytes(photo.bytes),
                      fit: BoxFit.cover,
                      errorBuilder:
                          (BuildContext context, Object error, StackTrace? stackTrace) =>
                              Container(
                                color: colors.surfaceAlt,
                                child: Icon(Icons.image_outlined, color: colors.textMuted),
                              ),
                    ),
                  ),
                ),
                Positioned(
                  right: 0,
                  top: 0,
                  child: IconButton(
                    tooltip: '移除',
                    onPressed: onRemove,
                    iconSize: 16,
                    icon: const Icon(Icons.close),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          if (photo.isUploading)
            Text(
              '上传中…',
              style: TextStyle(fontSize: KedaYaTokens.fontSizeXs, color: colors.textMuted),
            )
          else if (photo.hasFailed)
            TextButton(
              onPressed: onRetry,
              child: Text(
                '重试',
                style: TextStyle(fontSize: KedaYaTokens.fontSizeXs, color: colors.danger),
              ),
            )
          else
            Text(
              '已上传',
              style: TextStyle(fontSize: KedaYaTokens.fontSizeXs, color: colors.success),
            ),
        ],
      ),
    );
  }

  /// `Image.memory` 需要 `Uint8List`；`domain` 层只给 `List<int>`，
  /// 因此在这里（presentation）做一次转换。
  Uint8List _asBytes(List<int> bytes) =>
      bytes is Uint8List ? bytes : Uint8List.fromList(bytes);
}

/// 自动分类建议卡片（低置信度时**不预选**，规格 §5.5 / T44）。
class _ClassifyCard extends StatelessWidget {
  const _ClassifyCard({required this.result, required this.onApply});

  final WildlifeClassifyResult result;
  final ValueChanged<String> onApply;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(Icons.auto_awesome, size: 16, color: colors.info),
              const SizedBox(width: KedaYaTokens.space2),
              Expanded(
                child: Text(
                  result.available ? '识别建议（仅供参考，请确认）' : '自动识别不可用',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
              ),
            ],
          ),
          if (result.isEmpty) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              result.fallbackNotice,
              style: TextStyle(fontSize: KedaYaTokens.fontSizeXs, color: colors.textMuted),
            ),
          ] else ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            for (final WildlifeClassifySuggestion suggestion in result.sortedByConfidence)
              Padding(
                padding: const EdgeInsets.only(bottom: KedaYaTokens.space1),
                child: Row(
                  children: <Widget>[
                    Expanded(
                      child: Text(
                        '${suggestion.notice} · ${suggestion.confidence.toStringAsFixed(2)}',
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeXs,
                          color: colors.text,
                        ),
                      ),
                    ),
                    TextButton(
                      onPressed: () => onApply(suggestion.speciesId),
                      child: const Text('采用'),
                    ),
                  ],
                ),
              ),
            if (result.preselection == null)
              Text(
                '置信度低于 $classifyPreselectMinConfidence，我们不会替你预选，请自己确认。',
                style: TextStyle(fontSize: KedaYaTokens.fontSizeXs, color: colors.warning),
              ),
          ],
        ],
      ),
    );
  }
}

/// 提交成功（新上报是 `PENDING`，**不假装已发布**）。
class _SuccessView extends StatelessWidget {
  const _SuccessView({required this.sighting, required this.onReset});

  final WildlifeSighting sighting;
  final VoidCallback onReset;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Scaffold(
      appBar: AppBar(title: const Text('上报已提交')),
      body: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          Container(
            padding: const EdgeInsets.all(KedaYaTokens.space4),
            decoration: BoxDecoration(
              color: colors.success.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
              border: Border.all(color: colors.success.withValues(alpha: 0.5)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Icon(Icons.check_circle_outline, color: colors.success),
                    const SizedBox(width: KedaYaTokens.space2),
                    Text(
                      '已提交，等待审核',
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeMd,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: colors.text,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: KedaYaTokens.space2),
                Text(
                  '编号 ${sighting.id} · 状态「${sighting.status.label}」。'
                  '审核通过后才会出现在地图与列表里。',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.text,
                  ),
                ),
                if (sighting.healthConcern) ...<Widget>[
                  const SizedBox(height: KedaYaTokens.space3),
                  const WildlifeHealthConcernNotice(),
                ],
              ],
            ),
          ),
          const SizedBox(height: KedaYaTokens.space4),
          WildlifePrivacyNotice(hasGeo: sighting.hasGeo),
          const SizedBox(height: KedaYaTokens.space4),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () {
                onReset();
                context.go('/wildlife');
              },
              icon: const Icon(Icons.map_outlined, size: 18),
              label: const Text('回到地图'),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: onReset,
              child: const Text('再报一条'),
            ),
          ),
        ],
      ),
    );
  }
}
