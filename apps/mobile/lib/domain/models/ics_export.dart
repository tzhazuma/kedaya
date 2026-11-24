/// iCalendar（RFC 5545）导出。
///
/// 只做我们真正需要的子集：`VEVENT` + 可选 `RRULE`，时间统一用 UTC（`Z` 后缀），
/// 因此不依赖 `VTIMEZONE` 定义，导入 iOS 日历 / Google 日历 / Outlook 都不会歧义。
///
/// 约束：
/// - 行尾必须是 CRLF；
/// - 逗号、分号、反斜杠、换行在文本字段里要转义；
/// - 单行超过 75 个八位组要折行（续行以空格开头）。这里按字符折行，
///   对中文（UTF-8 三字节）会比严格按八位组更保守，但任何客户端都能读。
library;

/// 一条日历事件。
final class IcsEvent {
  const IcsEvent({
    required this.uid,
    required this.summary,
    required this.startUtc,
    required this.endUtc,
    this.description,
    this.location,
    this.recurrence,
  });

  final String uid;
  final String summary;
  final DateTime startUtc;
  final DateTime endUtc;
  final String? description;
  final String? location;

  /// 例如 `FREQ=WEEKLY;BYDAY=MO;COUNT=16`。
  final String? recurrence;
}

const String _crlf = '\r\n';

/// 生成完整的 `.ics` 文本。
String buildIcs(List<IcsEvent> events, {DateTime? generatedAt}) {
  final DateTime stamp = (generatedAt ?? DateTime.now()).toUtc();
  final StringBuffer out = StringBuffer()
    ..write('BEGIN:VCALENDAR$_crlf')
    ..write('VERSION:2.0$_crlf')
    ..write('PRODID:-//KedaYa//Campus Calendar//CN$_crlf')
    ..write('CALSCALE:GREGORIAN$_crlf')
    ..write('METHOD:PUBLISH$_crlf')
    ..write('X-WR-CALNAME:可达鸭$_crlf');

  for (final IcsEvent event in events) {
    out
      ..write('BEGIN:VEVENT$_crlf')
      ..write('UID:${escapeIcsText(event.uid)}$_crlf')
      ..write('DTSTAMP:${formatIcsUtc(stamp)}$_crlf')
      ..write('DTSTART:${formatIcsUtc(event.startUtc)}$_crlf')
      ..write('DTEND:${formatIcsUtc(event.endUtc)}$_crlf')
      ..write('SUMMARY:${escapeIcsText(event.summary)}$_crlf');
    if (event.description != null && event.description!.trim().isNotEmpty) {
      out.write('DESCRIPTION:${escapeIcsText(event.description!)}$_crlf');
    }
    if (event.location != null && event.location!.trim().isNotEmpty) {
      out.write('LOCATION:${escapeIcsText(event.location!)}$_crlf');
    }
    if (event.recurrence != null && event.recurrence!.isNotEmpty) {
      out.write('RRULE:${event.recurrence}$_crlf');
    }
    out.write('END:VEVENT$_crlf');
  }

  out.write('END:VCALENDAR$_crlf');
  return foldIcsLines(out.toString());
}

/// `YYYYMMDDTHHMMSSZ`（UTC）。
String formatIcsUtc(DateTime instant) {
  final DateTime utc = instant.toUtc();
  String two(int v) => v.toString().padLeft(2, '0');
  return '${utc.year.toString().padLeft(4, '0')}${two(utc.month)}${two(utc.day)}'
      'T${two(utc.hour)}${two(utc.minute)}${two(utc.second)}Z';
}

/// 文本字段转义：反斜杠 → `\\`，分号 → `\;`，逗号 → `\,`，换行 → `\n`。
String escapeIcsText(String raw) => raw
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll('\r\n', '\\n')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\n');

/// 折行：每行最多 [maxChars] 个字符，续行以一个空格开头。
String foldIcsLines(String raw, {int maxChars = 73}) {
  final List<String> lines = <String>[];
  for (final String line in raw.split(_crlf)) {
    if (line.isEmpty) continue;
    String rest = line;
    bool first = true;
    while (rest.isNotEmpty) {
      final int take = first ? maxChars : maxChars - 1;
      final int end = rest.length <= take ? rest.length : take;
      final String chunk = rest.substring(0, end);
      lines.add(first ? chunk : ' $chunk');
      rest = rest.substring(end);
      first = false;
    }
  }
  return lines.join(_crlf) + _crlf;
}
