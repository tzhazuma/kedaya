/**
 * 统一课程 DDL · 抓取会话护栏（纯状态机）
 *
 * 这个文件只做两件事：把采集端上报的事件折叠成一份可展示的进度，
 * 以及在结果「看起来不可信」时给出**判定结论**。
 *
 * ## 三条护栏
 *
 * 1. **空结果保护** —— `shouldAcceptEmpty`。只有调用方明确确认「已经识别出本期
 *    课程范围」时，才允许把 0 条当成「本期没有作业」。读取异常绝不能被降级成
 *    「本期无课」：否则用户已经抓到的作业会凭空消失。
 * 2. **丢页保护** —— `isLossyCrawl`。失败页数超过已观测页数的一半时，这一轮数据
 *    残缺到不可用，结论是 `failed` 并建议保留上一次成功结果，而不是拿残页覆盖。
 * 3. **逐页累积** —— `nextProgress` 每收到一个 `page-ok` 就把 `parsed` 加一并重新
 *    生成进度。调用方可以在每页成功后立刻把该页已读内容合并进快照（落盘是调用方
 *    的事），这样尾页超时也不会回滚前面已经成功读到的页。
 *
 * ## 边界（重要）
 *
 * · **纯函数**：不发起网络请求、不读写存储、不读时钟、不产生随机数。
 * · **不落盘**：`keptPrevious` 只是「本轮结果不足以覆盖旧数据」的判定结论；
 *   真正「保留上次成功结果」由调用方执行（读取旧快照 / 拒绝覆盖）。本层不存数据。
 * · **不猜**：所有判定只依赖已上报的计数，不推断「大概还有几页」。
 *
 * ## `planned` 未知时的退化（明确约定，不留模糊）
 *
 * `planned` 只是提示性的页数预估，**从不参与丢页判定的公式**：
 *
 * · `isLossyCrawl(parsed, lost)` 的分母永远是「已观测页数」`parsed + lost`，
 *   与 `planned` 无关；
 * · `planned === null` 时，`done` **不做缺页补偿**。缺页补偿只对「已经宣布、
 *   却从未上报成功或失败」的页数生效，而这些页数只有 `planned` 已知时才算得出来。
 *   所以 `planned` 未知时，调用方**必须**为每一个失败/超时的页发 `page-fail`；
 *   否则未上报的页会被当成不存在，`done` 可能给出 `ready`——这是本层无法弥补的
 *   信息缺口，只能由事件契约保证。
 * · `planned` 已知时，`done` 把 `planned - (parsed + lost)` 的差额按 lost 计入，
 *   并写回结果的 `lost`：宁可保守，也不把没读到的页当成成功。
 *
 * 此外，`planned` 只是预估：真实页数多于它时以已观测页数为准（文案分母取两者
 * 较大值），真实页数少于它时缺页按 lost 计。
 *
 * ## 会话生命周期
 *
 * 一次抓取会话从 `INITIAL_COLLECT_PROGRESS` 开始；`done` 或 `empty-result` 落下
 * 结论后本轮即结束。要重试就开一个新会话（再次从初始快照开始），不要把重试事件
 * 塞进已经结束的会话——终态不会回退。
 */

/** 抓取会话的阶段。`partial` / `failed` / `ready` 都是本轮结束后的结论，之后的事件不再改变结果。 */
export type CollectPhase = 'idle' | 'collecting' | 'partial' | 'failed' | 'ready';

/**
 * 一份抓取进度快照。字段全部只读——推进状态只能通过 `nextProgress` 返回新对象，
 * 不允许调用方原地改计数（否则「每页累积」的单调性就无法保证）。
 */
export interface CollectProgress {
  readonly phase: CollectPhase;
  /** 计划抓取的页数（未知时 null） */
  readonly planned: number | null;
  /** 已成功解析的页数 */
  readonly parsed: number;
  /** 已失败/超时的页数 */
  readonly lost: number;
  /** 是否保留了上一次的成功结果（判定结论，落盘由调用方执行） */
  readonly keptPrevious: boolean;
  /** 给用户看的一句话（中文） */
  readonly message: string;
}

/**
 * 采集端上报的事件。
 *
 * · `planned`：宣布本轮计划抓取的页数；可以晚到，也可以修正为 `null`（未知）。
 * · `page-ok`：某一页已成功解析 —— 调用方应在此刻就把该页内容并入快照。
 * · `page-fail`：某一页失败或超时。每个失败页都要报，丢页保护才算得准。
 * · `empty-result`：解析器报告「一条也没有」。`courseScopeKnown` 是安全阀：
 *   只有确认了本期课程范围，0 条才可信。
 * · `done`：本轮抓取结束（无论成功与否）。
 */
