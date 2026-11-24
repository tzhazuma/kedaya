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

/// 我的场馆预约（`/facility/bookings`）。
///
/// 只列 `isMine` 的预约；已取消的也保留在列表里（状态写明「已取消」），
/// 这样取消不是一个不可回看的动作。
class MyFacilityBookingsPage extends ConsumerWidget {
  const MyFacilityBookingsPage({super.key});

  Future<void> _cancel(
    BuildContext context,
    WidgetRef ref,
    FacilityBooking booking,
    FacilityVenue? venue,
  ) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('取消这条预约？'),
        content: Text(
          '${venue?.name ?? booking.venueId} · '
          '${formatFacilityDateWithWeekday(booking.date)} '
          '${booking.slot.label}\n\n'
          '取消后这个时段会立即回到可选，其他人可以预约。',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('保留'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('取消预约'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;

    try {
      ref.read(facilityBookingsProvider.notifier).cancel(booking.id);
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已取消，这个时段已经重新开放。')),
      );
    } on FacilityBookingException catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.userMessage)),
      );
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final List<FacilityBooking> mine = ref.watch(facilityMyBookingsProvider);
    final List<FacilityVenue> venues = ref.watch(facilityVenuesProvider);
    final DateTime now = ref.watch(facilityClockProvider)();

    return KedaYaPageScaffold(
      title: '我的场馆预约',
      padding: EdgeInsets.zero,
      actions: <Widget>[
        IconButton(
          tooltip: '场馆列表',
          onPressed: () => context.push('/facility'),
          icon: const Icon(Icons.grid_view_outlined),
        ),
      ],
      child: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          const FacilityDemoNotice(),
          const SizedBox(height: KedaYaTokens.space4),
          if (mine.isEmpty)
            _EmptyBookings(
              onBrowse: () => context.push('/facility'),
            )
          else ...<Widget>[
            Text(
              '共 ${mine.length} 条；有效预约 ${mine.where((FacilityBooking booking) => booking.isActive).length} 条。'
              '取消后时段会立即释放。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.textMuted,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space3),
            for (int i = 0; i < mine.length; i++) ...<Widget>[
              if (i > 0) const SizedBox(height: KedaYaTokens.space3),
              _BookingCard(
                booking: mine[i],
                venue: venues.byId(mine[i].venueId),
                now: now,
                onCancel: mine[i].isActive
                    ? () => _cancel(
                          context,
                          ref,
                          mine[i],
                          venues.byId(mine[i].venueId),
                        )
                    : null,
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _BookingCard extends StatelessWidget {
  const _BookingCard({
    required this.booking,
    required this.venue,
    required this.now,
    required this.onCancel,
  });

  final FacilityBooking booking;
  final FacilityVenue? venue;
  final DateTime now;
  final VoidCallback? onCancel;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final bool active = booking.isActive;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Icon(
                  facilityVenueIcon(booking.venueId),
                  size: 20,
                  color: active ? colors.brandStrong : colors.textMuted,
                ),
                const SizedBox(width: KedaYaTokens.space2),
                Expanded(
                  child: Text(
                    venue?.name ?? booking.venueId,
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeMd,
                      fontWeight: KedaYaTokens.fontWeightSemibold,
                      color: active ? colors.text : colors.textMuted,
                    ),
                  ),
                ),
                const SizedBox(width: KedaYaTokens.space2),
                FacilityStatusBadge(status: booking.status),
              ],
            ),
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              '${formatFacilityDateWithWeekday(booking.date)} · '
              '${booking.slot.label}',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                fontWeight: KedaYaTokens.fontWeightMedium,
                color: active ? colors.text : colors.textMuted,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              '${formatFacilityRelativeDay(booking.date, now)} · '
              '${booking.partySize} 人'
              '${venue == null ? '' : ' · ${venue!.location}'}',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
            if (booking.note != null) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                booking.note!,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  height: KedaYaTokens.lineHeightNormal,
                  color: active ? colors.text : colors.textMuted,
                ),
              ),
            ],
            if (onCancel != null) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space2),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: onCancel,
                  icon: const Icon(Icons.event_busy_outlined, size: 18),
                  label: const Text('取消预约'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _EmptyBookings extends StatelessWidget {
  const _EmptyBookings({required this.onBrowse});

  final VoidCallback onBrowse;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: KedaYaTokens.space10),
      child: Column(
        children: <Widget>[
          Icon(
            Icons.event_available_outlined,
            size: 44,
            color: colors.textMuted,
          ),
          const SizedBox(height: KedaYaTokens.space3),
          Text(
            '还没有预约',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeMd,
              fontWeight: KedaYaTokens.fontWeightSemibold,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '去场馆列表挑一个时段试试。预约只保存在本次运行的内存里。',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space4),
          FilledButton.icon(
            onPressed: onBrowse,
            icon: const Icon(Icons.arrow_forward, size: 18),
            label: const Text('去场馆列表'),
          ),
        ],
      ),
    );
  }
}
