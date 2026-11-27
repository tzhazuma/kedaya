import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../../../presentation/components/kedaya_shell.dart';
import '../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../presentation/theme/kedaya_tokens.dart';

/// ELRC 录播播放页（m3u8）。
///
/// 只覆盖移动端：`video_player` 的 Android 用 ExoPlayer、iOS 用 AVPlayer，
/// 两者都原生支持 HLS；桌面端没有官方实现，页面给出明确降级文案而不是黑屏。
class ElrcPlayerPage extends StatefulWidget {
  const ElrcPlayerPage({
    required this.url,
    required this.title,
    super.key,
  });

  final String url;
  final String title;

  @override
  State<ElrcPlayerPage> createState() => _ElrcPlayerPageState();
}

class _ElrcPlayerPageState extends State<ElrcPlayerPage> {
  VideoPlayerController? _controller;
  String? _error;

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  Future<void> _initialize() async {
    final VideoPlayerController controller =
        VideoPlayerController.networkUrl(Uri.parse(widget.url));
    try {
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() => _controller = controller);
      await controller.play();
    } on Object catch (error) {
      await controller.dispose();
      if (!mounted) return;
      setState(() => _error = '无法播放：$error');
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final VideoPlayerController? controller = _controller;
    return KedaYaPageScaffold(
      title: widget.title,
      maxContentWidth: null,
      child: Center(
        child: _error != null
            ? Text(
                _error!,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  color: colors.danger,
                ),
              )
            : controller == null
                ? const CircularProgressIndicator()
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      AspectRatio(
                        aspectRatio: controller.value.aspectRatio == 0
                            ? 16 / 9
                            : controller.value.aspectRatio,
                        child: VideoPlayer(controller),
                      ),
                      const SizedBox(height: KedaYaTokens.space3),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: <Widget>[
                          IconButton(
                            tooltip: '播放 / 暂停',
                            onPressed: () {
                              if (controller.value.isPlaying) {
                                controller.pause();
                              } else {
                                controller.play();
                              }
                              setState(() {});
                            },
                            icon: Icon(
                              controller.value.isPlaying
                                  ? Icons.pause
                                  : Icons.play_arrow,
                            ),
                          ),
                          Text(
                            '${_format(controller.value.position)} / '
                            '${_format(controller.value.duration)}',
                            style: TextStyle(
                              fontSize: KedaYaTokens.fontSizeSm,
                              color: colors.textMuted,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
      ),
    );
  }

  static String _format(Duration duration) {
    final int minutes = duration.inMinutes;
    final int seconds = duration.inSeconds % 60;
    return '$minutes:${seconds.toString().padLeft(2, '0')}';
  }
}

const String elrcPlayerRoutePath = '/elrc/player';