export type CollectEvent =
  | { readonly kind: 'planned'; readonly pages: number | null }
  | { readonly kind: 'page-ok' }
  | { readonly kind: 'page-fail' }
  | { readonly kind: 'empty-result'; readonly courseScopeKnown: boolean }
  | { readonly kind: 'done' };

const IDLE_MESSAGE = '还没有开始读取';

/** 会话起点：未开始、无计划页数、零计数、未保留旧结果。 */
export const INITIAL_COLLECT_PROGRESS: CollectProgress = Object.freeze({
  phase: 'idle',
  planned: null,
  parsed: 0,
  lost: 0,
  keptPrevious: false,
  message: IDLE_MESSAGE,
});

/** 已宣布的页数只作预估：非整数或负数一律按「未知」处理，不参与判定。 */
function normalizePlanned(pages: number | null): number | null {
  if (pages === null) return null;
  return Number.isInteger(pages) && pages >= 0 ? pages : null;
}

/**
 * 文案里的分母：优先用计划页数，但真实页数超出预估时以观测值为准，
 * 避免出现「已读回 9/8 页」这种自相矛盾的提示。
 */
function totalPages(progress: CollectProgress): number {
  const observed = progress.parsed + progress.lost;
  if (progress.planned === null) return observed;
  return Math.max(progress.planned, observed);
}

/** `planned` 已宣布、但既没成功也没失败上报的页数；`planned` 未知时无法推断，返回 0。 */
function unreportedPages(progress: CollectProgress): number {
  if (progress.planned === null) return 0;
  return Math.max(0, progress.planned - (progress.parsed + progress.lost));
}

/**
 * 终态判定：`done` 落下结论（ready / partial / failed）之后，本轮抓取已经结束，
 * 再来的事件不再改写结论，避免文案与计数在用户眼前来回跳。
 */
function isSettled(phase: CollectPhase): boolean {
  return phase === 'ready' || phase === 'partial' || phase === 'failed';
}

/**
 * **空结果保护**：只有当课程范围已被可靠识别、且本轮没有任何解析页或失败页时，
 * 才接受「0 条作业」。
 *
 * 为什么不只看 `courseScopeKnown`：
 * 课程范围已知但仍有失败页，说明读取过程本身异常，此时的「0 条」依然可能是
 * 漏读造成的——不能把读取异常当成「本期无课」。
 */
export function shouldAcceptEmpty(progress: CollectProgress, courseScopeKnown: boolean): boolean {
  return courseScopeKnown && progress.parsed === 0 && progress.lost === 0;
}

/**
 * **丢页保护**：失败页数超过已观测页数的一半，就认为这一轮网络根本不通，
 * 数据残到不可用。
 *
 * 判定式固定为 `lost > 0 && parsed < (parsed + lost) / 2`，分母是已观测页数，
 * 因此 `planned` 未知时同样成立（见文件头「退化」一节）。恰好一半**不算**丢页：
 * 那是「一半可用」，仍走 `partial` 而不是整轮丢弃。
 *
 * 非法计数（负数 / NaN / Infinity）不判定为丢页——调用方给了坏计数时，
 * 这里不去猜它想表达什么。
 */
export function isLossyCrawl(parsed: number, lost: number): boolean {
  if (!Number.isFinite(parsed) || !Number.isFinite(lost)) return false;
  if (parsed < 0 || lost < 0) return false;
  if (lost === 0) return false;
  return parsed < (parsed + lost) / 2;
}

/**
 * 生成面向用户的中文文案。
 *
 * 只依据 `phase` 与计数推导，不读 `progress.message`，因此
 * `progress.message === mergeGuardMessage(progress)` 恒成立；
 * UI 可以随时用最新快照重新算一遍，不会和状态机里的文案漂移。
 */
