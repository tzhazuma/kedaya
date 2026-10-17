import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useMemo, useRef, useState } from 'react'

import { getContainer } from '../../../../app/container'
import type { DormHarmonyTrackRecord } from '../../../../application/dormHarmony/dormHarmonyUseCases'
import {
  DORM_HARMONY_BUILDING_MAX,
  DORM_HARMONY_DETAIL_MAX,
  DORM_HARMONY_EMERGENCY_NOTICE,
  DORM_HARMONY_EXPECTATIONS,
  DORM_HARMONY_EXPECTATION_LABELS,
  DORM_HARMONY_MESSAGE_MAX,
  DORM_HARMONY_PLATFORM_DISCLAIMER,
  DORM_HARMONY_TOPIC_MAX,
  codePointLength,
  normalizeTrackCode,
  summarizeDetail,
  validateMessageBody,
  validateSubmitDraft,
} from '../../../../domain/models/dormHarmony'
import type {
  DormHarmonyCaseDetail,
  DormHarmonyCaseDetailView,
  DormHarmonyMessageView,
} from '../../../../domain/models/dormHarmony'
import { toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import './index.scss'

/**
 * 宿舍矛盾（`dorm-harmony`）—— 单页承载完整流程的**高敏感匿名**切片。
 *
 * 三段结构（顺序就是用户的心智顺序）：
 *   1. **二次同意门**（契约 §9）：未同意时页面只显示说明与「同意 / 拒绝」。
 *      同意记录落本地（`{ acceptedAt, version }`）；拒绝则不写任何同意，
 *      只显示「已退出」并可再次进入。同意必须发生在**看到任何内容之前**。
 *   2. **提交匿名申请**：字段与后端 schema 严格对齐（building ≤20 / topic ≤40 /
 *      detail ≤2000 / expectation 白名单）。提交响应里有一次性的**追踪码明文**，
 *      页面必须显著地把它交给用户（可复制），并提示「丢了无法找回」。
 *   3. **凭追踪码查看进度**：从本机已保存的记录里选，或手动输入追踪码 + 案件编号。
 *      展示案子与留言，可追加留言 / 结案。
 *
 * 三条不能忘的产品纪律：
 *   · 这是**第三方非官方**平台；
 *   · **匿名 ≠ 绝对不可追溯**：内容由调解员人工阅读，涉及安全事件时可能依规配合校方；
 *   · **不提供实时救助**：紧急或涉及人身安全请直接联系辅导员或校园安保。
 *
 * 追踪码只出现在「凭据卡片」「本机记录」与复制按钮里 —— 用户必须能看到并保存它，
 * 否则这份匿名申请就再也打不开了。页面不打印它，也不把它写进 URL 之外的地方。
 */

function statusTone(status: string): KdyTagTone {
  if (status === 'closed') return 'neutral'
  if (status === 'in-progress') return 'warning'
  return 'brand'
}

/** 从页面参数里取追踪码（`dormHarmonyDetailPath()` 生成的深链用的就是这个名字） */
function readTrackCodeParam(params: Record<string, string | undefined>): string {
  const raw = params.trackCode
  return raw === undefined || raw === '' ? '' : normalizeTrackCode(raw)
}

/** 留言列表（学生留言带匿名 handle，调解员留言不带） */
function MessageList({ messages }: { messages: readonly DormHarmonyMessageView[] }) {
  if (messages.length === 0) {
    return <Text className='kdy-dorm__muted'>还没有留言。补充说明情况有助于调解员判断。</Text>
  }
  return (
    <View className='kdy-dorm__messages'>
      {messages.map((message) => (
        <View
          key={message.id}
          className={['kdy-dorm__message', message.mine ? 'kdy-dorm__message--mine' : '']
            .filter(Boolean)
            .join(' ')}
        >
          <View className='kdy-dorm__message-head'>
            <Text className='kdy-dorm__message-author'>{message.authorLabel}</Text>
            <Text className='kdy-dorm__message-time'>{message.timeLabel}</Text>
          </View>
          <Text className='kdy-dorm__message-body'>{message.body}</Text>
        </View>
      ))}
    </View>
  )
}

/** 案子事实表：标签全部来自 `summarizeDetail`，页面不再自己拼 */
function CaseFacts({
  detail,
  detailText,
}: {
  detail: DormHarmonyCaseDetailView
  detailText: string | null
}) {
  const { case: item } = detail
  const facts: ReadonlyArray<{ key: string; value: string }> = [
    { key: '匿名代号', value: item.anonHandle },
    { key: '宿舍楼', value: item.building },
    { key: '问题', value: item.topic },
    { key: '补充说明', value: detailText ?? '未填写' },
    { key: '期望方式', value: item.expectationLabel ?? '未指定' },
    { key: '调解员', value: item.mediatorLabel },
  ]
  return (
    <View className='kdy-dorm__facts'>
      {facts.map((fact) => (
        <View key={fact.key} className='kdy-dorm__fact'>
          <Text className='kdy-dorm__fact-k'>{fact.key}</Text>
          <Text className='kdy-dorm__fact-v'>{fact.value}</Text>
        </View>
      ))}
    </View>
  )
}

export default function DormHarmonyPage() {
  const container = getContainer()
  const dorm = container.useCases.dormHarmony
  const router = useRouter()

  const initialTrackCode = useMemo(
    () => readTrackCodeParam(router.params as Record<string, string | undefined>),
    [router.params],
  )

  /* 二次同意（本地） */
  const [consented, setConsented] = useState(() => dorm.hasConsented())
  const [declined, setDeclined] = useState(false)

  /* 本地追踪码记录 */
  const [records, setRecords] = useState<DormHarmonyTrackRecord[]>(() => dorm.savedCases())
  const [selectedCode, setSelectedCode] = useState<string | null>(null)

  /* 手动打开 */
  const [manualCode, setManualCode] = useState('')
  const [manualCaseId, setManualCaseId] = useState('')

  /* 已打开的案子 */
  const [opened, setOpened] = useState<{ trackCode: string; data: DormHarmonyCaseDetail } | null>(null)
  const [openedLoading, setOpenedLoading] = useState(false)
  const [openedError, setOpenedError] = useState<string | null>(null)

  /* 提交表单 */
  const [building, setBuilding] = useState('')
  const [topic, setTopic] = useState('')
  const [detailText, setDetailText] = useState('')
  const [expectation, setExpectation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [credential, setCredential] = useState<{ trackCode: string; caseId: string } | null>(null)

  /* 留言 / 结案 */
  const [messageBody, setMessageBody] = useState('')
  const [sending, setSending] = useState(false)
  const [closing, setClosing] = useState(false)

  const openedParamRef = useRef(false)

  const problems = validateSubmitDraft({ building, topic, detail: detailText, expectation })
  const messageProblems = validateMessageBody(messageBody)
  const selectedRecord =
    selectedCode === null ? null : (records.find((record) => record.trackCode === selectedCode) ?? null)
  const openedView = opened === null ? null : summarizeDetail(opened.data, container.clock.now())

  function syncLocal(): void {
    setConsented(dorm.hasConsented())
    setRecords(dorm.savedCases())
  }

  async function openCase(rawCode: string, caseId?: string | null): Promise<void> {
    const code = normalizeTrackCode(rawCode)
    if (code === '') {
      toast('请先填写追踪码')
      return
    }
    setSelectedCode(code)
    setOpenedError(null)
    setOpenedLoading(true)

    const result = await dorm.track(code, caseId)
    setOpenedLoading(false)
    // 用例层打开成功时会把摘要刷进本地记录，这里同步一次 UI
    setRecords(dorm.savedCases())

    if (!result.ok) {
      // 刷新同一条失败时保留原有内容；切到另一条失败则清空，避免张冠李戴
      setOpened((prev) => (prev !== null && prev.trackCode === code ? prev : null))
      setOpenedError(result.error.message)
      return
    }
    setOpened({ trackCode: code, data: result.value })
    setMessageBody('')
  }

  /** 深链（`?trackCode=`）带来的案子：同意后自动打开，只试一次 */
  function openInitialIfAny(): void {
    if (openedParamRef.current || initialTrackCode === '') return
    if (!dorm.hasConsented()) return
    openedParamRef.current = true
    void openCase(initialTrackCode)
  }

  function acceptConsent(): void {
    dorm.acceptConsent()
    syncLocal()
    setDeclined(false)
    openInitialIfAny()
  }

  function declineConsent(): void {
    // 拒绝不写任何同意记录 —— 只是这次不进这个模块
    setDeclined(true)
  }

  function revokeConsent(): void {
    dorm.revokeConsent()
    setConsented(false)
    setDeclined(false)
    setOpened(null)
    setOpenedError(null)
    setSelectedCode(null)
    setRecords(dorm.savedCases())
    toast('已撤回同意')
  }

  function copyText(value: string, label: string): void {
    Taro.setClipboardData({ data: value })
      .then(() => {
        toast(`${label}已复制`, 'success')
      })
      .catch(() => {
        toast('复制失败，请手动抄写', 'error')
      })
  }

  async function forgetRecord(trackCode: string): Promise<void> {
    const confirmed = await Taro.showModal({
      title: '从本机删除这条记录？',
      content: '删除后本机再也打不开这个案子 —— 平台只保存追踪码的哈希，无法替你找回。',
      confirmText: '删除',
    })
    if (!confirmed.confirm) return

    dorm.forget(trackCode)
    setRecords(dorm.savedCases())
    if (selectedCode === trackCode) {
      setSelectedCode(null)
      setOpened(null)
      setOpenedError(null)
    }
    toast('已从本机删除', 'success')
  }

  async function handleSubmit(): Promise<void> {
    if (submitting) return
    setSubmitError(null)
    setSubmitting(true)

    const result = await dorm.submit({ building, topic, detail: detailText, expectation })
    setSubmitting(false)

    if (!result.ok) {
      setSubmitError(result.error.message)
      return
    }

    setCredential({ trackCode: result.value.trackCode, caseId: result.value.case.id })
    setBuilding('')
    setTopic('')
    setDetailText('')
    setExpectation('')
    syncLocal()
    // 顺手把这案子打开：用户往下滑就能看到进度
    setSelectedCode(result.value.trackCode)
    setOpened({ trackCode: result.value.trackCode, data: { ...result.value.case, messages: [] } })
    setOpenedError(null)
    toast('已提交，请先保存追踪码', 'success')
  }

  async function handleSend(): Promise<void> {
    if (opened === null || sending) return
    if (messageProblems.length > 0) {
      toast(messageProblems[0] ?? '请检查留言内容')
      return
    }

    setSending(true)
    const result = await dorm.postMessage(opened.data.id, opened.trackCode, messageBody)
    setSending(false)

    if (!result.ok) {
      toast(result.error.message, 'error')
      return
    }
    // 用服务端返回的留言与状态就地更新（服务端返回的才是真相），不再多发一次请求
    setOpened((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            data: {
              ...prev.data,
              status: result.value.caseStatus,
              updatedAt: result.value.message.createdAt,
              messages: [...prev.data.messages, result.value.message],
            },
          },
    )
    setMessageBody('')
    syncLocal()
    toast('留言已提交', 'success')
  }

  async function handleClose(): Promise<void> {
    if (opened === null || closing) return
    const confirmed = await Taro.showModal({
      title: '结束这次调解申请？',
      content: '结案后不能再留言。如果之后还需要沟通，可以重新提交一份申请。',
      confirmText: '结案',
    })
    if (!confirmed.confirm) return

    setClosing(true)
    const result = await dorm.close(opened.data.id, opened.trackCode)
    setClosing(false)

    if (!result.ok) {
      toast(result.error.message, 'error')
      return
    }
    setOpened((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            data: { ...prev.data, status: result.value.status, updatedAt: result.value.updatedAt },
          },
    )
    syncLocal()
    toast('已结案', 'success')
  }

  useDidShow(() => {
    syncLocal()
    if (opened !== null) {
      // 从别的页面回来时刷新进度
      void openCase(opened.trackCode)
      return
    }
    openInitialIfAny()
  })

  /* --------------------------- 二次同意门 --------------------------- */

  if (!consented) {
    return (
      <View className='kdy-page kdy-dorm'>
        <KdyHeading
          title='宿舍矛盾'
          subtitle='匿名提交、凭追踪码跟进的调解申请。'
          eyebrow='KEDAYA · 匿名调解'
        />

        {declined ? (
          <KdyCard title='已退出'>
            <Text className='kdy-dorm__p'>
              没有记录任何同意，也没有提交任何内容。你可以随时重新进入。
            </Text>
            <View className='kdy-dorm__actions'>
              <KdyButton onClick={() => setDeclined(false)}>重新进入</KdyButton>
            </View>
          </KdyCard>
        ) : (
          <KdyCard title='进入前请先阅读并同意' extra={<KdyTag tone='danger'>高敏感</KdyTag>}>
            <Text className='kdy-dorm__p'>
              这个模块处理宿舍矛盾，内容会被调解员（宿管 / 辅导员）人工阅读用于协调。请先确认：
            </Text>
            <Text className='kdy-dorm__li'>
              1. 案子与你的账号不关联：即使你已登录，提交也不会带上你的身份。
            </Text>
            <Text className='kdy-dorm__li'>
              2. 追踪码只在提交时返回一次，平台只保存它的哈希 —— 丢失后无法找回。
            </Text>
            <Text className='kdy-dorm__li'>
              3. 平台不提供「凭追踪码反查案件」的接口，换设备时请同时保留追踪码与案件编号。
            </Text>
            <Text className='kdy-dorm__li'>
              4. 匿名操作会写入合规审计，但审计记录的是「匿名」，不是你的实名。
            </Text>
            <Text className='kdy-dorm__li'>5. 你可以随时撤回同意；撤回后需要重新同意才能再次进入。</Text>
            <Text className='kdy-dorm__notice'>{DORM_HARMONY_EMERGENCY_NOTICE}</Text>
            <View className='kdy-dorm__actions'>
              <KdyButton block onClick={acceptConsent}>
                我已阅读并同意
              </KdyButton>
              <KdyButton block variant='ghost' onClick={declineConsent}>
                暂时不用
              </KdyButton>
            </View>
          </KdyCard>
        )}

        <Text className='kdy-disclaimer'>{DORM_HARMONY_PLATFORM_DISCLAIMER}</Text>
      </View>
    )
  }

  /* ----------------------------- 主流程 ----------------------------- */

  return (
    <View className='kdy-page kdy-dorm'>
      <KdyHeading
        title='宿舍矛盾'
        subtitle='匿名提交、凭追踪码跟进的调解申请。'
        eyebrow='KEDAYA · 匿名调解'
      />

      {/* 1. 提交 */}
      <KdyCard title='提交匿名调解申请' extra={<KdyTag tone='brand'>无需登录</KdyTag>}>
        <Text className='kdy-dorm__p'>
          只写事实，不要写姓名、学号、手机号。提交后会拿到一次性追踪码。
        </Text>
        <KdyField
          label='宿舍楼'
          value={building}
          onChange={setBuilding}
          placeholder='例如：1 号楼 302'
          maxLength={DORM_HARMONY_BUILDING_MAX}
          hint={`最多 ${DORM_HARMONY_BUILDING_MAX} 个字`}
        />
        <KdyField
          label='问题简述'
          value={topic}
          onChange={setTopic}
          placeholder='例如：作息不一致 / 卫生分工 / 噪音'
          maxLength={DORM_HARMONY_TOPIC_MAX}
          hint={`最多 ${DORM_HARMONY_TOPIC_MAX} 个字`}
        />
        <KdyField
          label='补充说明'
          value={detailText}
          onChange={setDetailText}
          placeholder='发生了什么、持续多久、你希望怎样解决（选填）'
          maxLength={DORM_HARMONY_DETAIL_MAX}
          hint={`${codePointLength(detailText)}/${DORM_HARMONY_DETAIL_MAX} 字（选填）`}
        />

        <Text className='kdy-dorm__label'>期望的处理方式</Text>
        <View className='kdy-dorm__chips'>
          <KdyChip active={expectation === ''} onClick={() => setExpectation('')}>
            不指定
          </KdyChip>
          {DORM_HARMONY_EXPECTATIONS.map((item) => (
            <KdyChip key={item} active={expectation === item} onClick={() => setExpectation(item)}>
              {DORM_HARMONY_EXPECTATION_LABELS[item]}
            </KdyChip>
          ))}
        </View>

        {problems.length > 0 && (
          <Text className='kdy-dorm__muted'>还需要完善：{problems.join('、')}</Text>
        )}
        {submitError !== null && <Text className='kdy-dorm__error'>{submitError}</Text>}

        <View className='kdy-dorm__actions'>
          <KdyButton
            block
            loading={submitting}
            disabled={problems.length > 0}
            onClick={() => void handleSubmit()}
          >
            提交申请
          </KdyButton>
        </View>
      </KdyCard>

      {/* 2. 一次性凭据 */}
      {credential !== null && (
        <KdyCard title='请立刻保存追踪码' extra={<KdyTag tone='danger'>仅此一次</KdyTag>}>
          <Text className='kdy-dorm__code'>{credential.trackCode}</Text>
          <Text className='kdy-dorm__muted'>案件编号：{credential.caseId}</Text>
          <Text className='kdy-dorm__p'>
            平台只保存追踪码的哈希，没有明文：关闭后无法再查看，丢失就无法找回，
            也无法凭它反查案件。请抄写或复制到只有你能看到的地方。
          </Text>
          <View className='kdy-dorm__actions'>
            <KdyButton onClick={() => copyText(credential.trackCode, '追踪码')}>复制追踪码</KdyButton>
            <KdyButton
              variant='ghost'
              onClick={() =>
                copyText(`${credential.caseId} ${credential.trackCode}`, '案件编号与追踪码')
              }
            >
              复制编号 + 追踪码
            </KdyButton>
          </View>
          <Text className='kdy-dorm__muted'>已在本机自动保存一份，下次打开还能看到进度。</Text>
        </KdyCard>
      )}

      {/* 3. 查看进度 */}
      <KdyCard title='凭追踪码查看进度' extra={<KdyTag tone='neutral'>无需登录</KdyTag>}>
        <Text className='kdy-dorm__p'>追踪码是本机与这份匿名申请之间的唯一凭据。</Text>

        {records.length === 0 ? (
          <Text className='kdy-dorm__muted'>
            本机还没有保存过追踪码。先提交一份申请，或者把追踪码与案件编号填到下面手动打开。
          </Text>
        ) : (
          <View className='kdy-dorm__chips'>
            {records.map((record) => (
              <KdyChip
                key={record.trackCode}
                active={selectedCode === record.trackCode}
                onClick={() => void openCase(record.trackCode)}
              >
                {`${record.summary.building}｜${record.summary.topic}`}
              </KdyChip>
            ))}
          </View>
        )}

        {selectedRecord !== null && (
          <View className='kdy-dorm__record'>
            <View className='kdy-dorm__record-head'>
              <Text className='kdy-dorm__record-title'>本机记录</Text>
              <KdyTag tone={statusTone(selectedRecord.summary.status)}>
                {selectedRecord.summary.statusLabel}
              </KdyTag>
            </View>
            <Text className='kdy-dorm__muted'>案件编号：{selectedRecord.summary.id}</Text>
            <Text className='kdy-dorm__muted'>保存于 {selectedRecord.summary.timeLabel}</Text>
            <View className='kdy-dorm__actions'>
              <KdyButton
                size='sm'
                variant='ghost'
                onClick={() => void openCase(selectedRecord.trackCode)}
              >
                刷新
              </KdyButton>
              <KdyButton
                size='sm'
                variant='ghost'
                onClick={() => copyText(selectedRecord.trackCode, '追踪码')}
              >
                复制追踪码
              </KdyButton>
              <KdyButton
                size='sm'
                variant='danger'
                onClick={() => void forgetRecord(selectedRecord.trackCode)}
              >
                从本机删除
              </KdyButton>
            </View>
          </View>
        )}

        <Text className='kdy-dorm__label'>手动打开</Text>
        <KdyField
          label='追踪码'
          value={manualCode}
          onChange={setManualCode}
          placeholder='例如：ABCD-EFGH-JKLM'
          maxLength={32}
          hint='大小写与空格会自动修正'
        />
        <KdyField
          label='案件编号'
          value={manualCaseId}
          onChange={setManualCaseId}
          placeholder='换设备时必填；本机有记录可留空'
          maxLength={64}
          hint='平台不提供凭追踪码反查案件，所以换设备需要它'
        />
        <View className='kdy-dorm__actions'>
          <KdyButton
            loading={openedLoading && opened === null}
            disabled={manualCode.trim() === ''}
            onClick={() =>
              void openCase(manualCode, manualCaseId.trim() === '' ? null : manualCaseId.trim())
            }
          >
            打开案件
          </KdyButton>
        </View>
      </KdyCard>

      {openedLoading && opened === null && <KdyEmpty mode='loading' />}

      {openedError !== null && opened === null && (
        <KdyEmpty
          mode='error'
          title='没能打开这份申请'
          description={openedError}
          actionText='重试'
          onAction={() => {
            void openCase(
              selectedCode ?? manualCode,
              manualCaseId.trim() === '' ? null : manualCaseId.trim(),
            )
          }}
        />
      )}

      {opened !== null && openedView !== null && (
        <KdyCard
          title='调解申请'
          extra={<KdyTag tone={statusTone(openedView.case.status)}>{openedView.case.statusLabel}</KdyTag>}
        >
          {openedLoading && <Text className='kdy-dorm__muted'>正在刷新…</Text>}
          {openedError !== null && <Text className='kdy-dorm__error'>{openedError}</Text>}

          <CaseFacts detail={openedView} detailText={opened.data.detail} />

          <Text className='kdy-dorm__label'>留言</Text>
          <MessageList messages={openedView.messages} />

          {openedView.canMessage ? (
            <>
              <KdyField
                label='追加留言'
                value={messageBody}
                onChange={setMessageBody}
                placeholder='补充进展、回应调解员（最多 2000 字）'
                maxLength={DORM_HARMONY_MESSAGE_MAX}
                hint={`${codePointLength(messageBody)}/${DORM_HARMONY_MESSAGE_MAX} 字`}
              />
              {messageBody.trim() !== '' && messageProblems.length > 0 && (
                <Text className='kdy-dorm__muted'>{messageProblems[0]}</Text>
              )}
              <View className='kdy-dorm__actions'>
                <KdyButton
                  loading={sending}
                  disabled={messageProblems.length > 0}
                  onClick={() => void handleSend()}
                >
                  发送留言
                </KdyButton>
                <KdyButton variant='danger' loading={closing} onClick={() => void handleClose()}>
                  结案
                </KdyButton>
              </View>
            </>
          ) : (
            <Text className='kdy-dorm__muted'>
              这份申请已经结案，不能再留言。如果还需要沟通，可以重新提交一份。
            </Text>
          )}
        </KdyCard>
      )}

      {/* 4. 边界与声明 */}
      <KdyCard title='关于匿名，请注意' elevated={false}>
        <Text className='kdy-dorm__li'>
          · 匿名不等于绝对不可追溯：内容会被调解员人工阅读，若涉及人身安全或违纪，平台可能依规配合校方处理。
        </Text>
        <Text className='kdy-dorm__li'>· 追踪码丢失后无法找回，平台也没有「凭它反查案件」的入口。</Text>
        <Text className='kdy-dorm__li'>· 请不要在内容里写他人的隐私；本模块不做心理诊断。</Text>
        <Text className='kdy-dorm__notice'>{DORM_HARMONY_EMERGENCY_NOTICE}</Text>
        <View className='kdy-dorm__actions'>
          <KdyButton size='sm' variant='ghost' onClick={revokeConsent}>
            撤回同意并退出
          </KdyButton>
        </View>
      </KdyCard>

      <Text className='kdy-disclaimer'>{DORM_HARMONY_PLATFORM_DISCLAIMER}</Text>
    </View>
  )
}
