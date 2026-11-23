# @kedaya/shared

可达鸭**三端共享纯工具**。零框架依赖，纯 TypeScript。

## 硬约束

> 本包**不得**依赖任何框架 —— 无 React、无 Taro、无 Nest、无 Flutter 绑定。
> 只允许纯 TS 逻辑，以便 Web、微信小程序、Node 后端共用同一份实现。
> 这样同一段金额/时间逻辑不需要在三个语言里各写一遍（并各自写错）。

## API

### `Result` —— 显式错误通道

跨端统一的成功/失败形状，替代不一致的 `throw` / `catch`（小程序里异常栈很不可靠）。

```ts
import { ok, err, isOk, isErr, mapResult, mapErr, unwrapOr, assertNever } from '@kedaya/shared';

const r = await fetchOrder(id);
if (isErr(r)) return showError(r.error);
render(r.value);

mapResult(r, (o) => o.title);     // 只映射成功分支
unwrapOr(r, fallbackOrder);       // 取回退值
```

`assertNever` 用于 `switch` 的 `default` 分支，漏掉分支会**编译报错**：

```ts
switch (order.status) {
  case 'open':    return '可参团';
  case 'full':    return '已满';
  // 新增状态却忘了处理 → 编译失败
  default:        return assertNever(order.status);
}
```

### 金额 —— 全链路整数分

> **浮点绝不参与金额运算。** 传输层一律整数分，只在展示层转元。

```ts
import { fenToYuan, yuanToFen, fenToSignedYuan, isValidFen } from '@kedaya/shared';

fenToYuan(12345);        // '123.45'
yuanToFen('123.45');     // 12345
fenToSignedYuan(-12345); // '-123.45'
isValidFen(1.5);         // false
```

非法输入抛 `TypeError`（不静默返回 `NaN`）。往返一致性有测试覆盖。

### 时间 —— 传输 ISO-8601 UTC，展示才本地化

```ts
import { formatRelativeTime, formatDeadline, toIso, isSameDay, toDateKey } from '@kedaya/shared';

formatRelativeTime('2026-10-16T11:57:00Z', now);  // '3 分钟前'
formatRelativeTime('2026-10-16T12:05:00Z', now);  // '5 分钟后'
formatDeadline('2026-10-16T15:00:00Z', now);      // '还有 3 小时'
formatDeadline('2026-10-16T11:00:00Z', now);      // '已截止'
toDateKey(new Date(2026, 0, 5));                  // '2026-01-05'
```

### 校园活动 —— 抽取 / ICS / 默认提醒

```ts
import {
  extractActivityCandidates, truncateActivityEvidence, truncateActivityField,
  redactSessionUrlsInText, sanitizeSourceUrl,
  buildActivityIcs, computeActivityReminders,
} from '@kedaya/shared';

// 单篇公众号正文 → 候选（无可靠时间不产出；证据 ≤200 字）
// · 时间与地点分行也能抽；空行/小标题分段，同文多活动不串台
// · 裸「截止时间」产出仅报名截止候选；报名窗口起点不当作活动开始
// · 缺年份的过去日期留在今年，不顺延到明年（避免凭空造出未来活动）
// · 标题/地点/主办按 OpenAPI 的 160 字上限、按码点截断
const candidates = extractActivityCandidates(article, { now, timeZone: 'Asia/Shanghai' });

// 证据里的 URL 统一走 sanitizeSourceUrl：剥掉 sid/token/scene/chksm/srcid/
// exportkey/signature/sig/key 等会话参数后再进 DB / ICS / 三端响应。
const safeEvidence = redactSessionUrlsInText(rawEvidence);

// 只有 confirmed 的活动能导出；没有开始时间但有报名截止 → 导出「报名截止」事件。
// 零时长省略 DTEND（RFC 5545 要求 DTEND 晚于 DTSTART）；URL 是 URI 值不按 TEXT 转义；
// 描述里的报名截止按 Asia/Shanghai 展示；重复 id 只导出一次。
const ics = buildActivityIcs(items, { calendarName: '可达鸭活动', now });

// 报名截止前 24h、开始前 1h；目标已过不建；计算时刻已过 → now + 5min（不晚于目标）。
// ICS 的 VALARM 复用同一套 clamp 语义。
const reminders = computeActivityReminders(item, { now });
```

### 校验 —— 上科大身份

```ts
import {
  isShanghaiTechEmail, emailDomain, isStudentId, isChinaMobile,
  containsLikelyPii, isLengthWithin, slugify,
} from '@kedaya/shared';

isShanghaiTechEmail('a@stu.shanghaitech.edu.cn');  // true
isShanghaiTechEmail('a@shanghaitech.edu.cn.evil.com');  // false（后缀伪造被拒）
isStudentId('20261234');                           // true
containsLikelyPii('联系我 13800138000');            // true —— 发帖前提示
isLengthWithin('可达鸭', 1, 5);                     // true（按码点计，中文算 1 个）
```

> ⚠️ 这些是**前端预校验**，只为即时反馈。权威校验必须在后端。

## 测试

```bash
npm run test -w @kedaya/shared     # 全部单测
```

覆盖：金额往返一致性、非法输入拒绝、相对时间过去/未来分支、
上科大邮箱**后缀伪造**拒绝、PII 识别、码点长度、Result 各分支。
