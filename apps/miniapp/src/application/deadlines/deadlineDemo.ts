import type { DeadlineItem } from '@kedaya/contracts'

/**
 * 演示数据 —— 只在用户主动点开「演示与调试工具」时出现，**永远不落本机 storage**。
 *
 * 为什么不写死几条 `dueAt`：演示的意义是「让人一眼看到今天 / 本周 / 已逾期长什么样」，
 * 写死的日期过两周就全变成「已逾期」，页面看起来像坏了。所以全部相对 `now` 生成。
 *
 * 为什么不落盘：这些不是用户的数据。混进本机缓存后，用户会以为真的有这几份作业，
 * 而清空时又分不清哪些是自己粘的。页面会把它们与真实条目分开渲染，并常驻「演示数据」标签。
 *
 * 标题与课程名都带「演示」字样 —— 截图 / 真机验收时不会被误当成真实作业。
 */
export function buildDemoDeadlineItems(now: Date): DeadlineItem[] {
  const at = (offsetMs: number): string => new Date(now.getTime() + offsetMs).toISOString()

  return [
    {
      id: 'demo-overdue',
      source: 'blackboard',
      kind: 'assignment',
      title: '【演示】作业 3：进程调度',
      courseId: 'demo:cs101',
      courseName: 'CS101 操作系统（演示）',
      dueAt: at(-3 * 60 * 60 * 1000),
      dueAtRaw: '演示数据 · 3 小时前截止',
      sourceUrl: '',
      submitted: false,
      weight: null,
    },
    {
      id: 'demo-today',
      source: 'gradescope',
      kind: 'assignment',
      title: '【演示】编程题集 4',
      courseId: 'demo:cs102',
      courseName: 'CS102 数据结构（演示）',
      dueAt: at(3 * 60 * 60 * 1000),
      dueAtRaw: '演示数据 · 3 小时后截止',
      sourceUrl: '',
      submitted: false,
      weight: null,
    },
    {
      id: 'demo-this-week',
      source: 'piazza',
      kind: 'quiz',
      title: '【演示】第 5 周小测',
      courseId: 'demo:cs201',
      courseName: 'CS201 算法（演示）',
      dueAt: at(2 * 24 * 60 * 60 * 1000),
      dueAtRaw: '演示数据 · 2 天后截止',
      sourceUrl: '',
      submitted: false,
      weight: null,
    },
    {
      id: 'demo-later',
      source: 'ecourse',
      kind: 'project',
      title: '【演示】课程项目开题',
      courseId: 'demo:cs301',
      courseName: 'CS301 软件工程（演示）',
      dueAt: at(10 * 24 * 60 * 60 * 1000),
      dueAtRaw: '演示数据 · 10 天后截止',
      sourceUrl: '',
      submitted: false,
      weight: null,
    },
    {
      id: 'demo-submitted',
      source: 'manual',
      kind: 'reading',
      title: '【演示】阅读：第 4 章',
      courseId: 'demo:cs101',
      courseName: 'CS101 操作系统（演示）',
      dueAt: at(1 * 24 * 60 * 60 * 1000),
      dueAtRaw: '演示数据 · 明天截止，已提交',
      sourceUrl: '',
      submitted: true,
      weight: null,
    },
  ]
}
