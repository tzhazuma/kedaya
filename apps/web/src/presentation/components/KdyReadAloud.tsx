'use client';

/**
 * 「朗读」按钮（Web 端）。
 *
 * ## 与小程序端的差异
 *
 * 小程序用 `InnerAudioContext`，Web 用 `<audio>`。但两端的**行为**必须一致：
 * 长文按句子切段、逐段合成、逐段播放；`model-unavailable`（503）要说成
 * 「功能暂不可用」而不是「网络错误」。
 *
 * ## 为什么用 `new Audio()` 而不是 React 管理的 `<audio>` 元素
 *
 * 逐段播放需要「一段播完再播下一段」，用命令式的 `Audio` 对象最直接；
 * 放进 JSX 反而要处理 `src` 变更与 `ended` 竞态。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  TTS_ERROR_MESSAGES,
  splitForTts,
  type TtsErrorCode,
  type TtsSynthesizeResponse,
} from '@kedaya/contracts';

import { getApiClient } from '../../data/api/client';
import { cn } from '../theme/cn';

type ReadState = 'idle' | 'synthesizing' | 'playing' | 'error';

export interface KdyReadAloudProps {
  /** 要朗读的文本 */
  text: string;
  className?: string;
}

/** 把服务端返回的相对 url 变成绝对地址（`<audio>` 需要绝对路径） */
function absoluteUrl(baseUrl: string, relative: string): string {
  // baseUrl 可能是 `/api/v1`（同源）或 `https://api.example.com/api/v1`
  if (relative.startsWith('http')) return relative;
  // 相对 url 已经是 `/api/v1/tts/audio/...`，不要再拼 baseUrl
  return relative;
}

export function KdyReadAloud({ text, className }: KdyReadAloudProps) {
  const [state, setState] = useState<ReadState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cancelledRef = useRef(false);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    const audio = audioRef.current;
    if (audio !== null) {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    }
    setState('idle');
    setProgress(null);
  }, []);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      const audio = audioRef.current;
      if (audio !== null) {
        audio.pause();
        audio.src = '';
        audioRef.current = null;
      }
    };
  }, []);

  const start = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      setState('error');
      setErrorMessage(TTS_ERROR_MESSAGES['text-empty']);
      return;
    }

    cancelledRef.current = false;
    setState('synthesizing');
    setErrorMessage(null);

    const chunks = splitForTts(trimmed);
    setProgress({ index: 0, total: chunks.length });

    const client = getApiClient();

    for (let i = 0; i < chunks.length; i += 1) {
      if (cancelledRef.current) return;
      setProgress({ index: i, total: chunks.length });

      const result = await client.post<TtsSynthesizeResponse>('/tts/synthesize', {
        text: chunks[i] ?? '',
      });

      if (cancelledRef.current) return;

      if (!result.ok) {
        // ⚠️ 503 要说成「功能暂不可用（部署问题）」，不是「网络错误」
        const details = result.error.details as { code?: string } | undefined;
        const code = details?.code;
        const known = code !== undefined && code in TTS_ERROR_MESSAGES;
        setState('error');
        setErrorMessage(
          known
            ? TTS_ERROR_MESSAGES[code as TtsErrorCode]
            : result.error.code === 'UPSTREAM_UNAVAILABLE'
              ? TTS_ERROR_MESSAGES['model-unavailable']
              : TTS_ERROR_MESSAGES['synthesis-failed'],
        );
        setProgress(null);
        return;
      }

      const url = absoluteUrl(client.baseUrl, result.value.url);

      const finished = await new Promise<boolean>((resolve) => {
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          if (audioRef.current === audio) audioRef.current = null;
          resolve(true);
        };
        audio.onerror = () => {
          if (audioRef.current === audio) audioRef.current = null;
          resolve(false);
        };
        setState('playing');
        void audio.play().catch(() => {
          if (audioRef.current === audio) audioRef.current = null;
          resolve(false);
        });
      });

      if (!finished) {
        if (cancelledRef.current) return;
        setState('error');
        setErrorMessage(TTS_ERROR_MESSAGES['synthesis-failed']);
        setProgress(null);
        return;
      }
    }

    if (!cancelledRef.current) {
      setState('idle');
      setProgress(null);
    }
  }, [text]);

  const busy = state === 'synthesizing' || state === 'playing';

  const label = (() => {
    switch (state) {
      case 'synthesizing':
        return progress === null || progress.total <= 1
          ? '正在生成语音…'
          : `正在生成语音…（${progress.index + 1}/${progress.total}）`;
      case 'playing':
        return progress === null || progress.total <= 1
          ? '正在朗读，点击停止'
          : `正在朗读（${progress.index + 1}/${progress.total}），点击停止`;
      case 'error':
        return '重试朗读';
      default:
        return '朗读';
    }
  })();

  return (
    <div className={cn('mt-2', className)}>
      <button
        type="button"
        onClick={() => {
          if (busy) {
            stop();
            return;
          }
          void start();
        }}
        aria-label={label}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border px-3 py-1 text-xs transition-colors',
          state === 'error'
            ? 'border-danger text-danger hover:opacity-90'
            : busy
              ? 'border-success text-success hover:opacity-90'
              : 'border-border text-body hover:bg-surface-alt',
        )}
      >
        <span aria-hidden className="text-[10px] leading-none">
          {busy ? '■' : '▶'}
        </span>
        <span>{label}</span>
      </button>

      {errorMessage !== null && <p className="mt-1 text-xs text-danger">{errorMessage}</p>}
    </div>
  );
}
