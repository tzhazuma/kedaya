import { QueryClient } from '@tanstack/react-query';

/**
 * TanStack Query 的全局配置（**独立于 React 组件**，因此可被单元测试直接断言）。
 *
 * 单独成文件的原因：`providers.tsx` 含 JSX，而本仓 vitest 的 esbuild 配置继承了
 * tsconfig 的 `jsx: preserve`，测试里 import 含 JSX 的文件会解析失败。
 * 把纯配置抽出来，就能在不渲染 React 的前提下把配置钉住 ——
 * 下面那条 `networkMode` 是一个**真实缺陷的修复**，必须有测试守着。
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,

        /**
         * ⚠️ **`networkMode: 'always'` 是刻意的，不要删。**
         *
         * 默认值 `'online'` 让查询在"浏览器认为离线"或**标签页不可见**时进入
         * **paused**：TanStack Query 的重试器用
         * `focusManager.isFocused() && onlineManager.isOnline()` 决定是否继续。
         *
         * 后果（两个团队各自独立复现过）：**标签页在后台时请求失败 → 重试永久暂停 →
         * UI 永远停在骨架屏**，既不出错误态、也不出重试按钮。
         * 用户看到的是"一直在加载"，而契约 §8 要求的是"失败静默降级为错误态 UI"。
         *
         * 实测：既有 `/groupbuy` 与新增的 `/wildlife`、`/buddy` 表现完全一致 ——
         * 这是**全局既有缺陷**，不是某个模块引入的。
         *
         * 为什么选 `'always'` 而不是给 `focusManager` 打补丁：
         * - 我们本来就要在后台标签页里完成请求（用户切走再切回来不该看到卡住的骨架屏）；
         * - `'always'` 是官方为此提供的语义，比"伪造 focus 状态"更直白；
         * - 它不影响 `refetchOnWindowFocus: false`（那是另一回事）。
         *
         * 代价：离线时不再自动暂停，会真的发出请求并失败 —— 这正是我们要的
         * （失败要变成**错误态 UI**，而不是一个永远不结束的 loading）。
         */
        networkMode: 'always',
      },
      mutations: {
        retry: 0,
        // 同理：写操作也不能因为标签页不可见就永久挂起（用户会以为没提交成功）
        networkMode: 'always',
      },
    },
  });
}
