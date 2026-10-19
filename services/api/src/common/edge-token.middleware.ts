import type { NextFunction, Request, Response } from 'express';

/**
 * 公网边缘令牌 —— **可选**的一层共享密钥闸门。
 *
 * ## 为什么需要它
 *
 * 我们的后端通过 Cloudflare quick tunnel 暴露在公网（`*.trycloudflare.com`）。
 * 那是**公开 URL**：任何人拿到就能调我们的 API。quick tunnel 本身没有边缘鉴权。
 *
 * ## 设计取舍
 *
 * 1. **默认关闭**。`API_EDGE_TOKEN` 未设置时本中间件直接 `next()` ——
 *    本地开发、内网部署、单元测试都不受影响。开了才生效。
 * 2. **常量时间比较**。用 `timingSafeEqual` 而不是 `===`，
 *    避免通过响应时间逐字节爆破令牌。
 * 3. **只豁免 `/health`**。探活必须无鉴权，否则隧道/负载均衡的探针全挂。
 *    注意 `/health` 是**不带** `/api/v1` 前缀的那条（见 `main.ts`）。
 * 4. **不豁免回环地址**。隧道回源到 `127.0.0.1:3100`，
 *    所以本机与隧道流量**在 TCP 层看起来一模一样** —— 按来源 IP 豁免是无效的，
 *    只有按路径豁免才有意义。
 *
 * ## 它不是什么
 *
 * - 不是用户身份认证：它只回答"这个请求带了我们约定的共享密钥吗"，
 *   不回答"你是谁"。用户身份仍由 `AuthGuard` + JWT 负责。
 * - 不是替代 Cloudflare Access：真正长期方案是 named tunnel + Access。
 *   这只是"别让 URL 泄露就等于完全敞开"的兜底。
 */
export const EDGE_TOKEN_HEADER = 'x-edge-token';

const HEALTH_PATH = '/health';

function constantTimeEqual(a: string, b: string): boolean {
  // 长度不同直接 false（长度本身不是秘密：令牌长度固定）
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function createEdgeTokenMiddleware(expectedToken: string | undefined) {
  // 未配置 → 完全放行。这是一个**有意的**默认：不能因为忘了配就锁死自己。
  if (expectedToken === undefined || expectedToken.trim() === '') {
    return (_req: Request, _res: Response, next: NextFunction): void => next();
  }

  const expected = expectedToken.trim();

  return (req: Request, res: Response, next: NextFunction): void => {
    // 探活不鉴权：隧道/负载均衡的探针不会带我们的头
    if (req.path === HEALTH_PATH) {
      next();
      return;
    }

    const provided = req.header(EDGE_TOKEN_HEADER);

    if (provided === undefined || !constantTimeEqual(provided, expected)) {
      // 不告诉对方"令牌错了"还是"没带令牌"—— 两者都是 401，减少信息泄漏
      res.status(401).json({
        ok: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: '缺少或错误的边缘访问令牌',
        },
      });
      return;
    }

    next();
  };
}