export function mergeGuardMessage(progress: CollectProgress): string {
  const total = totalPages(progress);
  const kept = progress.keptPrevious ? '，已保留上次结果' : '，本次结果不可用';

  switch (progress.phase) {
    case 'idle':
      return IDLE_MESSAGE;

    case 'collecting': {
      const seen =
        progress.lost > 0
          ? `已读到 ${progress.parsed}/${total} 页，${progress.lost} 页没读上`
          : `已读到 ${progress.parsed}/${total} 页`;
      return `正在读取…（${seen}）`;
    }

    case 'ready':
      return progress.parsed === 0
        ? '已确认课程范围，本期没有作业'
        : `读取完成，已读回 ${progress.parsed} 页`;

    case 'partial':
      return `已读回 ${progress.parsed}/${total} 页，${progress.lost} 页没读上，先用已读到的结果`;

    case 'failed': {
      if (progress.parsed > 0) {
        return `这一轮只读回 ${progress.parsed}/${total} 页${kept}`;
      }
      if (progress.lost > 0) {
        return `这一轮有 ${progress.lost} 页没读上，一页也没有读到${kept}`;
      }
      return `没能确认本期课程范围，不能当作本期没有作业${kept}`;
    }
  }
}

function withMessage(state: Omit<CollectProgress, 'message'>): CollectProgress {
  const draft = { ...state, message: '' };
  return Object.freeze({ ...draft, message: mergeGuardMessage(draft) });
}

/**
 * **事件驱动的状态推进**：返回一份全新的进度快照，绝不修改 `prev`。
 *
 * 规则：
 * · `planned` / `page-ok` / `page-fail` 都属于「正在采集」，阶段统一为 `collecting`；
 *   `keptPrevious` 一旦为 true 就一直保持，后续失败不会把它抹掉。
 * · `empty-result` 走空结果保护：可接受则 `ready`（0 条），否则 `failed` 并标记
 *   保留旧结果；若本轮已经解析出条目，这条「空结果」自相矛盾，直接忽略。
 * · `done` 走丢页保护：先把「已宣布但未上报」的页数补进 `lost`（仅 `planned`
 *   已知时），再判定 `failed`（不可用）/ `partial`（可用但残缺）/ `ready`（完整）。
 * · 本轮结束（`ready` / `partial` / `failed`）之后再来的事件一律忽略，结论保持稳定。
 */
export function nextProgress(prev: CollectProgress, event: CollectEvent): CollectProgress {
  if (isSettled(prev.phase)) return prev;

  switch (event.kind) {
    case 'planned':
      return withMessage({
        phase: 'collecting',
        planned: normalizePlanned(event.pages),
        parsed: prev.parsed,
        lost: prev.lost,
        keptPrevious: prev.keptPrevious,
      });

    case 'page-ok':
      // 逐页累积：每成功一页就前进一格，已读到的页不会被后续事件回滚。
      return withMessage({
        phase: 'collecting',
        planned: prev.planned,
        parsed: prev.parsed + 1,
        lost: prev.lost,
        keptPrevious: prev.keptPrevious,
      });

    case 'page-fail':
      return withMessage({
        phase: 'collecting',
        planned: prev.planned,
        parsed: prev.parsed,
        lost: prev.lost + 1,
        keptPrevious: prev.keptPrevious,
      });

    case 'empty-result': {
      // 已经读到条目时，「一条也没有」不成立，保持现状，不覆盖已累积的结果。
      if (prev.parsed > 0) return prev;

      if (shouldAcceptEmpty(prev, event.courseScopeKnown)) {
        return withMessage({
          phase: 'ready',
          planned: prev.planned,
          parsed: prev.parsed,
          lost: prev.lost,
          keptPrevious: prev.keptPrevious,
        });
      }

      return withMessage({
        phase: 'failed',
        planned: prev.planned,
        parsed: prev.parsed,
        lost: prev.lost,
        keptPrevious: true,
      });
    }

    case 'done': {
      const lost = prev.lost + unreportedPages(prev);
      const keptPrevious = prev.keptPrevious;

      // 一页都没读到，不可能是个可信结果（空的「有课」结论必须经 empty-result 确认）。
      if (prev.parsed === 0) {
        return withMessage({
          phase: 'failed',
          planned: prev.planned,
          parsed: 0,
          lost,
          keptPrevious: true,
        });
      }

      if (isLossyCrawl(prev.parsed, lost)) {
        return withMessage({
          phase: 'failed',
          planned: prev.planned,
          parsed: prev.parsed,
          lost,
          keptPrevious: true,
        });
      }

      return withMessage({
        phase: lost > 0 ? 'partial' : 'ready',
        planned: prev.planned,
        parsed: prev.parsed,
        lost,
        keptPrevious,
      });
    }
  }
}
