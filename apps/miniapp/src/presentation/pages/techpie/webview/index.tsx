import { Text, View, WebView } from '@tarojs/components'
import { useRouter } from '@tarojs/taro'
import { useEffect, useState } from 'react'

import { getContainer } from '../../../../app/container'
import { techpieWebviewPath } from '../../../../app/routes'
import {
  CAMPUS_WEBVIEW_LOGIN_NOTICE,
  CAMPUS_WEBVIEW_PLACEHOLDER_NOTICE,
  CAMPUS_WEBVIEW_TARGETS,
  campusWebviewTarget,
  isHttpsCampusUrl,
} from '../../../../domain/models/techpie'
import { navigateBack, redirectTo } from '../../../../platform/navigation'
import { KdyButton, KdyCampusCredentialNotice, KdyCard, KdyEmpty, KdyTag } from '../../../components'
import './index.scss'

/**
 * WebView 直连页 —— 打开**校园系统**页面（E云课堂 / eGate / 课程录播）。
 *
 * ## 契约 §11.10-F：小程序端**没有** cookie 注入这条路径
 *
 * 微信小程序的 `web-view` 组件：
 * - **无法自定义请求头** → 不能带 `Cookie:`；
 * - **无法跨域设置 cookie** → 不能在校园域下种会话。
 *
 * 因此契约不变式 **I3（校园 cookie 的唯一出口供 WebView 注入）在小程序端没有出口**。
 * 小程序端走 **W4**：`src` 直接指向校园系统页面，**用户在页面里自己登录**，
 * 会话留在学校域名下，可达鸭**不接触** cookie。
 *
 * ## 三个「绝不」
 *
 * | 绝不 | 说明 |
 * | --- | --- |
 * | 绝不注入 / 转发 cookie | 本文件里没有、也不会有任何 cookie 相关 API 调用 |
 * | 绝不在本地存校园凭证 | 没有 storage 写入，没有凭证字段 |
 * | 绝不伪造 header / 劫持 cookie | 契约 §11.10-F 明令禁止「绕过此限制」 |
 *
 * 这条边界由 `src/__tests__/techpie-no-cookie-injection.test.ts` 静态扫描钉死。
 *
 * ## 为什么先有一屏「告知」而不是直接打开
 *
 * 微信的 `web-view` 是**原生组件，默认铺满整个页面**，其它组件会被它覆盖 ——
 * 也就是说：一旦渲染了 `web-view`，我们在页面上**再也放不下任何文字**。
 * 而契约 §11.10-F 要求「三端 UI 需按端展示不同引导文案」，
 * 用户必须在进入前就被告知「你要自己登录、可达鸭不接触你的凭证」。
 *
 * 于是本页分成两步：**先告知，后打开**。这不是多余的点击，
 * 而是把平台限制变成一次诚实的确认。
 */

type WebviewPhase = 'notice' | 'webview'

export default function TechpieWebviewPage() {
  const router = useRouter()
  const container = getContainer()

  const rawTarget = router.params.target ?? ''
  const target = campusWebviewTarget(rawTarget)
  const [phase, setPhase] = useState<WebviewPhase>('notice')

  useEffect(() => {
    if (target === null) return
    // 只记标识与域名确认状态 —— URL 本身不进日志（它可能带查询参数）
    container.log.info('techpie.webview.open', {
      targetId: target.id,
      domainVerified: target.domainVerified,
    })
  }, [container, target])

  if (target === null) {
    return (
      <View className='kdy-page kdy-techpie-webview'>
        <KdyEmpty
          mode='error'
          title='未知的校园系统'
          description={`没有找到标识为「${rawTarget}」的校园系统。可达鸭不会用未知地址打开 WebView。`}
          actionText='返回'
          onAction={() => void navigateBack()}
        />
      </View>
    )
  }

  if (!isHttpsCampusUrl(target.url)) {
    // 契约 §11.18-B：只允许 https。这一条同时保护用户与我们的域名白名单假设
    return (
      <View className='kdy-page kdy-techpie-webview'>
        <KdyEmpty
          mode='error'
          title='地址不合法'
          description='该校园系统的地址不是合法的 https 地址，已拒绝打开。'
          actionText='返回'
          onAction={() => void navigateBack()}
        />
      </View>
    )
  }

  if (phase === 'webview') {
    // ⚠️ 只有 `src`。没有 header、没有 cookie、没有注入 —— 平台也不支持。
    return <WebView src={target.url} />
  }

  return (
    <View className='kdy-page kdy-techpie-webview'>
      <KdyCampusCredentialNotice text={CAMPUS_WEBVIEW_LOGIN_NOTICE} />

      <KdyCard
        elevated={false}
        title={target.nameZh}
        extra={<KdyTag tone={target.domainVerified ? 'success' : 'warning'}>
          {target.domainVerified ? '域名已确认' : '域名待确认'}
        </KdyTag>}
      >
        <Text className='kdy-techpie-webview__summary'>{target.summary}</Text>
        <Text className='kdy-techpie-webview__url'>{target.url}</Text>

        {!target.domainVerified && (
          <Text className='kdy-techpie-webview__placeholder'>{CAMPUS_WEBVIEW_PLACEHOLDER_NOTICE}</Text>
        )}
      </KdyCard>

      <KdyCard elevated={false} title='打开后会怎样'>
        <Text className='kdy-techpie-webview__step'>1. 页面由学校系统提供，登录框是学校的，不是可达鸭的。</Text>
        <Text className='kdy-techpie-webview__step'>2. 你在那里登录后，会话由学校域名自己维护。</Text>
        <Text className='kdy-techpie-webview__step'>3. 可达鸭拿不到、也不保存你的校园登录凭证。</Text>
        <Text className='kdy-techpie-webview__step'>
          4. 想回到本页，用左上角的返回按钮（web-view 会铺满页面，页内按钮会被覆盖）。
        </Text>
      </KdyCard>

      <View className='kdy-techpie-webview__actions'>
        <KdyButton onClick={() => setPhase('webview')}>我已了解，打开学校系统</KdyButton>
        <KdyButton variant='ghost' onClick={() => void navigateBack()}>
          返回
        </KdyButton>
      </View>

      <Text className='kdy-techpie-webview__all'>可达鸭接入的校园系统入口：</Text>
      <View className='kdy-techpie-webview__list'>
        {CAMPUS_WEBVIEW_TARGETS.map((item) => (
          <KdyButton
            key={item.id}
            size='sm'
            variant='ghost'
            onClick={() => {
              if (item.id === target.id) return
              // 用 redirectTo 而不是 navigateTo：页面栈里不该堆积一串 web-view 告知页
              void redirectTo(techpieWebviewPath(item.id))
            }}
          >
            {item.nameZh}
          </KdyButton>
        ))}
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
