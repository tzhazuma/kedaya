import Taro from '@tarojs/taro'
import { err, ok } from '@kedaya/shared'

import { isWeapp } from './env'
import type { PlatformResult } from './failure'

/**
 * 扫码。
 *
 * - **微信小程序特有**：底层 `wx.scanCode`，调用原生相机，
 *   支持 `qrCode` / `barCode` 等；`onlyFromCamera` 控制是否允许从相册选。
 * - **H5 降级**：浏览器端**没有**统一的原生扫码 API。
 *   这里返回 `UNSUPPORTED`，由 UI 引导用户手动输入编码
 *   （相册选图 + 服务端识别是另一条路，需要后端接口，本骨架未实现）。
 */

export interface ScanOptions {
  /** true = 只允许相机扫码（微信默认 false，允许从相册选） */
  onlyFromCamera?: boolean
}

export async function scanCode(options: ScanOptions = {}): Promise<PlatformResult<string>> {
  if (!isWeapp()) {
    return err({
      code: 'UNSUPPORTED',
      message: 'H5 端不支持原生扫码，请在微信小程序内使用，或手动输入编码',
    })
  }

  try {
    const result = await Taro.scanCode({
      onlyFromCamera: options.onlyFromCamera ?? false,
      scanType: ['qrCode', 'barCode'],
    })
    if (result.result === undefined || result.result === '') {
      return err({ code: 'FAILED', message: '没有识别到内容' })
    }
    return ok(result.result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // 用户主动取消时微信抛出 "scanCode:fail cancel"
    if (/cancel/i.test(message)) {
      return err({ code: 'REJECTED', message: '已取消扫码' })
    }
    return err({ code: 'FAILED', message })
  }
}
