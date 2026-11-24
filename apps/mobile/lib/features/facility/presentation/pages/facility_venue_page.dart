import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/facility_booking.dart';
import '../../../../domain/models/facility_venue.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/facility_providers.dart';
import '../components/facility_common.dart';

/// 场馆详情（`/facility/:id`）：日期选择 + 14 个时段 chips。
///
/// 已约满 / 已开始的时段 `onTap` 为 `null`，视觉上也会置灰 ——
/// 但 chip 仍然保留在网格里，用户能看见「这个时段存在，只是不可选」。
class FacilityVenuePage extends ConsumerStatefulWidget {
  const FacilityVenuePage({required this.venueId, super.key});

  final String venueId;

  @override
  ConsumerState<FacilityVenuePage> createState() => _FacilityVenuePageState();
}

class _FacilityVenuePageState extends ConsumerState<FacilityVenuePage> {
  int _selectedDateIndex = 0;
  FacilitySlot? _selectedSlot;

  Future<void> _openBooking(
    FacilityVenue venue,
    DateTime date,
    FacilitySlot slot,
  ) async {
    final bool? created = await context.push<bool>(
      '/facility/${venue.id}/book'
      '?date=${facilityDateKey(date)}&slot=${slot.startHour}',
    );
    if (!mounted || created != true) return;
    setState(() => _selectedSlot = null);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('预约成功，可以在「我的预约」里查看或取消。')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final FacilityVenue? venue =
        ref.watch(facilityVenueProvider(widget.venueId));
    if (venue == null) {
      return KedaYaPageScaffold(
        title: '场馆不存在',
        child: Center(
          child: Text(
            '场馆 "${widget.venueId}" 不在演示数据里。',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              color: colors.textMuted,
            ),
          ),
        ),
      );
    }

    final DateTime now = ref.watch(facilityClockProvider)();
    final List<DateTime> dates = facilityBookableDates(now);
    final int dateIndex =
        _selectedDateIndex >= 0 && _selectedDateIndex < dates.length
            ? _selectedDateIndex
            : 0;
    final DateTime selectedDate = dates[dateIndex];
    final List<FacilityBooking> bookings =
        ref.watch(facilityVenueBookingsProvider(venue.id));
    final int remainingToday = remainingFacilitySlotCount(
      venueId: venue.id,
      date: facilityDateOnly(now),
      bookings: bookings,
      now: now,
    );

    // 选中的时段可能刚刚被占用 / 刚刚开始：不静默保留一个不可提交的选择。
    final FacilitySlot? selected = _selectedSlot != null &&
            facilitySlotState(
                  venueId: venue.id,
                  date: selectedDate,
                  slot: _selectedSlot!,
                  bookings: bookings,
                  now: now,
                ) ==
                FacilitySlotState.available
        ? _selectedSlot
        : null;

    return KedaYaPageScaffold(
      title: venue.name,
      padding: EdgeInsets.zero,
      actions: <Widget>[
        IconButton(
          tooltip: '我的预约',
          onPressed: () => context.push('/facility/bookings'),
          icon: const Icon(Icons.event_note_outlined),
        ),
      ],
      child: Column(
        children: <Widget>[
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(KedaYaTokens.space4),
              children: <Widget>[
                const FacilityDemoNotice(),
                const SizedBox(height: KedaYaTokens.space3),
                _VenueHeader(
                  venue: venue,
                  remainingToday: remainingToday,
                ),
                const SizedBox(height: KedaYaTokens.space4),
                const _SectionTitle(
                  title: '选择日期',
                  hint: '今天 + 未来 6 天',
                ),
                const SizedBox(height: KedaYaTokens.space2),
                SizedBox(
                  height: 48,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: dates.length,
                    separatorBuilder: (BuildContext context, int index) =>
                        const SizedBox(width: KedaYaTokens.space2),
                    itemBuilder: (BuildContext context, int index) {
                      final DateTime date = dates[index];
                      return ChoiceChip(
                        label: Text(formatFacilityDateChip(date, now)),
                        selected: index == dateIndex,
                        onSelected: (bool selected) {
                          if (!selected) return;
                          setState(() {
                            _selectedDateIndex = index;
                            _selectedSlot = null;
                          });
                        },
                      );
                    },
                  ),
                ),
                const SizedBox(height: KedaYaTokens.space4),
                _SectionTitle(
                  title: '选择时段',
                  hint: '${formatFacilityDateWithWeekday(selectedDate)} · '
                      '还剩 '
                      '${remainingFacilitySlotCount(
                    venueId: venue.id,
                    date: selectedDate,
                    bookings: bookings,
                    now: now,
                  )} 段',
                ),
                const SizedBox(height: KedaYaTokens.space2),
                Wrap(
                  spacing: KedaYaTokens.space3,
                  runSpacing: KedaYaTokens.space1,
                  children: const <Widget>[
                    _LegendDot(
                      tone: _LegendTone.available,
                      label: '可预约',
                    ),
                    _LegendDot(tone: _LegendTone.booked, label: '已约满'),
                    _LegendDot(tone: _LegendTone.past, label: '已过'),
                  ],
                ),
                const SizedBox(height: KedaYaTokens.space2),
                LayoutBuilder(
                  builder: (BuildContext context, BoxConstraints constraints) {
                    return GridView.builder(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      itemCount: facilitySlots.length,
                      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: constraints.maxWidth >= 600 ? 3 : 2,
                        mainAxisSpacing: KedaYaTokens.space2,
                        crossAxisSpacing: KedaYaTokens.space2,
                        mainAxisExtent: 58,
                      ),
                      itemBuilder: (BuildContext context, int index) {
                        final FacilitySlot slot = facilitySlots[index];
                        final FacilitySlotState state = facilitySlotState(
                          venueId: venue.id,
                          date: selectedDate,
                          slot: slot,
                          bookings: bookings,
                          now: now,
                        );
                        return _SlotTile(
                          slot: slot,
                          state: state,
                          selected: selected == slot,
                          onTap: state == FacilitySlotState.available
                              ? () => setState(() => _selectedSlot = slot)
                              : null,
                        );
                      },
                    );
                  },
                ),
                const SizedBox(height: KedaYaTokens.space4),
                Text(
                  '说明：每个时段只能有一条预约（自己也不能重复约同一段）。'
                  '取消后时段会立即回到可选；演示数据不会同步到学校系统。',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    height: KedaYaTokens.lineHeightLoose,
                    color: colors.textMuted,
                  ),
                ),
              ],
            ),
          ),
          _BookingBar(
            selectedDate: selectedDate,
            selectedSlot: selected,
            now: now,
            onBook: selected == null
                ? null
                : () => _openBooking(venue, selectedDate, selected),
          ),
        ],
      ),
    );
  }
}

