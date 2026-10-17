import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import { validateDraft } from '../../../../application/faq/faqUseCases'
import {
  FAQ_ANSWER_MAX,
  FAQ_CATEGORIES,
  FAQ_CATEGORY_LABELS,
  FAQ_QUESTION_MAX,
  parseTagsText,
} from '../../../../domain/models/faq'
import { navigateBack, redirectTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyField } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import './index.scss'

/**
 * 补充常见问题 —— 共建入口。
 *
 * 这是给「热心同学 / 管理员」用的：把在校园里真正问到、找到的答案写下来，
 * 让下一位同学少走弯路。它不是一个「提问箱」：能写进来的应该是**答案**，
 * 所以表单把「答案」当必填主体，问题只是这条答案的标题。
 *
 * 三条纪律：
 *   · 分类**只能**从 `FAQ_CATEGORIES` 白名单里选（与列表筛选 chip 同一份取值），
 *     否则这条问答在列表里永远筛不到 —— mock 仓储也会按同一套规则拦下来；
 *   · 问题/答案/标签的长度上限与后端 `createSchema` 完全一致
 *     （领域纯函数，客户端先提示，不必用一次注定 400 的请求去试探）；
 *   · 不发送 `helpfulCount`：计数只能由服务端自增，客户端不参与。
 *
 * 本模块低敏感、允许匿名，因此这里**不做登录拦截**（后端 `@OptionalAuthGuard`）。
 */

export default function FaqCreatePage() {
  const container = getContainer()
  const faq = container.useCases.faq

  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  // 默认「其他」：不确定就先放着，比替用户默认成某个具体分类诚实
  const [category, setCategory] = useState<string>('other')
  const [tagsText, setTagsText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const draft = { question, answer, category, tagsText }
  const problems = validateDraft(draft)
  const tags = parseTagsText(tagsText)

  async function handleSubmit(): Promise<void> {
    if (submitting) return
    setError(null)
    setSubmitting(true)

    const result = await faq.create(draft)
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }

    toast('谢谢分享，已收录', 'success')
    // 成功了就退回来处；如果这一页是分享/直达打开的（没有上一页），
    // `navigateBack` 会失败，这时重定向到列表，而不是把用户晾在这一页。
    const back = await navigateBack()
    if (!back.ok) await redirectTo(PAGE_PATHS.faqList)
  }

  return (
    <View className='kdy-page kdy-faq-create'>
      <KdyHeading
        title='补充问答'
        subtitle='这里是共建入口：把你找到的可靠答案写下来，让下一位同学少走弯路。'
        eyebrow='KEDAYA · 常见问题'
      />

      <KdyCard elevated={false}>
        <Text className='kdy-faq-create__intro'>
          写给热心同学与管理员：能写进来的应该是答案而不是提问。请写清可执行的步骤
          （去哪、带什么、什么时间），不要只写「请联系相关老师」——那样等于没帮上忙。
        </Text>
      </KdyCard>

      <KdyCard title='问题' elevated={false}>
        <KdyField
          label='一句话问题'
          value={question}
          onChange={setQuestion}
          placeholder='例如：一卡通丢了怎么补办？'
          maxLength={FAQ_QUESTION_MAX}
          hint='列表卡片显示的就是这句话，写清楚「什么场景 + 想做什么」'
        />
      </KdyCard>

      <KdyCard title='答案' elevated={false}>
        <KdyField
          label='具体做法'
          value={answer}
          onChange={setAnswer}
          placeholder='例如：先在一卡通 App 里挂失，再去 3 号行政楼一层卡务中心补办，带学生证，工本费 20 元…'
          maxLength={FAQ_ANSWER_MAX}
          hint='3–5 句话：步骤、地点、材料、时间、费用；必要时说明官方口径'
        />
      </KdyCard>

      <KdyCard title='分类' elevated={false}>
        <View className='kdy-faq-create__chips'>
          {FAQ_CATEGORIES.map((item) => (
            <KdyChip key={item} active={category === item} onClick={() => setCategory(item)}>
              {FAQ_CATEGORY_LABELS[item]}
            </KdyChip>
          ))}
        </View>
      </KdyCard>

      <KdyCard title='标签（选填）' elevated={false}>
        <KdyField
          label='关键词'
          value={tagsText}
          onChange={setTagsText}
          placeholder='例如：校园卡、补办、挂失'
          maxLength={200}
          hint='用逗号、顿号或空格分隔；标签用于检索，最多 20 个'
        />
        {tags.length > 0 && (
          <Text className='kdy-faq-create__hint'>将保存 {tags.length} 个标签：{tags.join('、')}</Text>
        )}
      </KdyCard>

      {problems.length > 0 && (
        <Text className='kdy-faq-create__problems'>还需要完善：{problems.join('、')}</Text>
      )}
      {error !== null && <Text className='kdy-faq-create__error'>{error}</Text>}

      <View className='kdy-faq-create__actions'>
        <KdyButton
          block
          loading={submitting}
          disabled={problems.length > 0}
          onClick={() => void handleSubmit()}
        >
          提交问答
        </KdyButton>
      </View>

      {container.env.useMock && (
        <Text className='kdy-faq-create__hint'>
          当前为本地演示模式：提交只写入内存 Mock，重开小程序后不会保留。
        </Text>
      )}

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。请勿写入他人隐私信息；涉及教务、财务等以学校官方通知为准。
      </Text>
    </View>
  )
}
