import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  TTS_ERROR_MESSAGES,
  splitForTts,
  ttsAudioUrl,
  type TtsErrorCode,
  type TtsSynthesizeResponse,
} from '@kedaya/contracts'

import { getContainer } from '../../../app/container'
import './index.scss'

/**
 * 「朗读」按钮 —— 把一段文字用 sherpa-onnx 合成语音播出来。
 *
 * ## 为什么是「服务端合成」
 *
 * 模型是 60 MB 的 ONNX，小程序主包只剩约 340 KiB，放不下。
 * 所以这里只做三件事：把文本发给 `POST /tts/synthesize` 拿 `audioId`，
 * 用 `GET /tts/audio/:id` 的地址喂给 `InnerAudioContext`，然后播。
 *
 * ## 长文怎么处理
 *
 * 契约规定单次最多 500 字。更长的文本用 `splitForTts` 在**句子边界**切开，
 * 一段一段合成、一段一段播 —— 用户听到的是连续的朗读，
 * 而不是「文本太长」的报错。
 *
 * ## 失败时的诚实
 *
 * - `model-unavailable`（503）→ 直接说「朗读功能暂不可用」，并说明是部署问题。
 *   不要显示「网络错误」—— 那会让用户去检查自己的网。
 * - 其它错误 → 允许重试。
 */
export interface KdyReadAloudProps {
  /** 要朗读的文本 */
  text: string
  className?: string
}

type ReadState = 'idle' | 'synthesizing' | 'playing' | 'error'

/** 把服务端返回的相对 url 变成绝对地址（InnerAudioContext 需要绝对路径） */
function absoluteUrl(baseUrl: string, relative: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  return `${base}${relative.startsWith('/') ? '' : '/'}${relative}`
}

export function KdyReadAloud({ text, className }: KdyReadAloudProps) {
  const [state, setState] = useState<ReadState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null)

  const audioRef = useRef<Taro.InnerAudioContext | null>(null)
  /** 已停止：异步流程中途要能放弃（组件卸载 / 用户再点一次） */
  const cancelledRef = useRef(false)

  const stop = useCallback(() => {
    cancelledRef.current = true
    const audio = audioRef.current
    if (audio !== null) {
      audio.stop()
      audio.destroy()
      audioRef.current = null
    }
    setState('idle')
    setProgress(null)
  }, [])

  // 卸载时一定要销毁，否则小程序里音频会继续播
  useEffect(() => {
    return () => {
      cancelledRef.current = true
      const audio = audioRef.current
      if (audio !== null) {
        audio.stop()
        audio.destroy()
        audioRef.current = null
      }
    }
  }, [])

  const start = useCallback(async () => {
    const container = getContainer()
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      setState('error')
      setErrorMessage(TTS_ERROR_MESSAGES['text-empty'])
      return
    }

    cancelledRef.current = false
    setState('synthesizing')
    setErrorMessage(null)

    const chunks = splitForTts(trimmed)
    setProgress({ index: 0, total: chunks.length })

    // 逐段合成并播放。一段失败就整体失败 —— 半截朗读比不朗读更困惑。
    for (let i = 0; i < chunks.length; i += 1) {
      if (cancelledRef.current) return
      setProgress({ index: i, total: chunks.length })

      const result = await container.apiClient.post<TtsSynthesizeResponse, { text: string }>(
        '/tts/synthesize',
        { text: chunks[i] ?? '' },
      )

      if (cancelledRef.current) return

      if (!result.ok) {
        // ⚠️ 把 503 单独说出来：这是部署问题，不是用户的网络问题
        const code = (result.error.details as { code?: string } | undefined)?.code
        const known = code !== undefined && code in TTS_ERROR_MESSAGES
        setState('error')
        setErrorMessage(
          known
            ? TTS_ERROR_MESSAGES[code as TtsErrorCode]
            : result.error.code === 'UPSTREAM_UNAVAILABLE'
              ? TTS_ERROR_MESSAGES['model-unavailable']
              : TTS_ERROR_MESSAGES['synthesis-failed'],
        )
        setProgress(null)
        return
      }

      const url = absoluteUrl(container.env.apiBaseUrl, result.value.url)

      const finished = await new Promise<boolean>((resolve) => {
        const audio = Taro.createInnerAudioContext()
        audioRef.current = audio
        audio.src = url
        audio.onEnded(() => {
          audio.destroy()
          if (audioRef.current === audio) audioRef.current = null
          resolve(true)
        })
        audio.onError(() => {
          audio.destroy()
          if (audioRef.current === audio) audioRef.current = null
          resolve(false)
        })
        setState('playing')
        audio.play()
      })

      if (!finished) {
        if (cancelledRef.current) return
        setState('error')
        setErrorMessage(TTS_ERROR_MESSAGES['synthesis-failed'])
        setProgress(null)
        return
      }
    }

    if (!cancelledRef.current) {
      setState('idle')
      setProgress(null)
    }
  }, [text])

  const busy = state === 'synthesizing' || state === 'playing'

  const label = (() => {
    switch (state) {
      case 'synthesizing':
        return progress === null || progress.total <= 1
          ? '正在生成语音…'
          : `正在生成语音…（${progress.index + 1}/${progress.total}）`
      case 'playing':
        return progress === null || progress.total <= 1
          ? '正在朗读，点击停止'
          : `正在朗读（${progress.index + 1}/${progress.total}），点击停止`
      case 'error':
        return '重试朗读'
      default:
        return '朗读'
    }
  })()

  return (
    <View className={['kdy-read-aloud', className ?? ''].filter((c) => c !== '').join(' ')}>
      <View
        className={[
          'kdy-read-aloud__button',
          busy ? 'kdy-read-aloud__button--busy' : '',
          state === 'error' ? 'kdy-read-aloud__button--error' : '',
        ]
          .filter((c) => c !== '')
          .join(' ')}
        onClick={() => {
          if (busy) {
            stop()
            return
          }
          void start()
        }}
      >
        {/* 用文字符号而不是图标字体：小程序里图标字体要么额外体积，要么不可用 */}
        <Text className='kdy-read-aloud__icon'>{busy ? '■' : '▶'}</Text>
        <Text className='kdy-read-aloud__label'>{label}</Text>
      </View>

      {errorMessage !== null && <Text className='kdy-read-aloud__error'>{errorMessage}</Text>}
    </View>
  )
}

export { ttsAudioUrl }
