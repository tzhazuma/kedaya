import { GROUPBUY_STATUS, type GroupbuyStatus } from './groupbuy.domain';

/**
 * 拼单状态推导（纯函数，单独放一个文件是为了让单元测试能直接引用，
 * 而不必构造整个 service）。
 *
 * 为什么由**服务端**推导而不是把数据库里的 status 原样吐给客户端：
 *   · 数据库只记三个值（`open` / `grouped` / `cancelled`），其中 `grouped`
 *     是"成团记账"，而客户端需要区分「已成团」与「已截止但没凑齐」——
 *     这两种情况给用户的下一步动作完全不同（一个去取货，一个没戏了）；
 *   · 时间相关的推导必须用**服务端时钟**：客户端时区/时间不准会把
 *     "还没截止"显示成"已截止"，用户会以为拼单黄了。
 *
 * 优先级：cancelled > full > closed > open。
 * 注意 `full` 高于 `closed`：已经凑齐的拼单即使过了截止时间也应该显示"已成团"。
 */
export function deriveGroupbuyStatus(input: {
  storedStatus: string;
  deadline: Date;
  joinedQuantity: number;
  targetCount: number;
  now: Date;
}): GroupbuyStatus {
  if (input.storedStatus === GROUPBUY_STATUS.cancelled) return GROUPBUY_STATUS.cancelled;
  if (input.targetCount > 0 && input.joinedQuantity >= input.targetCount) {
    return GROUPBUY_STATUS.full;
  }
  if (input.deadline.getTime() <= input.now.getTime()) return GROUPBUY_STATUS.closed;
  return GROUPBUY_STATUS.open;
}
