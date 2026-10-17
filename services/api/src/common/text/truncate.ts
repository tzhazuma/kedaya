/**
 * 文本截断（服务端通用）。
 *
 * 为什么单独一个文件：`telemetry`（崩溃栈 / 错误消息）和 `reports`（举报快照 / 补充说明）
 * 都要用它，而**两处各写一遍是最容易出事的地方** —— 其中一个写成 `slice(0, n)`
 * 就会把 emoji / 中文代理对切成乱码，而这种 bug 只在特定输入下出现、测试很容易漏掉。
 *
 * 按**码点**（而不是 UTF-16 code unit）截断：`'🦆'.length === 2`，
 * 用 `slice` 会切出半个字符。
 */
export function truncateByCodePoint(text: string, max: number): string {
  const points = [...text];
  return points.length <= max ? text : `${points.slice(0, max).join('')}…`;
}
