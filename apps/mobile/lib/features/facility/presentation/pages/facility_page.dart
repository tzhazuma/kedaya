import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/facility_booking.dart';
import '../../../../domain/models/facility_venue.dart';
import '../../../../platform/system_browser.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/facility_providers.dart';
import '../../../campus_web/presentation/campus_web_page.dart' show campusWebSupported;
import '../components/facility_common.dart';
import '../oa_gym_page.dart' show oaGymEntryUrl;

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
          const _RealFacilityEntry(),
          const SizedBox(height: KedaYaTokens.space5),
          Padding(
            padding: const EdgeInsets.only(left: KedaYaTokens.space1),
            child: Text(
              '本机演练',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                fontWeight: KedaYaTokens.fontWeightSemibold,
                color: colors.textMuted,
              ),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
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

/// 真实场馆通道：学校 OA 的空闲查询与预约申请。
///
/// 这是**主入口**，放在演示列表之前：用户点「场馆」要的是真的约到场地，
/// 而不是一份本机演示数据。登录在学校 OA 页面里完成，本机不保存校园会话。
class _RealFacilityEntry extends StatelessWidget {
  const _RealFacilityEntry();

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final bool supported = !kIsWeb && campusWebSupported(defaultTargetPlatform);
    return Container(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.brand.withValues(alpha: 0.35)),
      ),
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(Icons.sports_tennis_outlined,
                  size: 20, color: colors.brandStrong),
              const SizedBox(width: KedaYaTokens.space2),
              Expanded(
                child: Text(
                  '学校场馆系统（真实预约）',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeMd,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '连接学校 OA 查询羽毛球、网球等场地的实时空闲，并提交预约申请。'
            '需要校园网或 VPN；登录在打开的学校页面里完成。'
            '提交后请到 OA「我的请求」确认结果。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightLoose,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () => _openRealFacility(context),
              icon: const Icon(Icons.open_in_new, size: 18),
              label: Text(
                supported
                    ? '查询空闲并预约'
                    : systemBrowserSupported
                        ? '在浏览器打开学校 OA 预约'
                        : '复制学校 OA 地址',
              ),
            ),
          ),
          if (!supported) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              '桌面端在浏览器里登录后预约；App 内的实时空闲面板目前仅 Android / iOS 支持。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.textMuted,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _openRealFacility(BuildContext context) async {
    final bool supported = !kIsWeb && campusWebSupported(defaultTargetPlatform);
    if (supported) {
      await context.push('/oa-gym');
      return;
    }
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    if (await openInSystemBrowser(oaGymEntryUrl)) return;
    await Clipboard.setData(const ClipboardData(text: oaGymEntryUrl));
    messenger.showSnackBar(
      const SnackBar(content: Text('已复制学校 OA 地址，请在浏览器打开')),
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
