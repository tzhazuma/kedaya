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
npm run test -w @kedaya/shared     # 31 个测试
```

覆盖：金额往返一致性、非法输入拒绝、相对时间过去/未来分支、
上科大邮箱**后缀伪造**拒绝、PII 识别、码点长度、Result 各分支。
