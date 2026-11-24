import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../presentation/components/kedaya_shell.dart';
import '../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../presentation/theme/kedaya_tokens.dart';
import '../../campus_web/domain/campus_bridge_protocol.dart';
import '../../campus_web/presentation/campus_web_page.dart' show campusWebSupported;
import '../data/elrc_client.dart';
import '../domain/elrc_models.dart';

/// 课程录播（ELRC）。
///
/// 页面先加载 ELRC 的录播首页（用户在这里完成登录），再通过同源桥拉课程列表；
/// 点开某门课就地展开课次。所有请求都在页面内发，Dart 侧不接触 cookie。
class ElrcPage extends StatefulWidget {
  const ElrcPage({super.key});

  @override
  State<ElrcPage> createState() => _ElrcPageState();
}

class _ElrcPageState extends State<ElrcPage> {
  static const String _entry =
      'https://elrc.shanghaitech.edu.cn/learn/videoreview?type=1';

  WebViewController? _controller;
  final Map<String, Completer<CampusBridgeResponse>> _pending =
      <String, Completer<CampusBridgeResponse>>{};

  bool _loading = true;
  String? _error;
  bool _needsLogin = false;
  List<ElrcCourse> _courses = <ElrcCourse>[];
  final Map<String, List<ElrcLesson>> _lessons = <String, List<ElrcLesson>>{};
  String? _expanded;

  bool get _supported => !kIsWeb && campusWebSupported(defaultTargetPlatform);

  ElrcClient get _client => ElrcClient(_request);

  @override
  void initState() {
    super.initState();
    if (!_supported) {
      _loading = false;
      return;
    }
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel(
        'KedayaBridge',
        onMessageReceived: (JavaScriptMessage message) {
          final CampusBridgeResponse? response =
              CampusBridgeResponse.decode(message.message);
          if (response == null) return;
          _pending.remove(response.id)?.complete(response);
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (String url) {
            _controller?.runJavaScript(campusBridgeScript);
          },
        ),
      )
      ..loadRequest(Uri.parse(_entry));
    _loadCourses();
  }

  Future<CampusBridgeResponse> _request(CampusBridgeRequest request) async {
    final WebViewController? controller = _controller;
    if (controller == null) {
      return CampusBridgeResponse(
        id: request.id,
        status: 0,
        body: '',
        error: '当前平台没有内嵌浏览器',
      );
    }
    final Completer<CampusBridgeResponse> completer =
        Completer<CampusBridgeResponse>();
    _pending[request.id] = completer;
    await controller.runJavaScript(
      'kedayaRequest(${jsonEncode(request.encode())})',
    );
    return completer.future.timeout(
      const Duration(seconds: 20),
      onTimeout: () {
        _pending.remove(request.id);
        return CampusBridgeResponse(
          id: request.id,
          status: 0,
          body: '',
          error: '请求超时',
        );
      },
    );
  }

  Future<void> _loadCourses() async {
    setState(() {
      _loading = true;
      _error = null;
      _needsLogin = false;
    });
    try {
      final List<ElrcCourse> courses = await _client.courses();
      if (!mounted) return;
      setState(() {
        _courses = courses;
        _loading = false;
      });
    } on ElrcException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.message;
        _needsLogin = error.needsLogin;
      });
    }
  }

  Future<void> _toggleLessons(ElrcCourse course) async {
    final String key = course.referer.toString();
    if (_expanded == key) {
      setState(() => _expanded = null);
      return;
    }
    setState(() => _expanded = key);
    if (_lessons.containsKey(key)) return;
    try {
      final List<ElrcLesson> lessons = await _client.lessons(course);
      if (!mounted) return;
      setState(() => _lessons[key] = lessons);
    } on ElrcException catch (error) {
      if (!mounted) return;
      setState(() {
        _lessons[key] = <ElrcLesson>[];
        _error = error.message;
        _needsLogin = error.needsLogin;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    if (!_supported) {
      return KedaYaPageScaffold(
        title: '课程录播',
        child: Center(
          child: Text(
            '当前平台没有内嵌浏览器。请在手机上使用，或打开 '
            'elrc.shanghaitech.edu.cn 观看。',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              color: colors.textMuted,
            ),
          ),
        ),
      );
    }

    return KedaYaPageScaffold(
      title: '课程录播',
      padding: EdgeInsets.zero,
      actions: <Widget>[
        IconButton(
          tooltip: '重新加载',
          onPressed: _loadCourses,
          icon: const Icon(Icons.refresh),
        ),
      ],
      child: Column(
        children: <Widget>[
          if (_loading)
            const Padding(
              padding: EdgeInsets.all(KedaYaTokens.space3),
              child: LinearProgressIndicator(),
            ),
          if (_error != null)
            Container(
              width: double.infinity,
              color: colors.surfaceAlt,
              padding: const EdgeInsets.all(KedaYaTokens.space3),
              child: Text(
                _needsLogin ? '登录已失效：请在上方页面重新登录后点刷新' : _error!,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: _needsLogin ? colors.warning : colors.danger,
                ),
              ),
            ),
          Expanded(
            flex: 2,
            child: WebViewWidget(controller: _controller!),
          ),
          const Divider(height: 1),
          Expanded(
            flex: 3,
            child: _courses.isEmpty
                ? Center(
                    child: Text(
                      _loading ? '正在读取课程…' : '还没有课程（先在上方页面登录）',
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeSm,
                        color: colors.textMuted,
                      ),
                    ),
                  )
                : ListView.builder(
                    itemCount: _courses.length,
                    itemBuilder: (BuildContext context, int index) {
                      final ElrcCourse course = _courses[index];
                      final String key = course.referer.toString();
                      final List<ElrcLesson>? lessons = _lessons[key];
                      return Column(
                        children: <Widget>[
                          ListTile(
                            title: Text(course.name),
                            subtitle: Text(
                              course.description.isEmpty
                                  ? course.courseId
                                  : course.description,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            trailing: Icon(
                              _expanded == key ? Icons.expand_less : Icons.expand_more,
                            ),
                            onTap: () => _toggleLessons(course),
                          ),
                          if (_expanded == key)
                            if (lessons == null)
                              const Padding(
                                padding: EdgeInsets.all(KedaYaTokens.space2),
                                child: LinearProgressIndicator(),
                              )
                            else if (lessons.isEmpty)
                              Padding(
                                padding: const EdgeInsets.all(KedaYaTokens.space2),
                                child: Text(
                                  '这门课程暂无录播课次',
                                  style: TextStyle(
                                    fontSize: KedaYaTokens.fontSizeXs,
                                    color: colors.textMuted,
                                  ),
                                ),
                              )
                            else
                              for (final ElrcLesson lesson in lessons)
                                Padding(
                                  padding: const EdgeInsets.only(
                                    left: KedaYaTokens.space6,
                                    right: KedaYaTokens.space4,
                                    bottom: KedaYaTokens.space2,
                                  ),
                                  child: Row(
                                    children: <Widget>[
                                      Expanded(
                                        child: Text(
                                          '${lesson.title}'
                                          '${lesson.weekDate.isEmpty ? '' : ' · ${lesson.weekDate}'}',
                                          style: TextStyle(
                                            fontSize: KedaYaTokens.fontSizeSm,
                                            color: colors.text,
                                          ),
                                        ),
                                      ),
                                      Text(
                                        '${lesson.scheduleIds.length} 个机位',
                                        style: TextStyle(
                                          fontSize: KedaYaTokens.fontSizeXs,
                                          color: colors.textMuted,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                        ],
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

const String elrcRoutePath = '/elrc';
