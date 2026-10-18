import { Image, Text, View } from '@tarojs/components'

/**
 * KdyHeading —— 页面标题。
 *
 * 只有标题，外加一行**可选**的说明。这里刻意没有「eyebrow / 小标签」：
 * 每一页顶上再挂一个「KEDAYA · xx」既占高度、又像开发者留下的占位符，
 * 用户从它身上拿不到任何信息 —— 标题自己已经说清这是哪一页了。
 *
 * `subtitle` 也做成可选：只有当一句话能帮用户做决定时才写，
 * 不为了"每页都有一行小字"而凑字数。
 *
 * ## 右侧那只鸭子
 *
 * 贴纸簿是"一本贴满了东西的册子"：每一页的标题旁边都有一只歪着的可达鸭贴纸
 * （`assets/campus/duck.png`，与入口页 / 首页大标题用的是同一张）。
 * 它是**纯装饰**（`aria-hidden`）—— 读屏软件不需要知道这里有只鸭子，
 * 而且它不带任何交互（`pointer-events: none`，不会挡住标题的点击热区）。
 *
 * 图直接用字符串路径 `/assets/campus/duck.png` 引用：`<Image src>` 只认
 * 「包内路径 / 临时路径 / 网络图」，webpack 的 `import` 内联对它无效。
 * 这类资源靠 `config/index.ts` 的 copy 规则落到 `dist/assets/campus/`，
 * `verify:weapp` 会断言它们在（漏拷时构建全绿、真机只是白图）。
 */
export function KdyHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View className='kdy-page-heading'>
      <View className='kdy-page-heading__body'>
        <Text className='kdy-page-title'>{title}</Text>
        {subtitle !== undefined && subtitle !== '' && (
          <Text className='kdy-page-subtitle'>{subtitle}</Text>
        )}
      </View>
      <Image
        className='kdy-page-heading__duck'
        src='/assets/campus/duck.png'
        mode='aspectFit'
        aria-hidden='true'
      />
    </View>
  )
}

export default KdyHeading
