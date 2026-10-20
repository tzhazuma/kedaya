'use client';

import { useMemo, useRef, useState } from 'react';

import { KdyButton } from '@/presentation/components/KdyButton';

import {
  describeFailure,
  IMPORT_PLATFORMS,
  readAssignments,
  readCourseList,
  readEamsTimetable,
  toIcs,
  type ImportCourse,
  type ImportedDeadline,
  type ImportPlatform,
} from './logic';



/**
 * 课程 DDL 导入器。
 *
 * ## 为什么在浏览器里做
 *
 * 解析需要**完整页面 HTML**。小程序没有文件选择器，浏览器有。
 * 而且这条路径**不需要服务端存任何凭据**，也不需要后端抓取 ——
 * HTML 是用户自己给我们的。
 *
 * ## 三步
 * 1. 选平台
 * 2. Gradescope / Blackboard：先给课程列表页，选课，再给作业页；EAMS 一步
 * 3. 结果导出 ICS（进日历）或 JSON（带回手机）
 */
export function DeadlineImport(): React.ReactElement {
  const [platform, setPlatform] = useState<ImportPlatform>('gradescope');
  const [courseHtml, setCourseHtml] = useState('');
  const [courseUrl, setCourseUrl] = useState('');
  const [courses, setCourses] = useState<readonly ImportCourse[]>([]);
  const [pickedCourse, setPickedCourse] = useState<ImportCourse | null>(null);
  const [assignHtml, setAssignHtml] = useState('');
  const [semester, setSemester] = useState('');
  const [items, setItems] = useState<readonly ImportedDeadline[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const courseFileRef = useRef<HTMLInputElement>(null);
  const assignFileRef = useRef<HTMLInputElement>(null);

  const platformMeta = useMemo(
    () => IMPORT_PLATFORMS.find((p) => p.id === platform) ?? IMPORT_PLATFORMS[0]!,
    [platform],
  );

  function reset(): void {
    setCourseHtml('');
    setCourseUrl('');
    setCourses([]);
    setPickedCourse(null);
    setAssignHtml('');
    setItems([]);
    setMessage(null);
    setError(null);
  }

  async function readFile(file: File, apply: (text: string) => void): Promise<void> {
    // 只接受 HTML —— 别让用户把 PDF 拖进来然后困惑
    if (!/\.html?$/i.test(file.name)) {
      setError(`「${file.name}」不是网页文件。请在浏览器里「另存为 → 网页，仅 HTML」。`);
      return;
    }
    apply(await file.text());
    setError(null);
  }

  function handleParseCourses(): void {
    if (platform === 'eams') {
      const result = readEamsTimetable(courseHtml, semester || 'unknown');
      if (!result.ok) {
        setError(describeFailure(result.failure));
        return;
      }
      setItems(result.value);
      setMessage(`解析到 ${result.value.length} 门课程。注意：课表是**上课时间**，不是作业截止。`);
      setError(null);
      return;
    }

    const result = readCourseList(platform, courseHtml, courseUrl);
    if (!result.ok) {
      setError(describeFailure(result.failure));
      return;
    }
    setCourses(result.value);
    setPickedCourse(null);
    setItems([]);
    setMessage(`找到 ${result.value.length} 门课程，请选一门再导入它的作业页。`);
    setError(null);
  }

  function handleParseAssignments(): void {
    if (pickedCourse === null) {
      setError('请先选一门课程');
      return;
    }
    const course = courses.find((c) => c.id === pickedCourse.id);
    if (course === undefined) {
      setError('课程信息丢失，请重新解析课程列表');
      return;
    }
    const result = readAssignments(platform as 'gradescope' | 'blackboard', assignHtml, course as never, {
      now: new Date(),
    });
    if (!result.ok) {
      setError(describeFailure(result.failure));
      return;
    }
    setItems(result.value);
    setMessage(`解析到 ${result.value.length} 条截止日期。`);
    setError(null);
  }

  function download(filename: string, content: string, mime: string): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ---- 平台 ---- */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">1. 选平台</h2>
        <div className="flex flex-wrap gap-2">
          {IMPORT_PLATFORMS.map((p) => (
            <KdyButton
              key={p.id}
              size="sm"
              variant={p.id === platform ? 'primary' : 'secondary'}
              onClick={() => {
                setPlatform(p.id);
                reset();
              }}
            >
              {p.label}
            </KdyButton>
          ))}
        </div>
        <p className="text-xs text-neutral-500">{platformMeta.hint}</p>
      </section>

      {/* ---- 页面输入 ---- */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">
          2. {platform === 'eams' ? '粘贴课表页' : '粘贴课程列表页'}
        </h2>

        {platform !== 'eams' && (
          <input
            className="rounded border px-2 py-1 text-sm"
            placeholder="页面地址（如 https://www.gradescope.com/）"
            value={courseUrl}
            onChange={(e) => setCourseUrl(e.target.value)}
          />
        )}
        {platform === 'eams' && (
          <input
            className="rounded border px-2 py-1 text-sm"
            placeholder="学期，如 2026-2027-1"
            value={semester}
            onChange={(e) => setSemester(e.target.value)}
          />
        )}

        <textarea
          className="h-32 rounded border p-2 font-mono text-xs"
          placeholder="把「另存为网页」得到的 HTML 全文粘到这里，或点下面的「选择文件」"
          value={courseHtml}
          onChange={(e) => setCourseHtml(e.target.value)}
        />
        <div className="flex gap-2">
          <input
            ref={courseFileRef}
            type="file"
            accept=".html,.htm"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file, setCourseHtml);
            }}
          />
          <KdyButton size="sm" variant="secondary" onClick={() => courseFileRef.current?.click()}>
            选择文件
          </KdyButton>
          <KdyButton size="sm" onClick={handleParseCourses}>
            {platform === 'eams' ? '解析课表' : '解析课程列表'}
          </KdyButton>
        </div>
      </section>

      {/* ---- 选课 + 作业页 ---- */}
      {platform !== 'eams' && courses.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">3. 选课并导入作业页</h2>
          <select
            className="rounded border px-2 py-1 text-sm"
            value={pickedCourse?.id ?? ''}
            onChange={(e) => {
              const found = courses.find((c) => c.id === e.target.value) ?? null;
              setPickedCourse(found);
            }}
          >
            <option value="">— 选一门课 —</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>

          <textarea
            className="h-32 rounded border p-2 font-mono text-xs"
            placeholder="这门课的作业页 HTML"
            value={assignHtml}
            onChange={(e) => setAssignHtml(e.target.value)}
          />
          <div className="flex gap-2">
            <input
              ref={assignFileRef}
              type="file"
              accept=".html,.htm"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void readFile(file, setAssignHtml);
              }}
            />
            <KdyButton size="sm" variant="secondary" onClick={() => assignFileRef.current?.click()}>
              选择文件
            </KdyButton>
            <KdyButton size="sm" onClick={handleParseAssignments}>
              解析作业
            </KdyButton>
          </div>
        </section>
      )}

      {/* ---- 提示 ---- */}
      {message !== null && <p className="text-xs text-neutral-600">{message}</p>}
      {error !== null && <p className="text-xs text-red-600">{error}</p>}

      {/* ---- 结果 ---- */}
      {items.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">4. 结果（{items.length} 条）</h2>
          <ul className="flex flex-col gap-1 text-xs">
            {items.map((item) => (
              <li key={item.id} className="rounded border px-2 py-1">
                <span className="font-medium">{item.title}</span>
                {item.dueText !== '' && (
                  <span className="ml-2 text-neutral-500">截止：{item.dueText}</span>
                )}
                {item.dueAt === null && (
                  <span className="ml-2 text-amber-600">（没有明确截止时刻，不会导出到日历）</span>
                )}
              </li>
            ))}
          </ul>

          <div className="flex gap-2">
            <KdyButton
              size="sm"
              onClick={() => download('kedaya-deadlines.ics', toIcs(items, '可达鸭 DDL', new Date()), 'text/calendar')}
            >
              导出日历（ICS）
            </KdyButton>
            <KdyButton
              size="sm"
              variant="secondary"
              onClick={() =>
                download('kedaya-deadlines.json', JSON.stringify(items, null, 2), 'application/json')
              }
            >
              导出 JSON（带回手机）
            </KdyButton>
          </div>
          <p className="text-xs text-neutral-500">
            ICS 可直接导入系统日历；JSON 可以带回小程序导入。没有明确截止时刻的条目不会进日历 —— 不编时间。
          </p>
        </section>
      )}
    </div>
  );
}
