/**
 * 课程 DDL · ICS 日历导出（纯函数，三端共用）
 *
 * ## 为什么这个功能值得做
 *
 * 它是 DDL 模块里**唯一不需要任何平台凭据**的"输出侧"能力：
 * 把我们已经聚合好的截止日期渲染成 `text/calendar`，
 * 用户把它订阅进系统日历，DDL 就出现在他每天真正会看的地方。
 *
 * 这条思路参考了 GeekPie 的 `NextDDL`（**无许可证，只学功能，未复制代码**）。
 * 功能本身不受版权保护；实现见 `docs/architecture/11-geekpie-repos-analysis.md`。
 *
 * ## 三条实现约束（都是踩过的坑）
 *
 * 1. **行分隔符必须是 CRLF**（RFC 5545 §3.1）。用 `\n` 的 ICS 在
 *    Apple 日历 / Outlook 上会被整份拒绝，而某些宽松的解析器却能读 ——
 *    于是"我这儿好的"和"他那儿全空"同时成立，极难排查。
 * 2. **每行不得超过 75 个**字节**（不是字符）**。超出要折行：
 *    续行以一个空格开头。中文一个字 3 字节，75 字节约 25 个汉字。
 *    按字符数折行会让中文日历条目被截断在奇怪的位置。
 * 3. **文本必须转义**：`\` → `\\`、`;` → `\;`、`,` → `\,`、换行 → `\n`。
 *    标题里有逗号（"作业 3, 第四章"）时不转义会让字段提前结束。
 *
 * 另外：**全天 vs 定时**。有具体时刻的用 `DTSTART`（带时区），
 * 只有日期的用 `VALUE=DATE`。混用会让事件在错误的时间提醒。
 */

/** ICS 输入条目 —— 只依赖本模块，**不** import 契约包（shared 是零依赖叶子包） */
export interface IcsDeadlineInput {
  readonly id: string;
  readonly title: string;
  readonly courseName: string | null;
  /** 绝对时刻 ISO 串。没有截止时刻的条目会被跳过（不能编一个） */
  readonly dueAt: string;
  readonly sourceLabel: string;
  readonly submitted: boolean;
}

export interface IcsBuildOptions {
  /** 日历名（显示在用户的日历列表里） */
  readonly calendarName: string;
  /** 生成时刻，用于 DTSTAMP；不传则用 `new Date()` */
  readonly now?: Date;
  /** 跳过已提交的条目（默认 true —— 已交的作业不该再提醒） */
  readonly skipSubmitted?: boolean;
}

/** 每行最多 75 **字节**（RFC 5545 §3.1） */
const MAX_LINE_BYTES = 75;

/** 按 UTF-8 **字节**数折行，续行以空格开头 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= MAX_LINE_BYTES) return line;

  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  // 续行开头有一个空格，占 1 字节，所以后续行可用 74 字节
  let limit = MAX_LINE_BYTES;

  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    if (currentBytes + charBytes > limit) {
      out.push(current);
      current = char;
      currentBytes = charBytes;
      limit = MAX_LINE_BYTES - 1; // 续行留给前导空格
    } else {
      current += char;
      currentBytes += charBytes;
    }
  }
  if (current.length > 0) out.push(current);

  return out.map((part, index) => (index === 0 ? part : ` ${part}`)).join('\r\n');
}

/** RFC 5545 文本转义 */
function escapeText(raw: string): string {
  return raw
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Date → `20261020T155900Z`（UTC，ICS 的基本时刻格式） */
function toIcsUtc(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    String(date.getUTCFullYear()) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

/**
 * 生成 ICS 文本。
 *
 * @returns ICS 字符串（CRLF 行分隔）。没有可导出条目时仍返回一个合法但空的日历
 *          —— 返回空字符串会让日历订阅端报"无效订阅"，比"空日历"更糟。
 */
export function buildDeadlineIcs(
  items: readonly IcsDeadlineInput[],
  options: IcsBuildOptions,
): string {
  const skipSubmitted = options.skipSubmitted ?? true;
  const now = options.now ?? new Date();
  const stamp = toIcsUtc(now);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KedaYa//Deadlines//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.calendarName)}`,
  ];

  for (const item of items) {
    if (skipSubmitted && item.submitted) continue;

    const dueMs = Date.parse(item.dueAt);
    if (Number.isNaN(dueMs)) continue; // 没有可解析的截止时刻 → 不编一个

    const due = new Date(dueMs);
    const descriptionParts: string[] = [];
    if (item.courseName !== null && item.courseName.trim() !== '') {
      descriptionParts.push(`课程：${item.courseName}`);
    }
    descriptionParts.push(`来源：${item.sourceLabel}`);
    descriptionParts.push('由可达鸭聚合（第三方非官方平台）');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(item.id)}@kedaya`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsUtc(due)}`,
      // 默认按"截止时刻前提醒"处理：事件本身零时长，结束时间同开始
      `DTEND:${toIcsUtc(due)}`,
      `SUMMARY:${escapeText(item.title)}`,
      `DESCRIPTION:${escapeText(descriptionParts.join('\n'))}`,
      // 截止前 1 小时提醒（-PT1H）。日历端会各自再加自己的默认提醒。
      'BEGIN:VALARM',
      'TRIGGER:-PT1H',
      'ACTION:DISPLAY',
      'DESCRIPTION:截止提醒',
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');

  // ⚠️ 折叠在最后统一做，且**必须**在拼接前逐行折叠 —— 先拼再折会把 CRLF 也折进去
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/**
 * 判断一段文本是不是一个可用的 ICS（给"导入"场景用）。
 *
 * 保守：必须同时有 `BEGIN:VCALENDAR` 与 `END:VCALENDAR`。
 */
export function looksLikeIcs(text: string): boolean {
  return text.includes('BEGIN:VCALENDAR') && text.includes('END:VCALENDAR');
}
