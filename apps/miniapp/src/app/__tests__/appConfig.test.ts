import { describe, expect, it } from 'vitest'

import appConfig from '../../app.config'

/**
 * `app.config.ts` → `dist/app.json` 的**上传期**约束。
 *
 * 这些约束的麻烦之处在于：**编译、单测、`verify:weapp` 全都不报错**，
 * 只有真机上传时才失败。所以必须在这里锁住。
 *
 * 真实事故：`scope.userLocation.desc` 写了 36 个字，开发者工具上传直接报
 *
 *     系统错误，错误码：80058
 *     desc(...) of scope.userLocation exceeds 30, word count: 36
 *
 * 微信对这条 `desc` 有 **30 字符**硬上限（中英文都按 1 个算），
 * 而它的作用恰恰是给用户看"为什么要你的位置"—— 写不清楚审核不过、
 * 写清楚了又容易超字数，所以要么被测住，要么就等着上传时踩一次。
 */
describe('app.json 的上传期约束', () => {
  it('权限说明不超过微信的 30 字符上限（否则真机上传报 80058）', () => {
    for (const [scope, config] of Object.entries(appConfig.permission)) {
      const desc = config.desc
      expect(desc, `${scope} 缺少 desc`).toBeTruthy()
      expect(
        desc.length,
        `${scope}.desc 有 ${desc.length} 个字符（上限 30）：${desc}`,
      ).toBeLessThanOrEqual(30)
    }
  })

  it('只申报实际用到的隐私接口，且不做后台持续定位', () => {
    // 上报观测用 `getLocation`（显式 wgs84），从地图选点用 `chooseLocation`。
    expect([...appConfig.requiredPrivateInfos].sort()).toEqual(['chooseLocation', 'getLocation'])
    // 数据最小化（契约 §9）：不做后台轨迹，这两个一旦申报就等于持续追踪用户。
    expect(appConfig.requiredPrivateInfos).not.toContain('onLocationChange')
    expect(appConfig.requiredPrivateInfos).not.toContain('startLocationUpdate')
  })
})
