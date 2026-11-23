<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 校园活动导入（`/import#campus-activities`）

- **无状态**：Web 暂无真实登录。候选/确认只存在当前页面内存里，刷新即清空；不写
  localStorage、不调用日程/提醒接口、不显示「已加入日程」这类假成功。唯一出口是
  下载 ICS / JSON。
- **确认门**：抽取结果一律 `status: 'candidate'`；只有用户逐条点「确认用于本次导出」
  后才进入 ICS / JSON。编辑已确认条目会退回 `candidate`，必须重新确认。
- **共享真相**：类型与枚举来自 `@kedaya/contracts` 的 `activities.ts`；抽取、证据截断、
  ICS 复用 `@kedaya/shared` 的 `activities-extract` / `activities-ics`。Web 只做
  来源/状态/稳定 id 适配与「相邻行合并」（时间与地点被公众号拆成两行时）。
- **时间**：字段存 UTC ISO；`datetime-local` 与展示显式按 `Asia/Shanghai` 换算
  （`domain/models/activities.ts`）。原文只有日期时保留
  `registrationDeadlineRaw`，`registrationDeadlineAt` 必须为 `null`，不得补 23:59。
- **微信边界**：只处理用户主动给的**单篇** `https://mp.weixin.qq.com/s/…` 链接
  （`data/api/wechat-article.ts` → 现有公开 `POST /wechat/article`）或用户粘贴的正文。
  不自动发现、不批量抓取历史文章、不绕过验证；正文只在本机内存里停留，抽取后立即清空。
- **隐私**：只保留活动字段 + ≤200 字证据片段；证据里的 URL 也会去掉会话参数。
  不存邮件正文/附件或公众号全文。
- **导出清洗**：JSON / ICS 都走同一个 `sanitizeActivityForExport`：`registrationUrl` /
  `sourceUrl` 去掉会话参数，证据重新截到 200 字。用户编辑链接后也不能把 token 带出去。
- **失败恢复**：正文抽取失败时 textarea 保留原文（`submitPastedText` 的 `draft`），
  只有成功才清空；没有候选时提供「手动新增活动」（`source: 'manual'` 的空白候选，
  仍需确认），并明确提示可改正文后重试。导出失败用 `role="alert"` 报告并清掉上一次成功提示。
- **UI**：语义 form/label、提交时才阻断并显示 `role="alert"` 错误、成功用
  `role="status"`；重复卡片用 `ul/li`；触摸目标 ≥44px、长 URL 换行、320px 不溢出。
  不引入 antd。
