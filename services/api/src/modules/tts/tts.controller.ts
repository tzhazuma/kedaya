/**
 * 朗读 · tts —— 控制器
 *
 * 路由一览（都在 `/api/v1/tts` 下）：
 *   POST /synthesize        合成一段文本 → `{ audioId, url, durationMs, ... }`
 *   GET  /audio/:audioId    取 WAV（**公开**，播放器直接当 src 用）
 *   GET  /status            模型是否就绪（运维/健康检查用）
 *
 * ## 为什么 `/audio/:audioId` 是公开的
 *
 * 1. 播放器（`<audio>` / `InnerAudioContext` / Flutter 播放器）只会发 GET，
 *    带不上 Authorization 头
 * 2. `audioId` 是**内容哈希**，能拿到它就说明有人合成过这段文本；
 *    而朗读的内容本来就是公开的（FAQ 答案、茶歇说明…）
 * 3. 不公开的话，小程序侧就得先下载再转本地文件，复杂度不成比例
 *
 * ## 为什么 `/synthesize` 要登录
 *
 * 合成是 CPU 密集操作。不设门槛的话，一个匿名脚本就能把服务打满。
 * 登录 + 契约里的 500 字上限，已经能把滥用成本抬到不划算。
 */
import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  TTS_SPEED_MAX,
  TTS_SPEED_MIN,
  TTS_TEXT_MAX,
  TTS_ERROR_MESSAGES,
  type TtsSynthesizeResponse,
} from '@kedaya/contracts';

import { AuthGuard } from '../../common/auth/auth.guard';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { TtsService } from './application/tts.service';

const synthesizeSchema = z
  .object({
    text: z.string().min(1).max(TTS_TEXT_MAX),
    speed: z.number().min(TTS_SPEED_MIN).max(TTS_SPEED_MAX).optional(),
  })
  .strict();

type SynthesizeBody = z.infer<typeof synthesizeSchema>;

/** 最小可用的 Express 响应类型（避免为了一个 res 去 import express 类型） */
interface WavResponse {
  setHeader(name: string, value: string): void;
  end(body: Buffer): void;
  status(code: number): WavResponse;
}

@ApiTags('tts')
@Controller('tts')
export class TtsController {
  constructor(@Inject(TtsService) private readonly service: TtsService) {}

  @Post('synthesize')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '合成朗读音频',
    description:
      '把一段文本转成 WAV（22050 Hz 单声道）。单次最多 500 字；' +
      '长文请用 `splitForTts` 在客户端切段。同一文本 + 语速会命中缓存。',
  })
  async synthesize(
    @ZodBody(synthesizeSchema) body: SynthesizeBody,
  ): Promise<TtsSynthesizeResponse> {
    const outcome = await this.service.synthesize(body.text, body.speed);
    if (!outcome.ok) {
      // ⚠️ 状态码区分「部署问题」与「输入问题」，运维看码就知道查哪边：
      //   503 = 模型没装（跑 tools/fetch-tts-model.mjs）
      //   400 = 这次的文本/语速不合法
      const status =
        outcome.code === 'model-unavailable'
          ? HttpStatus.SERVICE_UNAVAILABLE
          : HttpStatus.BAD_REQUEST;
      throw new HttpException(
        { code: outcome.code, message: TTS_ERROR_MESSAGES[outcome.code] },
        status,
      );
    }
    return outcome.result;
  }

  @Get('audio/:audioId')
  @Header('Cache-Control', 'public, max-age=86400, immutable')
  @ApiOperation({
    summary: '取朗读音频（WAV）',
    description: '`audioId` 来自 `POST /synthesize`。内容哈希寻址，可长期缓存。',
  })
  audio(@Param('audioId') audioId: string, @Res() res: WavResponse): void {
    // 只接受 32 位小写十六进制，防止路径穿越与缓存投毒
    if (!/^[0-9a-f]{32}$/.test(audioId)) {
      res.status(400).end(Buffer.from(TTS_ERROR_MESSAGES['audio-not-found']));
      return;
    }
    const wav = this.service.getAudio(audioId);
    if (wav === null) {
      res.status(404).end(Buffer.from(TTS_ERROR_MESSAGES['audio-not-found']));
      return;
    }
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', String(wav.byteLength));
    res.end(wav);
  }

  @Get('status')
  @ApiOperation({
    summary: '朗读能力状态',
    description: '`installed: false` 表示模型没下载 —— 这是部署问题，不是 bug。',
  })
  status(): {
    installed: boolean;
    cache: { entries: number; bytes: number };
    sampleRate: number;
  } {
    return {
      installed: this.service.isModelInstalled(),
      cache: this.service.cacheStats(),
      sampleRate: 22050,
    };
  }
}
