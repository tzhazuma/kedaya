import type { Result } from '@kedaya/shared'

import type { RepositoryError } from './errors'

/**
 * 微信登录凭证端口 —— application 只依赖本接口，实现见 `platform/wechatLogin.ts`。
 *
 * 为什么要抽端口：`Taro.login()` 是平台能力，而 application 层
 * **禁止** import `@tarojs/*`（ESLint 强制）。抽成端口后：
 *   · 用例可以注入假实现，稳定测试「首次注册 / 再次登录」两条路径；
 *   · H5 / 无密钥环境自动降级到开发模拟凭证，页面无感知。
 */

/**
 * 开发模拟凭证前缀。
 *
 * 与后端 `services/api/src/modules/auth/domain/wechat.domain.ts` 的
 * `DEV_WECHAT_CODE_PREFIX` 必须一致：服务端只在非生产环境接受它，
 * 并映射成稳定的 `dev_openid_<设备标识>`。
 */
export const DEV_WECHAT_CODE_PREFIX = 'dev:'

export interface WechatCodeRequest {
  /** 传给后端的 code（真实 `Taro.login()` 的结果，或 `dev:<设备标识>`） */
  code: string
  /** 是否走了本地模拟 —— 服务端响应里也会带 `simulated`，两者应一致 */
  simulated: boolean
}

export interface WechatCodePort {
  /**
   * 取一个登录凭证。
   *
   * `preferReal` 来自服务端 `/auth/wechat/config`：
   *   · true 且当前在微信内 → `Taro.login()`（真实 openid）；
   *   · 否则 → 稳定的开发模拟凭证，保证本地/无密钥也能演示完整流程。
   *
   * 拿不到真实 code 时**不静默伪造**：返回失败，由页面明确告知用户
   * （伪造会在生产环境建出一个查无此人的账号）。
   */
  requestCode(options: { preferReal: boolean }): Promise<Result<WechatCodeRequest, RepositoryError>>
}
