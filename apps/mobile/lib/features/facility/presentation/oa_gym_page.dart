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
import '../data/oa_gym_client.dart';

/// OA 体育馆空闲查询（只读）。
///
/// 上半屏是 OA 页面（用户在这里完成登录），下半屏按「时段 × 运动」列出空闲场地。
/// OA 体育馆入口（内嵌页与桌面端的系统浏览器共用同一个地址）。
const String oaGymEntryUrl =
    'https://oa.shanghaitech.edu.cn/wui/main.jsp?templateId=1';

class OaGymPage extends StatefulWidget {
  const OaGymPage({super.key});

  @override
  State<OaGymPage> createState() => _OaGymPageState();
}

class _OaGymPageState extends State<OaGymPage> {
  static const String _entry = oaGymEntryUrl;

  WebViewController? _controller;
  final Map<String, Completer<CampusBridgeResponse>> _pending =
      <String, Completer<CampusBridgeResponse>>{};

  DateTime _date = DateTime.now();
  final Set<OaSport> _sports = <OaSport>{OaSport.badminton, OaSport.tennis};
  bool _loading = false;
  final TextEditingController _name = TextEditingController();
  final TextEditingController _studentId = TextEditingController();
  final TextEditingController _phone = TextEditingController();
  String? _error;
  bool _sessionExpired = false;
  List<OaAvailability> _rows = <OaAvailability>[];

  bool get _supported => !kIsWeb && campusWebSupported(defaultTargetPlatform);

  OaGymClient get _client => OaGymClient(_request);

