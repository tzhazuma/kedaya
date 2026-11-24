/**
 * 真实 IMAP 连通性 / 活动识别探测。
 *
 * 用法（不要提交密码到仓库，用环境变量）：
 *   KEDAYA_MAIL_USER=... KEDAYA_MAIL_PASS=... node kd-imap-probe.mjs
 *
 * 只做三件事，不落库、不打印正文：
 *   1. 连 imap.shanghaitech.edu.cn:993（TLS）；
 *   2. 取收件箱最近 N 封的 envelope（主题/发件人/日期）；
 *   3. 用与服务端同一套关键词规则粗筛「可能是活动通知」的邮件，打印其主题。
 */
import { ImapFlow } from 'imapflow';

const host = process.env.KEDAYA_MAIL_HOST ?? 'imap.shanghaitech.edu.cn';
const port = Number(process.env.KEDAYA_MAIL_PORT ?? 993);
const user = process.env.KEDAYA_MAIL_USER;
const pass = process.env.KEDAYA_MAIL_PASS;
const limit = Number(process.env.KEDAYA_MAIL_LIMIT ?? 30);

if (!user || !pass) {
  console.error('缺少 KEDAYA_MAIL_USER / KEDAYA_MAIL_PASS');
  process.exit(2);
}

// 与服务端归一规则同源的粗筛：活动关键词 + 时间线索。
const ACTIVITY_WORDS = [
  '讲座', '论坛', 'workshop', 'seminar', '报名', '活动', '开放日',
  '招募', '宣讲', '比赛', '竞赛', '会议', '报告会', '沙龙', '培训',
];
const TIME_HINT = /(\d{1,2}\s*[:：]\s*\d{2})|(\d{1,2}\s*月\s*\d{1,2}\s*日)|(\d{4}-\d{1,2}-\d{1,2})/;

const client = new ImapFlow({
  host,
  port,
  secure: true,
  auth: { user, pass },
  logger: false,
  // 学校服务器证书链有时不完整，这里**不做**跳过校验的处理：
  // 连不上就是要看见连不上，不要用 tls.rejectUnauthorized=false 掩盖。
});

let step = 'connect';
try {
  await client.connect();
  console.log(`[ok] connect ${host}:${port} as ${user}`);

  step = 'list';
  const boxes = await client.list();
  console.log(`[ok] mailboxes=${boxes.length}`);

  step = 'open-inbox';
  const lock = await client.getMailboxLock('INBOX');
  try {
    const total = client.mailbox?.exists ?? 0;
    console.log(`[ok] INBOX exists=${total}`);

    if (total === 0) {
      console.log('[info] 收件箱为空，无法取样');
    } else {
      step = 'fetch';
      const from = Math.max(1, total - limit + 1);
      let scanned = 0;
      const hits = [];
      for await (const msg of client.fetch(`${from}:*`, {
        envelope: true,
        internalDate: true,
      })) {
        scanned += 1;
        const subject = msg.envelope?.subject ?? '';
        const text = `${subject} ${msg.envelope?.from?.[0]?.name ?? ''}`;
        const hasWord = ACTIVITY_WORDS.some((w) => text.toLowerCase().includes(w.toLowerCase()));
        if (hasWord || TIME_HINT.test(subject)) {
          hits.push({
            date: (msg.internalDate ?? new Date()).toISOString().slice(0, 10),
            subject,
          });
        }
      }
      console.log(`[ok] scanned=${scanned} activityLike=${hits.length}`);
      for (const hit of hits.slice(0, 15)) {
        console.log(`  · ${hit.date}  ${hit.subject.slice(0, 80)}`);
      }
    }
  } finally {
    lock.release();
  }
} catch (error) {
  console.error(`[fail] step=${step} ${error?.code ?? ''} ${error?.message ?? error}`);
  process.exitCode = 1;
} finally {
  try {
    await client.logout();
  } catch {
    /* 已断开 */
  }
}
