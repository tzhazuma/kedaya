/**
 * 真实邮件 → `extractEventFromMail`（服务端**实际使用**的抽取器）。
 *
 * 注意：不要用 `activities-extract` 的 `extractActivityCandidates` 来测邮箱路径 ——
 * 服务端邮件走的是 `services/api/src/modules/mail/domain/mail-event.domain.ts`，
 * 两者标题/时间规则不同。用错抽取器会得到「标题是『各位老师、同学们：』」这种假缺陷。
 *
 * 只打印主题与抽出的字段，不打印正文。
 */
import { ImapFlow } from 'imapflow';
import { extractEventFromMail } from '../services/api/src/modules/mail/domain/mail-event.domain.ts';

const host = process.env.KEDAYA_MAIL_HOST ?? 'imap.shanghaitech.edu.cn';
const user = process.env.KEDAYA_MAIL_USER;
const pass = process.env.KEDAYA_MAIL_PASS;
const limit = Number(process.env.KEDAYA_MAIL_LIMIT ?? 15);

if (!user || !pass) {
  console.error('缺少 KEDAYA_MAIL_USER / KEDAYA_MAIL_PASS');
  process.exit(2);
}

const ACTIVITY_WORDS = ['讲座', '论坛', 'seminar', '报名', '活动', '宣讲', '招募', '比赛', '沙龙', '研讨会'];

/* ---------- MIME ---------- */

const unfold = (h) => h.replace(/\r?\n[ \t]+/g, ' ');

function headerValue(headers, name) {
  return new RegExp(`^${name}:\\s*(.+)$`, 'im').exec(unfold(headers))?.[1]?.trim() ?? '';
}

function decodeQuotedPrintable(input) {
  const cleaned = input.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < cleaned.length; i += 1) {
    const hex = cleaned.slice(i + 1, i + 3);
    if (cleaned[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(cleaned.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

const decodeTransfer = (body, enc) => {
  const e = String(enc ?? '').toLowerCase();
  if (e === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (e === 'quoted-printable') return decodeQuotedPrintable(body);
  return body;
};

function splitParts(body, boundary) {
  return body.split(`--${boundary}`);
}

function extractText(headers, body, depth = 0) {
  if (depth > 4) return '';
  const ct = headerValue(headers, 'content-type');
  const enc = headerValue(headers, 'content-transfer-encoding');
  if (/^text\/html/i.test(ct) || /^text\/plain/i.test(ct)) return decodeTransfer(body, enc);
  const boundary = /boundary="?([^";]+)"?/i.exec(ct)?.[1];
  if (!boundary) return '';
  let html = '';
  let plain = '';
  for (const part of splitParts(body, boundary)) {
    const idx = part.indexOf('\r\n\r\n');
    if (idx < 0) continue;
    const ph = part.slice(0, idx);
    const pb = part.slice(idx + 4);
    const text = extractText(ph, pb, depth + 1);
    if (/^text\/html/i.test(headerValue(ph, 'content-type'))) html ||= text;
    else plain ||= text;
  }
  return html || plain;
}

const toText = (html) =>
  String(html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .trim();

/* ---------- 跑 ---------- */

const client = new ImapFlow({ host, port: 993, secure: true, auth: { user, pass }, logger: false });
await client.connect();
const lock = await client.getMailboxLock('INBOX');

try {
  const total = client.mailbox?.exists ?? 0;
  const from = Math.max(1, total - limit + 1);
  const picked = [];
  for await (const msg of client.fetch(`${from}:*`, { envelope: true, internalDate: true })) {
    const subject = msg.envelope?.subject ?? '';
    if (ACTIVITY_WORDS.some((w) => subject.includes(w))) {
      picked.push({ uid: String(msg.uid), subject, receivedAt: msg.internalDate ?? new Date() });
    }
  }
  console.log(`[ok] INBOX=${total}，活动相关 ${picked.length} 封`);

  let hit = 0;
  for (const item of picked) {
    const one = await client.fetchOne(item.uid, { source: true }, { uid: true });
    const raw = one?.source ? one.source.toString('utf8') : '';
    const cut = raw.indexOf('\r\n\r\n');
    const headers = raw.slice(0, cut);
    const body = raw.slice(cut + 4);
    const text = toText(extractText(headers, body));

    const event = extractEventFromMail(item.subject, text, item.receivedAt, 'Asia/Shanghai');
    if (event !== null) hit += 1;
    console.log(
      `\n【${item.subject.slice(0, 50)}】` +
        (event === null
          ? ' → 未识别为活动'
          : ` → ✅ ${event.title}\n     startsAt=${event.startsAt} location=${event.location ?? '—'} kind=${event.kind} conf=${event.confidence}`),
    );
  }
  console.log(`\n== ${picked.length} 封中 ${hit} 封识别为活动 ==`);
} finally {
  lock.release();
  await client.logout().catch(() => {});
}