  @override
  void initState() {
    super.initState();
    if (!_supported) return;
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
          onPageFinished: (String url) =>
              _controller?.runJavaScript(campusBridgeScript),
        ),
      )
      ..loadRequest(Uri.parse(_entry));
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

  String get _dateParam =>
      '${_date.year.toString().padLeft(4, '0')}-'
      '${_date.month.toString().padLeft(2, '0')}-'
      '${_date.day.toString().padLeft(2, '0')}';

  Future<void> _query() async {
    if (_sports.isEmpty) {
      setState(() => _error = '至少选一个运动');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
      _sessionExpired = false;
    });
    try {
      final List<OaAvailability> rows = await _client.availability(
        date: _dateParam,
        sports: _sports.toList(),
      );
      if (!mounted) return;
      setState(() {
        _rows = rows;
        _loading = false;
      });
    } on OaGymException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.message;
        _sessionExpired = error.sessionExpired;
      });
    }
  }

  Future<void> _bookRow(OaAvailability row) async {
    if (row.availableCourts.isEmpty) return;
    final KedaYaColors colors = context.kedayaColors;
    int court = row.availableCourts.first;
    int players = 2;

    final bool? submitted = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext sheetContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(
            KedaYaTokens.space4,
            KedaYaTokens.space4,
            KedaYaTokens.space4,
            MediaQuery.of(context).viewInsets.bottom + KedaYaTokens.space4,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                '${row.sport.label} · $_dateParam · ${_slotLabel(row.timeSlot)}',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeMd,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  color: colors.text,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space3),
              Wrap(
                spacing: KedaYaTokens.space2,
                children: <Widget>[
                  for (final int number in row.availableCourts)
                    ChoiceChip(
                      label: Text('$number 号'),
                      selected: court == number,
                      onSelected: (_) => setSheetState(() => court = number),
                    ),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space3),
              DropdownButtonFormField<int>(
                initialValue: players,
                decoration: const InputDecoration(labelText: '使用人数'),
                items: <DropdownMenuItem<int>>[
                  for (int i = 1; i <= 10; i++)
                    DropdownMenuItem<int>(value: i, child: Text('$i 人')),
                ],
                onChanged: (int? value) {
                  if (value != null) setSheetState(() => players = value);
                },
              ),
              const SizedBox(height: KedaYaTokens.space2),
              TextField(
                controller: _name,
                decoration: const InputDecoration(labelText: '姓名'),
              ),
              const SizedBox(height: KedaYaTokens.space2),
              TextField(
                controller: _studentId,
                decoration: const InputDecoration(labelText: '学号'),
              ),
              const SizedBox(height: KedaYaTokens.space2),
              TextField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: '手机号'),
              ),
              const SizedBox(height: KedaYaTokens.space3),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () => Navigator.of(sheetContext).pop(true),
                  child: const Text('继续'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (submitted != true || !mounted) return;

    final String name = _name.text.trim();
    final String studentId = _studentId.text.trim();
    final String phone = _phone.text.trim();
    if (name.isEmpty || studentId.isEmpty || phone.isEmpty) {
      setState(() => _error = '请先填写姓名、学号、手机号');
      return;
    }

    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('确认提交预约申请？'),
        content: Text(
          '''${row.sport.label} $court 号
$_dateParam ${_slotLabel(row.timeSlot)}
$players 人 · $name

提交后不可在本应用撤销；超时请先到 OA「我的请求」确认，避免重复预约。''',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('确认提交'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _loading = true);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    try {
      final OaBookingResult result = await _client.book(
        sport: row.sport,
        date: _dateParam,
        timeSlot: row.timeSlot,
        courtNumber: court,
        playersCount: players,
        userName: name,
        studentId: studentId,
        phone: phone,
      );
      if (!mounted) return;
      setState(() => _loading = false);
      messenger.showSnackBar(SnackBar(content: Text(result.message)));
      if (result.success) await _query();
    } on OaGymException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.message;
        _sessionExpired = error.sessionExpired;
      });
    }
  }

  Future<void> _pickDate() async {
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime.now().subtract(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 14)),
    );
    if (picked != null) setState(() => _date = picked);
  }

  static String _slotLabel(int slot) {
    final int hour = 10 + slot;
    final int end = hour + 1;
    return '${hour.toString().padLeft(2, '0')}:00–'
        '${end.toString().padLeft(2, '0')}:00';
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    if (!_supported) {
      return KedaYaPageScaffold(
        title: '场馆空闲',
        child: Center(
          child: Text(
            '当前平台没有内嵌浏览器。请在手机上使用，或打开 '
            'oa.shanghaitech.edu.cn 查询。',
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
      title: '场馆空闲',
      padding: EdgeInsets.zero,
      child: Column(
        children: <Widget>[
          Expanded(
            flex: 2,
            child: WebViewWidget(controller: _controller!),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              KedaYaTokens.space3,
              KedaYaTokens.space2,
              KedaYaTokens.space3,
              0,
            ),
            child: Wrap(
              spacing: KedaYaTokens.space2,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                ActionChip(
                  avatar: const Icon(Icons.event, size: 16),
                  label: Text(_dateParam),
                  onPressed: _pickDate,
                ),
                for (final OaSport sport in OaSport.values)
                  FilterChip(
                    label: Text(sport.label),
                    selected: _sports.contains(sport),
                    onSelected: (bool selected) {
                      setState(() {
                        if (selected) {
                          _sports.add(sport);
                        } else {
                          _sports.remove(sport);
                        }
                      });
                    },
                  ),
                FilledButton.tonal(
                  onPressed: _loading ? null : _query,
                  child: Text(_loading ? '查询中…' : '查询'),
                ),
              ],
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(KedaYaTokens.space2),
              child: Text(
                _sessionExpired ? '登录已失效：请在上方页面重新登录后重试' : _error!,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: _sessionExpired ? colors.warning : colors.danger,
                ),
              ),
            ),
          Expanded(
            flex: 3,
            child: _rows.isEmpty
                ? Center(
                    child: Text(
                      '选好日期与运动后点「查询」',
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeSm,
                        color: colors.textMuted,
                      ),
                    ),
                  )
                : ListView.builder(
                    itemCount: _rows.length,
                    itemBuilder: (BuildContext context, int index) {
                      final OaAvailability row = _rows[index];
                      return ListTile(
                        dense: true,
                        onTap: row.hasFree ? () => _bookRow(row) : null,
                        leading: Text(
                          _slotLabel(row.timeSlot),
                          style: TextStyle(
                            fontSize: KedaYaTokens.fontSizeXs,
                            color: colors.textMuted,
                          ),
                        ),
                        title: Text('${row.sport.label} · '
                            '${row.availableCourts.isEmpty ? '无空闲' : '空闲 ${row.availableCourts.join('、')} 号'}'),
                        trailing: Text(
                          '${row.availableCourts.length}/${row.totalCourts}',
                          style: TextStyle(
                            fontSize: KedaYaTokens.fontSizeXs,
                            color: row.hasFree ? colors.success : colors.textMuted,
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

const String oaGymRoutePath = '/oa-gym';
