import type { BrowseFaqState } from '../application/faq/browseFaq'
import type { ListForumBoardsState } from '../application/forum/listForumBoards'
import type { ListForumPostsState } from '../application/forum/listForumPosts'
import type { ListGroupBuysState } from '../application/groupbuy/listGroupBuys'
import type { WildlifeTracksState } from '../application/wildlife/tracks'
import type { WildlifeMapState } from '../application/wildlife/wildlifeMap'
import type { Session } from '../domain/models/session'
import type { BindingsState } from '../application/techpie/listBindings'
import type { CapabilitiesState } from '../application/techpie/capabilities'
import type { AppContainer } from './container'

/**
 * 启动时序（契约 §8）—— 三端一致：
 *
 * ```
 * 1. 同步：从本地存储 hydrate 缓存（关键路径，禁止网络）
 * 2. 立即渲染首屏（带缓存数据）
 * 3. 后台并发：刷新 token → 拉取各模块数据 → 失败静默降级
 * ```
 *
 * **禁止**：启动时阻塞等待网络。首屏必须是缓存或骨架屏。
 * 因此这里刻意拆成两个函数：`bootstrapSync` 是纯同步的，
 * `refreshInBackground` 永远不 await、永远不抛。
 */

export interface BootstrapSnapshot {
  session: Session
  list: ListGroupBuysState
  forumBoards: ListForumBoardsState
  forumPosts: ListForumPostsState
  faq: BrowseFaqState
  wildlifeMap: WildlifeMapState
  wildlifeTracks: WildlifeTracksState
  /** 校园绑定列表（`techpie`）—— 契约 §11.4 I1：形状里没有凭证 */
  bindings: BindingsState
  /** 校园能力清单（`techpie`）—— 未绑定项由页面渲染成**引导**（契约 I4） */
  capabilities: CapabilitiesState
  durationMs: number
}

/**
 * 第 1 步：同步 hydrate。
 * 不做任何网络访问 —— 只读本地存储 + 内存快照。
 *
 * 覆盖用户最可能首屏进入的模块：拼单（既有切片）+ 论坛 + FAQ + 野生动物地图。
 * 每个 `hydrate()` 都是幂等的，页面自己再调一次也不会重复读盘。
 */
export function bootstrapSync(container: AppContainer): BootstrapSnapshot {
  const startedAt = Date.now()

  const session = container.useCases.session.hydrate()
  const list = container.useCases.listGroupBuys.hydrate()
  const forumBoards = container.useCases.listForumBoards.hydrate()
  const forumPosts = container.useCases.listForumPosts.hydrate()
  const faq = container.useCases.browseFaq.hydrate()
  const wildlifeMap = container.useCases.wildlifeMap.hydrate()
  const wildlifeTracks = container.useCases.wildlifeTracks.hydrate()
  // TechPie 整合（Phase 0）：绑定列表与能力清单都可能首屏进入（首页宫格直达）
  const bindings = container.useCases.listBindings.hydrate()
  const capabilities = container.useCases.capabilities.hydrate()

  return {
    session,
    list,
    forumBoards,
    forumPosts,
    faq,
    wildlifeMap,
    wildlifeTracks,
    bindings,
    capabilities,
    durationMs: Date.now() - startedAt,
  }
}

/**
 * 第 3 步：后台刷新。
 *
 * 返回 `void`（不是 Promise）是刻意的：调用方**不允许** await 它，
 * 否则就把「后台刷新」变成了「阻塞启动」。
 * 内部所有失败都被吞掉（静默降级），错误状态由各用例写入自己的 state。
 */
export function refreshInBackground(container: AppContainer): void {
  void refreshSessionToken(container)
    .then(() =>
      Promise.all([
        container.useCases.listGroupBuys.load(),
        container.useCases.listForumBoards.load(),
        container.useCases.listForumPosts.load(),
        container.useCases.browseFaq.load(),
        container.useCases.wildlifeMap.load(),
        // techpie：绑定列表 + 能力清单。失败同样静默降级（契约 §8）
        container.useCases.listBindings.load(),
        container.useCases.capabilities.load(),
      ]),
    )
    // 静默降级：单个模块的意外异常不能让启动流程变成 unhandled rejection
    .catch(() => undefined)
}

async function refreshSessionToken(container: AppContainer): Promise<void> {
  const { session } = container.useCases
  if (!session.needsRefresh()) return

  const refreshToken = container.tokenStore.getRefreshToken()
  if (refreshToken === null) return

  try {
    const result = await container.refresher.refresh(refreshToken)
    if (result.ok) {
      container.tokenStore.setTokens(result.value)
    } else {
      // 刷新失败：清掉登录态，但不打断启动（用户下次操作时会看到「请先登录」）
      container.tokenStore.clear()
    }
  } catch {
    // 静默降级（契约 §8）
  }
}
