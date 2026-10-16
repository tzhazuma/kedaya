/**
 * 平台能力矩阵 —— 供 UI 直接渲染「微信特有 / H5 降级」说明。
 *
 * 把差异**数据化**，而不是散落在各页面的 if/else 注释里：
 * 发现页（`presentation/pages/discover`）直接遍历这张表。
 */

export type CapabilityId = 'subscribe-message' | 'scanner' | 'share' | 'map'

export interface CapabilityDescriptor {
  id: CapabilityId
  nameZh: string
  /** 微信小程序端的实现 */
  weapp: string
  /** H5 端的降级行为 */
  h5: string
  /** true = 只有小程序端有原生实现 */
  weappOnly: boolean
}

export const CAPABILITIES: readonly CapabilityDescriptor[] = [
  {
    id: 'subscribe-message',
    nameZh: '订阅消息',
    weapp: 'wx.requestSubscribeMessage：用户点击「允许」后可下发一次性订阅通知',
    h5: '无对应能力；降级为站内信 + 引导用户到小程序内开启',
    weappOnly: true,
  },
  {
    id: 'scanner',
    nameZh: '扫码',
    weapp: 'wx.scanCode：原生相机扫码（二维码 / 条码）',
    h5: '无原生扫码；降级为手动输入编码（相册识别需服务端支持）',
    weappOnly: true,
  },
  {
    id: 'share',
    nameZh: '分享',
    weapp: '必须由用户点击 <Button open-type="share"> 或右上角转发，代码不能静默分享',
    h5: 'navigator.share 原生分享面板；不支持时降级为复制链接',
    weappOnly: false,
  },
  {
    id: 'map',
    nameZh: '地图 / 导航',
    weapp: 'wx.openLocation：打开微信内置地图，可直接唤起导航',
    h5: '降级为高德地图 Web URI（window.open），再降级为复制坐标',
    weappOnly: false,
  },
]

export function findCapability(id: CapabilityId): CapabilityDescriptor | undefined {
  return CAPABILITIES.find((item) => item.id === id)
}
