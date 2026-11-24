import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/facility_booking.dart';
import '../../../../domain/models/facility_venue.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/facility_providers.dart';
import '../components/facility_common.dart';

/// 确认预约（`/facility/:id/book?date=...&slot=...`）。
///
/// 提交前会把「这个时段是不是已经被占了」再算一次：即使详情页打开后
/// 有别人抢先预约（或自己已经约过），这里也会给出明确的冲突提示，
/// 而不是等提交后弹一个笼统的失败。
class FacilityBookingPage extends ConsumerStatefulWidget {
  const FacilityBookingPage({
    required this.venueId,
    required this.date,
    required this.slot,
    super.key,
  });

  final String venueId;
  final DateTime date;
  final FacilitySlot slot;

  @override
  ConsumerState<FacilityBookingPage> createState() =>
      _FacilityBookingPageState();
}

class _FacilityBookingPageState extends ConsumerState<FacilityBookingPage> {
  final TextEditingController _people = TextEditingController(text: '1');
  final TextEditingController _note = TextEditingController();

  String? _peopleError;
  String? _submitError;

  @override
  void dispose() {
    _people.dispose();
    _note.dispose();
    super.dispose();
  }

  void _submit(FacilityVenue venue) {
    FocusScope.of(context).unfocus();
    final int? people = int.tryParse(_people.text.trim());
    if (people == null || !isValidFacilityPartySize(people)) {
      setState(() {
        _peopleError = '使用人数需在 1–10 人之间';
        _submitError = null;
      });
      return;
    }

    final List<FacilityBookingDraftProblem> problems =
        validateFacilityBookingDraft(partySize: people, note: _note.text);
    if (problems.isNotEmpty) {
      setState(() {
        _peopleError = null;
        _submitError = problems
            .map((FacilityBookingDraftProblem problem) => problem.message)
            .join('；');
      });
      return;
    }

    try {
      ref.read(facilityBookingsProvider.notifier).book(
            venueId: venue.id,
            date: widget.date,
            slot: widget.slot,
            partySize: people,
            note: _note.text,
          );
      if (!mounted) return;
      context.pop(true);
    } on FacilityBookingException catch (error) {
      if (!mounted) return;
      setState(() {
        _peopleError = null;
        _submitError = error.userMessage;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.userMessage)),
      );
    }
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
    final List<FacilityBooking> bookings =
        ref.watch(facilityVenueBookingsProvider(venue.id));
    final FacilityBooking? conflict = findFacilityBookingConflict(
      venueId: venue.id,
      date: widget.date,
      slot: widget.slot,
      bookings: bookings,
    );
    final FacilitySlotState slotState = facilitySlotState(
      venueId: venue.id,
      date: widget.date,
      slot: widget.slot,
      bookings: bookings,
      now: now,
    );
    final bool blocked = conflict != null;
    final String? blockingMessage = conflict != null
        ? describeFacilityBookingConflict(conflict)
        : slotState == FacilitySlotState.past
            ? '这个时段已经开始，不能再预约了。'
            : _submitError;

    return KedaYaPageScaffold(
      title: '确认预约',
      padding: EdgeInsets.zero,
      child: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          const FacilityDemoNotice(),
          const SizedBox(height: KedaYaTokens.space3),
          _BookingSummary(
            venue: venue,
            date: widget.date,
            slot: widget.slot,
            now: now,
          ),
          const SizedBox(height: KedaYaTokens.space4),
          if (blockingMessage != null) ...<Widget>[
            _NoticeBox(message: blockingMessage, blocked: blocked),
            const SizedBox(height: KedaYaTokens.space3),
          ],
          _Label(text: '使用人数（1–10）'),
          TextField(
            controller: _people,
            keyboardType: TextInputType.number,
            inputFormatters: <TextInputFormatter>[
              FilteringTextInputFormatter.digitsOnly,
            ],
            maxLength: 2,
            onChanged: (String _) {
              if (_peopleError != null) {
                setState(() => _peopleError = null);
              }
            },
            decoration: InputDecoration(
              hintText: '1',
              helperText: '同一时段的人数可以一次填完',
              errorText: _peopleError,
              counterText: '',
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _Label(text: '备注（可选）'),
          TextField(
            controller: _note,
            maxLines: 3,
            maxLength: facilityNoteMaxLength,
            onChanged: (String _) {
              if (_submitError != null) {
                setState(() => _submitError = null);
              }
            },
            decoration: const InputDecoration(
              hintText: '例如：带了两副球拍 / 需要白板笔',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '同一场馆、同一时段只能有一条预约（包括你自己已经约过的）。'
            '取消后时段会立即释放；这里不会真的锁定场馆。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightLoose,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space5),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: blocked || slotState == FacilitySlotState.past
                  ? null
                  : () => _submit(venue),
              icon: const Icon(Icons.check, size: 18),
              label: const Text('提交预约'),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          Center(
            child: TextButton(
              onPressed: () => context.pop(),
              child: const Text('返回'),
            ),
          ),
        ],
      ),
    );
  }
}

class _BookingSummary extends StatelessWidget {
  const _BookingSummary({
    required this.venue,
    required this.date,
    required this.slot,
    required this.now,
  });

  final FacilityVenue venue;
  final DateTime date;
  final FacilitySlot slot;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return FacilityInfoPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                facilityVenueIcon(venue.id),
                size: 20,
                color: colors.brandStrong,
              ),
              const SizedBox(width: KedaYaTokens.space2),
              Expanded(
                child: Text(
                  venue.name,
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
            '${formatFacilityDateWithWeekday(date)} · ${slot.label}',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              fontWeight: KedaYaTokens.fontWeightMedium,
              color: colors.text,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            '${formatFacilityRelativeDay(date, now)} · ${venue.location}',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}

class _Label extends StatelessWidget {
  const _Label({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: KedaYaTokens.space2),
      child: Text(
        text,
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeSm,
          fontWeight: KedaYaTokens.fontWeightSemibold,
          color: context.kedayaColors.text,
        ),
      ),
    );
  }
}

class _NoticeBox extends StatelessWidget {
  const _NoticeBox({required this.message, required this.blocked});

  final String message;
  final bool blocked;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final Color tone = blocked ? colors.danger : colors.warning;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
        border: Border.all(color: tone.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            blocked ? Icons.block_outlined : Icons.error_outline,
            size: 18,
            color: tone,
          ),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                height: KedaYaTokens.lineHeightNormal,
                color: tone,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
