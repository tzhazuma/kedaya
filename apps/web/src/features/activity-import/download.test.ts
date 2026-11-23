import { describe, expect, it } from 'vitest';

import { triggerDownload, type DownloadEnvironment } from './download';

/**
 * 下载 anchor 的生命周期。
 *
 * 浏览器里最常见的两个坑：
 * - anchor 没有挂到 DOM 就 `click()`：部分浏览器（尤其 Safari / 移动端）不会触发下载；
 * - `click()` 后同步 `revokeObjectURL`：下载还没开始就把 blob URL 撤销了。
 * 这里用可注入的 DOM 环境把顺序与清理固定下来。
 */
function makeAnchor(events: string[], onClick?: () => void): HTMLAnchorElement {
  return {
    href: '',
    download: '',
    rel: '',
    style: { display: '' },
    click: () => {
      events.push('click');
      onClick?.();
    },
    remove: () => events.push('remove'),
  } as unknown as HTMLAnchorElement;
}

function makeEnv(
  events: string[],
  overrides: Partial<DownloadEnvironment> = {},
): DownloadEnvironment {
  return {
    createObjectURL: () => 'blob:demo',
    scheduleRevoke: (url) => events.push(`revoke:${url}`),
    createAnchor: () => makeAnchor(events),
    appendAnchor: () => events.push('append'),
    removeAnchor: () => events.push('remove'),
    ...overrides,
  };
}

describe('triggerDownload', () => {
  it('先挂 DOM 再 click，click 后移除 anchor 并安排延迟 revoke', () => {
    const events: string[] = [];
    const anchor = makeAnchor(events);
    const env = makeEnv(events, { createAnchor: () => anchor });

    triggerDownload('kedaya-activities.json', '{"ok":true}', 'application/json', env);

    expect(events).toEqual(['append', 'click', 'remove', 'revoke:blob:demo']);
    expect(anchor.href).toBe('blob:demo');
    expect(anchor.download).toBe('kedaya-activities.json');
    expect(anchor.rel).toBe('noopener');
    expect(anchor.style.display).toBe('none');
  });

  it('click 抛错时仍移除 anchor、安排 revoke，并把错误交给调用方', () => {
    const events: string[] = [];
    const env = makeEnv(events, {
      createAnchor: () =>
        makeAnchor(events, () => {
          throw new Error('download blocked');
        }),
    });

    expect(() =>
      triggerDownload('kedaya-activities.ics', 'BEGIN:VCALENDAR', 'text/calendar', env),
    ).toThrow('download blocked');
    expect(events).toEqual(['append', 'click', 'remove', 'revoke:blob:demo']);
  });

  it('生成 blob URL 失败时不创建 anchor，错误交给调用方', () => {
    const events: string[] = [];
    let anchorCreated = false;
    const env = makeEnv(events, {
      createObjectURL: () => {
        throw new Error('blob unavailable');
      },
      createAnchor: () => {
        anchorCreated = true;
        return makeAnchor(events);
      },
    });

    expect(() => triggerDownload('a.json', '{}', 'application/json', env)).toThrow(
      'blob unavailable',
    );
    expect(anchorCreated).toBe(false);
    expect(events).toEqual([]);
  });

  it('append 抛错时仍安排 revoke，避免 blob URL 泄漏', () => {
    const events: string[] = [];
    const env = makeEnv(events, {
      appendAnchor: () => {
        events.push('append');
        throw new Error('body unavailable');
      },
    });

    expect(() => triggerDownload('a.json', '{}', 'application/json', env)).toThrow(
      'body unavailable',
    );
    expect(events).toEqual(['append', 'remove', 'revoke:blob:demo']);
  });
});
