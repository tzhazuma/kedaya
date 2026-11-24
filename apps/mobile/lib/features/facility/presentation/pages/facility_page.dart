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

/// 场馆列表（`/facility`）。
///
/// 每项固定显示：名称、位置、开放时间、今日剩余时段数。
/// 「剩余」不是常量：它会扣掉已被预约的时段，以及今天已经开始的时段。
class FacilityPage extends ConsumerWidget {
  const FacilityPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final List<FacilityVenue> venues = ref.watch(facilityVenuesProvider);
    final List<FacilityBooking> bookings = ref.watch(facilityBookingsProvider);
    final DateTime now = ref.watch(facilityClockProvider)();
    final int myActiveCount = ref
        .watch(facilityMyBookingsProvider)
        .where((FacilityBooking booking) => booking.isActive)
        .length;

    return KedaYaPageScaffold(
      title: '场馆预约',
      padding: EdgeInsets.zero,
      actions: <Widget>[
        IconButton(
          tooltip: '我的预约',
          onPressed: () => context.push('/facility/bookings'),
          icon: const Icon(Icons.event_note_outlined),
        ),
      ],
      child: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          const FacilityDemoNotice(),
          const SizedBox(height: KedaYaTokens.space3),
          Text(
            '每天 08:00-22:00，共 14 个一小时时段。'
            '先选场馆，再选日期与时段；提交后可以在「我的预约」里取消。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightLoose,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => context.push('/facility/bookings'),
              icon: const Icon(Icons.event_note_outlined, size: 18),
              label: Text(
                myActiveCount == 0 ? '我的预约' : '我的预约（$myActiveCount 条有效）',
              ),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space4),
          for (int i = 0; i < venues.length; i++) ...<Widget>[
            if (i > 0) const SizedBox(height: KedaYaTokens.space3),
            _VenueCard(
              venue: venues[i],
              remainingToday: remainingFacilitySlotCount(
                venueId: venues[i].id,
                date: facilityDateOnly(now),
                bookings: bookings,
                now: now,
              ),
              onTap: () => context.push('/facility/${venues[i].id}'),
            ),
          ],
        ],
      ),
    );
  }
}

class _VenueCard extends StatelessWidget {
  const _VenueCard({
    required this.venue,
    required this.remainingToday,
    required this.onTap,
  });

  final FacilityVenue venue;
  final int remainingToday;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final bool soldOut = remainingToday == 0;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: colors.brandSoft,
                  borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
                ),
                child: Icon(
                  facilityVenueIcon(venue.id),
                  size: 24,
                  color: colors.brandStrong,
                ),
              ),
              const SizedBox(width: KedaYaTokens.space3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      venue.name,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeMd,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: colors.text,
                      ),
                    ),
                    const SizedBox(height: KedaYaTokens.space1),
                    _MetaRow(
                      icon: Icons.place_outlined,
                      text: venue.location,
                    ),
                    const SizedBox(height: 2),
                    _MetaRow(
                      icon: Icons.schedule_outlined,
                      text: '开放 ${venue.openHoursLabel}',
                    ),
                  ],
                ),
              ),
              const SizedBox(width: KedaYaTokens.space2),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
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
                  const SizedBox(height: KedaYaTokens.space2),
                  Icon(
                    Icons.chevron_right,
                    size: 20,
                    color: colors.textMuted,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MetaRow extends StatelessWidget {
  const _MetaRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Row(
      children: <Widget>[
        Icon(icon, size: 14, color: colors.textMuted),
        const SizedBox(width: KedaYaTokens.space1),
        Expanded(
          child: Text(
            text,
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
