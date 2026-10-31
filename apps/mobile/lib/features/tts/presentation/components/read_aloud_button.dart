import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/app_providers.dart';
import '../../../../domain/models/api_error.dart';
import '../../../../domain/models/result.dart';
import '../../../../domain/models/tts.dart';
import '../../../../domain/ports/tts_port.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 「朗读」按钮（Flutter 端）。
///
/// ## 与小程序 / Web 的行为一致
///
/// 长文按句子切段、逐段合成、逐段播放；服务端 503（模型没装）要说成
/// 「功能暂不可用（部署问题）」而不是「网络错误」。
///
/// ## 为什么播放用 `audioplayers`
///
/// Flutter 没有内置的 URL 音频播放。`audioplayers` 是体积最小、API 最直接的
/// 选择（`just_audio` 功能更多但我们用不上）。
class ReadAloudButton extends ConsumerStatefulWidget {
  const ReadAloudButton({required this.text, super.key});

  final String text;

  @override
  ConsumerState<ReadAloudButton> createState() => _ReadAloudButtonState();
}

enum _Phase { idle, synthesizing, playing, error }

class _ReadAloudButtonState extends ConsumerState<ReadAloudButton> {
  _Phase _phase = _Phase.idle;
  String? _error;
  int _index = 0;
  int _total = 0;

  final AudioPlayer _player = AudioPlayer();

  /// 已取消：异步流程中途要能放弃（dispose / 再点一次）
  bool _cancelled = false;

  @override
  void dispose() {
    _cancelled = true;
    unawaited(_player.dispose());
    super.dispose();
  }

  Future<void> _stop() async {
    _cancelled = true;
    await _player.stop();
    if (!mounted) return;
    setState(() {
      _phase = _Phase.idle;
      _error = null;
      _index = 0;
      _total = 0;
    });
  }

  Future<void> _start() async {
    final String trimmed = widget.text.trim();
    final String? problem = validateTtsText(trimmed);
    if (problem != null) {
      setState(() {
        _phase = _Phase.error;
        _error = problem;
      });
      return;
    }

    _cancelled = false;
    setState(() {
      _phase = _Phase.synthesizing;
      _error = null;
    });

    final List<String> chunks = splitForTts(trimmed);
    setState(() {
      _total = chunks.length;
      _index = 0;
    });

    final TtsPort port = ref.read(ttsRepositoryProvider);
    final String baseUrl = ref.read(appRuntimeProvider).environment.apiBaseUrl;

    for (int i = 0; i < chunks.length; i += 1) {
      if (_cancelled || !mounted) return;
      setState(() => _index = i);

      final Result<TtsAudio> result = await port.synthesize(chunks[i]);
      if (_cancelled || !mounted) return;

      if (result is Err<TtsAudio>) {
        setState(() {
          _phase = _Phase.error;
          // ⚠️ 503（UPSTREAM_UNAVAILABLE）是**部署问题**，不能说成网络问题
          _error = result.error.code == ApiErrorCode.upstreamUnavailable
              ? '朗读功能暂不可用（服务端未安装语音模型，这是部署问题，不是你的网络问题）'
              : '这次朗读失败了，换一段文本或稍后再试';
        });
        return;
      }

      final TtsAudio audio = (result as Ok<TtsAudio>).value;
      setState(() => _phase = _Phase.playing);

      try {
        await _player.play(UrlSource(audio.absoluteUrl(baseUrl)));
        // 等到这一段播完（`onPlayerComplete` 只触发一次，用 Completer 等）
        await _player.onPlayerComplete.first;
      } catch (_) {
        if (_cancelled || !mounted) return;
        setState(() {
          _phase = _Phase.error;
          _error = '音频播放失败';
        });
        return;
      }
    }

    if (!_cancelled && mounted) {
      setState(() {
        _phase = _Phase.idle;
        _index = 0;
        _total = 0;
      });
    }
  }

  bool get _busy => _phase == _Phase.synthesizing || _phase == _Phase.playing;

  String get _label {
    switch (_phase) {
      case _Phase.synthesizing:
        return _total <= 1 ? '正在生成语音…' : '正在生成语音…（${_index + 1}/$_total）';
      case _Phase.playing:
        return _total <= 1 ? '正在朗读，点击停止' : '正在朗读（${_index + 1}/$_total），点击停止';
      case _Phase.error:
        return '重试朗读';
      case _Phase.idle:
        return '朗读';
    }
  }

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    final Color border = _phase == _Phase.error
        ? colors.error
        : _busy
            ? KedaYaTokens.colorSuccess
            : colors.outline;
    final Color fg = _phase == _Phase.error
        ? colors.error
        : _busy
            ? KedaYaTokens.colorSuccess
            : colors.onSurface;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        OutlinedButton(
          onPressed: () {
            if (_busy) {
              unawaited(_stop());
            } else {
              unawaited(_start());
            }
          },
          style: OutlinedButton.styleFrom(
            side: BorderSide(color: border),
            foregroundColor: fg,
            padding: const EdgeInsets.symmetric(
              horizontal: KedaYaTokens.space3,
              vertical: KedaYaTokens.space1,
            ),
            minimumSize: Size.zero,
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              // 用文字符号而不是图标：不需要额外资源，且与小程序端一致
              Text(_busy ? '■' : '▶', style: const TextStyle(fontSize: 10)),
              const SizedBox(width: KedaYaTokens.space1),
              Text(_label, style: const TextStyle(fontSize: 12)),
            ],
          ),
        ),
        if (_error != null) ...<Widget>[
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            _error!,
            style: TextStyle(color: colors.error, fontSize: 11),
          ),
        ],
      ],
    );
  }
}

/// 忽略 future（`unawaited` 的本地实现，避免为一行代码引入 `dart:async` 前缀）
void unawaited(Future<void> future) {
  future.ignore();
}