class _VenueHeader extends StatelessWidget {
  const _VenueHeader({required this.venue, required this.remainingToday});

  final FacilityVenue venue;
  final int remainingToday;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final bool soldOut = remainingToday == 0;
    return FacilityInfoPanel(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: colors.brandSoft,
              borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
            ),
            child: Icon(
              facilityVenueIcon(venue.id),
              size: 28,
              color: colors.brandStrong,
            ),
          ),
          const SizedBox(width: KedaYaTokens.space3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: Text(
                        venue.name,
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeLg,
                          fontWeight: KedaYaTokens.fontWeightSemibold,
                          color: colors.text,
                        ),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: KedaYaTokens.space2,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: (soldOut ? colors.danger : colors.success)
                            .withValues(alpha: 0.12),
                        borderRadius:
                            BorderRadius.circular(KedaYaTokens.radiusPill),
                      ),
                      child: Text(
                        soldOut ? '今日已约满' : '今日剩 $remainingToday 段',
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeXs,
                          fontWeight: KedaYaTokens.fontWeightMedium,
                          color: soldOut ? colors.danger : colors.success,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: KedaYaTokens.space1),
                Text(
                  '${venue.location} · 开放 ${venue.openHoursLabel}',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    color: colors.textMuted,
                  ),
                ),
                const SizedBox(height: KedaYaTokens.space1),
                Text(
                  venue.description,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.textMuted,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, required this.hint});

  final String title;
  final String hint;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      children: <Widget>[
        Text(
          title,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        const SizedBox(width: KedaYaTokens.space2),
        Expanded(
          child: Text(
            hint,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          ),
        ),
      ],
    );
  }
}

class _SlotTile extends StatelessWidget {
  const _SlotTile({
    required this.slot,
    required this.state,
    required this.selected,
    required this.onTap,
  });

  final FacilitySlot slot;
  final FacilitySlotState state;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final bool enabled = state == FacilitySlotState.available;
    final Color background = selected
        ? colors.brandSoft
        : enabled
            ? colors.surface
            : colors.surfaceAlt;
    final Color border = selected
        ? colors.brandStrong
        : enabled
            ? colors.border
            : colors.border.withValues(alpha: 0.5);
    final String statusLabel = selected ? '已选择' : state.label;
    final Color statusTone = selected
        ? colors.brandStrong
        : state == FacilitySlotState.available
            ? colors.success
            : colors.textMuted;

    return Semantics(
      button: true,
      enabled: enabled,
      selected: selected,
      label: '${slot.label}，$statusLabel',
      child: Material(
        color: background,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
          side: BorderSide(color: border),
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: KedaYaTokens.space2,
              vertical: KedaYaTokens.space1,
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                Text(
                  slot.label,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightMedium,
                    color: enabled || selected ? colors.text : colors.textMuted,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  statusLabel,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: statusTone,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

enum _LegendTone { available, booked, past }

class _LegendDot extends StatelessWidget {
  const _LegendDot({required this.tone, required this.label});

  final _LegendTone tone;
  final String label;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final Color color = switch (tone) {
      _LegendTone.available => colors.success,
      _LegendTone.booked => colors.textMuted,
      _LegendTone.past => colors.border,
    };
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: KedaYaTokens.space1),
        Text(
          label,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            color: colors.textMuted,
          ),
        ),
      ],
    );
  }
}

class _BookingBar extends StatelessWidget {
  const _BookingBar({
    required this.selectedDate,
    required this.selectedSlot,
    required this.now,
    required this.onBook,
  });

  final DateTime selectedDate;
  final FacilitySlot? selectedSlot;
  final DateTime now;
  final VoidCallback? onBook;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border(top: BorderSide(color: colors.border)),
      ),
      padding: const EdgeInsets.fromLTRB(
        KedaYaTokens.space4,
        KedaYaTokens.space3,
        KedaYaTokens.space4,
        KedaYaTokens.space3,
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  selectedSlot == null
                      ? '还没选时段'
                      : '${formatFacilityRelativeDay(selectedDate, now)} '
                          '${selectedSlot!.label}',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color:
                        selectedSlot == null ? colors.textMuted : colors.text,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  selectedSlot == null
                      ? '选一个「可预约」的时段'
                      : formatFacilityDateWithWeekday(selectedDate),
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: colors.textMuted,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: KedaYaTokens.space3),
          FilledButton.icon(
            onPressed: onBook,
            icon: const Icon(Icons.arrow_forward, size: 18),
            label: const Text('预约这个时段'),
          ),
        ],
      ),
    );
  }
}
