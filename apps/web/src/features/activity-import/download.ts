/**
 * 活动导出下载。
 *
 * 浏览器里最容易踩的两个坑都收在这里：
 * 1. anchor 必须先挂到 DOM 再 `click()`，否则部分浏览器（Safari / 移动端）不会触发下载；
 * 2. `click()` 后不能同步 `revokeObjectURL`，否则下载还没开始 blob URL 就被撤销了。
 *
 * DOM 依赖通过 `DownloadEnvironment` 注入，测试可以在 node 环境里锁住调用顺序与清理。
 */

/** 延迟撤销 blob URL 的时间：给浏览器留出开始下载的窗口 */
export const DOWNLOAD_REVOKE_DELAY_MS = 1_000;

export interface DownloadEnvironment {
  readonly createObjectURL: (blob: Blob) => string;
  readonly scheduleRevoke: (url: string) => void;
  readonly createAnchor: () => HTMLAnchorElement;
  readonly appendAnchor: (anchor: HTMLAnchorElement) => void;
  readonly removeAnchor: (anchor: HTMLAnchorElement) => void;
}

export function browserDownloadEnvironment(): DownloadEnvironment {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    scheduleRevoke: (url) => {
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // 浏览器已经释放或环境不支持；不影响已经触发的下载
        }
      }, DOWNLOAD_REVOKE_DELAY_MS);
    },
    createAnchor: () => document.createElement('a'),
    appendAnchor: (anchor) => {
      document.body.appendChild(anchor);
    },
    removeAnchor: (anchor) => {
      anchor.remove();
    },
  };
}

/**
 * 触发一次文本文件下载。
 *
 * 任何一步抛错都会向上抛给调用方（组件负责转成 `role="alert"` 的导出错误），
 * 但已经创建的 blob URL 一定会被安排撤销，不把内存留在页面上。
 */
export function triggerDownload(
  filename: string,
  content: string,
  mime: string,
  env: DownloadEnvironment = browserDownloadEnvironment(),
): void {
  const blob = new Blob([content], { type: mime });
  const url = env.createObjectURL(blob);
  const anchor = env.createAnchor();
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';

  try {
    env.appendAnchor(anchor);
    anchor.click();
  } finally {
    try {
      env.removeAnchor(anchor);
    } finally {
      env.scheduleRevoke(url);
    }
  }
}
