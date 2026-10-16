/**
 * 找搭子 `buddy` —— 匹配算法的**共享纯函数**（规格 §3）
 *
 * 为什么放在 `@kedaya/shared` 而不是服务端：
 *   - **可解释性要求**：客户端要展示「为什么推荐给你」，必须与服务端**同一套算法**；
 *     两份实现必然漂移，用户会看到与服务端排序不一致的理由。
 *   - 全是纯函数（无 IO、无框架、无 Node API），三端都能跑。
 *
 * 服务端专用的部分（pgvector 查询、Prisma 仓储、硬过滤的数据准备）留在
 * `services/api/src/modules/buddy/`。
 *
 * 移植自用户的 `tzhazuma/STUMatch`，三处刻意适配见 `scoring.ts` 文件头。
 */

export * from './availability';
export * from './scoring';
export * from './hashVector';
