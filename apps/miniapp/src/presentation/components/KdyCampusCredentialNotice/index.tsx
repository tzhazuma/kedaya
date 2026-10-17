import { Text, View } from '@tarojs/components'

import './index.scss'

/**
 * KdyCampusCredentialNotice —— 「我们不接触你的登录凭证」的**如实告知**。
 *
 * ## 为什么这是一个组件而不是一句注释
 *
 * 契约 §11.10-F 裁决：微信小程序的 `web-view` **无法注入 cookie**，
 * 因此校园系统页面的登录状态完全由**学校域名**自己维护 ——
 * 可达鸭既拿不到、也存不了。
 *
 * 这不是免责声明，而是**事实陈述**，而且它有一个直接的产品后果：
 * 用户必须**自己**在校园系统页面里登录一次。如果 UI 不说清楚，
 * 用户会以为「点一下就该自动进去了」，然后把失败当成可达鸭的 bug。
 *
 * 因此这句话在三个页面（绑定管理 / 能力清单 / WebView 直连）都必须出现，
 * 用同一个组件保证**文案一致** —— 三处各写一遍迟早会漂移。
 */
export interface KdyCampusCredentialNoticeProps {
  /** 主文案；不传则使用契约 §11.10-F 的标准表述 */
  text?: string
  /** 紧凑版（列表页内嵌用） */
  compact?: boolean
  title?: string
}

/** 契约 §11.10-F 的标准表述（`CAMPUS_WEBVIEW_LOGIN_NOTICE` 的 UI 呈现） */
export const CAMPUS_CREDENTIAL_NOTICE_DEFAULT =
  '接下来的页面由学校系统提供，请在那里登录；可达鸭不接触你的登录凭证。'

export function KdyCampusCredentialNotice({
  text = CAMPUS_CREDENTIAL_NOTICE_DEFAULT,
  compact = false,
  title = '关于校园系统登录',
}: KdyCampusCredentialNoticeProps) {
  return (
    <View className={`kdy-campus-notice${compact ? ' kdy-campus-notice--compact' : ''}`}>
      <View className='kdy-campus-notice__head'>
        <Text className='kdy-campus-notice__glyph'>🔐</Text>
        <Text className='kdy-campus-notice__title'>{title}</Text>
      </View>

      <Text className='kdy-campus-notice__body'>{text}</Text>

      {!compact && (
        <Text className='kdy-campus-notice__detail'>
          微信小程序的 web-view 组件无法注入 cookie、也无法自定义请求头，因此可达鸭在校园系统里
          没有任何登录态：你在学校页面里登录，会话留在学校域名下。可达鸭不会尝试绕过这个限制。
        </Text>
      )}
    </View>
  )
}

export default KdyCampusCredentialNotice
