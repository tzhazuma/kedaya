import { describe, expect, it } from 'vitest';
import type { MessageStructureObject } from 'imapflow';
import { findBodyPart, htmlToText } from './mail-imap.adapter';

/**
 * IMAP 适配器的**纯函数**部分：不连网络也能测。
 *
 * 真正的连接/搜索/下载需要邮箱账号，本仓库没有测试账号；
 * 这部分测试保证"从 BODYSTRUCTURE 里挑正文"和"HTML 转文本"的规则正确。
 */

describe('findBodyPart', () => {
  it('多部分邮件优先 text/plain（即使 html 排在前面）', () => {
    const structure: MessageStructureObject = {
      type: 'multipart/alternative',
      childNodes: [
        { type: 'text/html', part: '1.1' },
        { type: 'text/plain', part: '1.2' },
      ],
    };

    expect(findBodyPart(structure, 'text/plain')?.part).toBe('1.2');
    expect(findBodyPart(structure, 'text/html')?.part).toBe('1.1');
  });

  it('跳过附件里的 text/plain', () => {
    const structure: MessageStructureObject = {
      type: 'multipart/mixed',
      childNodes: [
        { type: 'text/plain', part: '1' },
        { type: 'text/plain', part: '2', disposition: 'attachment' },
      ],
    };

    expect(findBodyPart(structure, 'text/plain')?.part).toBe('1');
  });

  it('没有 plain 时回退 html；都没有返回 undefined', () => {
    expect(
      findBodyPart(
        { type: 'multipart/alternative', childNodes: [{ type: 'text/html', part: '1' }] },
        'text/plain',
      ),
    ).toBeUndefined();
    expect(findBodyPart({ type: 'application/pdf' }, 'text/html')).toBeUndefined();
    expect(findBodyPart(undefined, 'text/plain')).toBeUndefined();
  });
});

describe('htmlToText', () => {
  it('去标签、保留段落换行、解码常见实体', () => {
    const text = htmlToText(
      '<html><body><p>Time: 2:00 PM</p><p>Location: Room 101 &amp; Hall B</p></body></html>',
    );
    expect(text).toContain('Time: 2:00 PM');
    expect(text).toContain('Location: Room 101 & Hall B');
    expect(text).not.toContain('<p>');
  });

  it('去掉 script / style，避免样式文本干扰时间识别', () => {
    const text = htmlToText(
      '<style>.x{color:red}</style><script>alert(1)</script><div>讲座时间：2026年10月20日 14:00</div>',
    );
    expect(text).toContain('2026年10月20日 14:00');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('alert(1)');
  });

  it('数字实体也能解码', () => {
    expect(htmlToText('A&#39;s &#x4E2D;&#x6587;')).toBe("A's 中文");
  });
});
