import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/mock_tts_repository.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/result.dart';
import 'package:kedaya/domain/models/tts.dart';

/// 朗读的领域模型与纯函数。
///
/// ## 重心
///
/// 1. `splitForTts` **只在自然边界断开** —— 把词切成两半会让朗读像结巴
/// 2. `TtsAudio.absoluteUrl` 拼对了（播放器拿不到相对路径）
/// 3. `MockTtsRepository` **不假装能朗读**（返回 503 而不是假音频）
/// 4. 常量与 TS 契约一致（否则会出现「小程序能读、APK 说太长」）
void main() {
  group('splitForTts —— 长文切段', () {
    test('短文本原样返回', () {
      expect(splitForTts('你好'), <String>['你好']);
    });

    test('空文本返回空列表', () {
      expect(splitForTts(''), isEmpty);
      expect(splitForTts('   '), isEmpty);
    });

    test('⚠️ 优先在句末标点断开，不在词中间切', () {
      final String sentence = '这是一句完整的话。';
      final String text = sentence * 10;
      final List<String> chunks = splitForTts(text, maxLen: 30);
      expect(chunks.length, greaterThan(1));
      for (final String chunk in chunks.sublist(0, chunks.length - 1)) {
        expect(chunk.endsWith('。'), isTrue, reason: 'chunk=$chunk');
      }
      expect(chunks.join(), text);
    });

    test('没有句末标点时退到逗号', () {
      const String text = '第一段内容，第二段内容，第三段内容，第四段内容';
      final List<String> chunks = splitForTts(text, maxLen: 12);
      expect(chunks.length, greaterThan(1));
      for (final String chunk in chunks.sublist(0, chunks.length - 1)) {
        expect(chunk.endsWith('，'), isTrue, reason: 'chunk=$chunk');
      }
    });

    test('完全没有标点时硬切，但不丢字', () {
      final String text = '啊' * 100;
      final List<String> chunks = splitForTts(text, maxLen: 30);
      expect(chunks.join(), text);
      for (final String chunk in chunks) {
        expect(chunk.length, lessThanOrEqualTo(30));
      }
    });

    test('每段都不超过上限', () {
      final String text = '句子。' * 200;
      for (final int max in <int>[10, 50, 200]) {
        for (final String chunk in splitForTts(text, maxLen: max)) {
          expect(chunk.length, lessThanOrEqualTo(max), reason: 'max=$max');
        }
      }
    });

    test('默认上限就是契约里的 ttsTextMax', () {
      final String text = '好' * (ttsTextMax + 50);
      final List<String> chunks = splitForTts(text);
      expect(chunks.length, 2);
      expect(chunks[0].length, lessThanOrEqualTo(ttsTextMax));
    });

    test('⚠️ 不在英文单词中间切（否则会读成两个字母）', () {
      final String text = '${'内容' * 20} RTF ${'内容' * 20}';
      final List<String> chunks = splitForTts(text, maxLen: 45);
      expect(chunks.join(), contains('RTF'));
      for (int i = 0; i < chunks.length - 1; i += 1) {
        final bool bad = chunks[i].endsWith('RT') && chunks[i + 1].startsWith('F');
        expect(bad, isFalse, reason: 'RTF 被切开了');
      }
    });
  });

  group('validateTtsText', () {
    test('合法文本返回 null', () {
      expect(validateTtsText('测试文本'), isNull);
      expect(validateTtsText('好' * ttsTextMax), isNull);
    });

    test('空文本报错', () {
      expect(validateTtsText(''), isNotNull);
      expect(validateTtsText('   '), isNotNull);
    });

    test('超长报错，且提示里带上限数字', () {
      final String? problem = validateTtsText('好' * (ttsTextMax + 1));
      expect(problem, isNotNull);
      expect(problem, contains('$ttsTextMax'));
    });
  });

  group('TtsAudio', () {
    Map<String, Object?> json({String url = '/api/v1/tts/audio/abc'}) => <String, Object?>{
          'audioId': 'abc',
          'url': url,
          'sampleRate': 22050,
          'durationMs': 1500,
          'byteLength': 66150,
          'cached': false,
        };

    test('从 JSON 解析', () {
      final TtsAudio audio = TtsAudio.fromJson(json());
      expect(audio.audioId, 'abc');
      expect(audio.sampleRate, 22050);
      expect(audio.durationMs, 1500);
      expect(audio.byteLength, 66150);
      expect(audio.cached, isFalse);
    });

    test('缺 audioId / url 时抛 FormatException（不静默接受坏数据）', () {
      expect(
        () => TtsAudio.fromJson(<String, Object?>{'url': '/x'}),
        throwsA(isA<FormatException>()),
      );
      expect(
        () => TtsAudio.fromJson(<String, Object?>{'audioId': 'a'}),
        throwsA(isA<FormatException>()),
      );
    });

    test('⚠️ absoluteUrl 拼出播放器能用的绝对地址', () {
      final TtsAudio audio = TtsAudio.fromJson(json());
      expect(
        audio.absoluteUrl('https://api.example.com'),
        'https://api.example.com/api/v1/tts/audio/abc',
      );
      // 结尾多余的斜杠要被吃掉
      expect(
        audio.absoluteUrl('https://api.example.com/'),
        'https://api.example.com/api/v1/tts/audio/abc',
      );
    });

    test('已经是绝对地址时原样返回', () {
      final TtsAudio audio = TtsAudio.fromJson(
        json(url: 'https://cdn.example.com/a.wav'),
      );
      expect(audio.absoluteUrl('https://api.example.com'), 'https://cdn.example.com/a.wav');
    });
  });

  group('MockTtsRepository —— 不假装能朗读', () {
    const MockTtsRepository repo = MockTtsRepository();

    test('⚠️ 返回 503 而不是假音频', () async {
      final Result<TtsAudio> result = await repo.synthesize('测试');
      expect(result, isA<Err<TtsAudio>>());
      final ApiError error = (result as Err<TtsAudio>).error;
      expect(error.code, ApiErrorCode.upstreamUnavailable);
      // 文案要说清是「当前模式」的限制，不是网络问题
      expect(error.message, contains('演示模式'));
    });

    test('超长文本先被本地校验拦住（不占用网络往返）', () async {
      final Result<TtsAudio> result = await repo.synthesize('好' * (ttsTextMax + 1));
      expect(result, isA<Err<TtsAudio>>());
      expect((result as Err<TtsAudio>).error.code, ApiErrorCode.validationFailed);
    });
  });

  group('常量与 TS 契约一致', () {
    test('字数上限、语速范围、采样率', () {
      expect(ttsTextMax, 500);
      expect(ttsTextMin, 1);
      expect(ttsSpeedMin, 0.5);
      expect(ttsSpeedMax, 2.0);
      expect(ttsSampleRate, 22050);
    });
  });
}
