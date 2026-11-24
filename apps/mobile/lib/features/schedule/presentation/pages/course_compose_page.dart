import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/course_session.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/schedule_providers.dart';

/// 自定义课程（本机保存，重启即回到演示数据）。
class CourseComposePage extends ConsumerStatefulWidget {
  const CourseComposePage({super.key});

  @override
  ConsumerState<CourseComposePage> createState() => _CourseComposePageState();
}

class _CourseComposePageState extends ConsumerState<CourseComposePage> {
  final TextEditingController _name = TextEditingController();
  final TextEditingController _teacher = TextEditingController();
  final TextEditingController _location = TextEditingController();
  final TextEditingController _note = TextEditingController();

  CourseWeekday _weekday = CourseWeekday.monday;
  TimeOfDay _start = const TimeOfDay(hour: 8, minute: 0);
  TimeOfDay _end = const TimeOfDay(hour: 9, minute: 40);
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _teacher.dispose();
    _location.dispose();
    _note.dispose();
    super.dispose();
  }

  int _minutesOf(TimeOfDay t) => t.hour * 60 + t.minute;

  String _format(TimeOfDay t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  Future<void> _pickTime({required bool isStart}) async {
    final TimeOfDay? picked = await showTimePicker(
      context: context,
      initialTime: isStart ? _start : _end,
    );
    if (picked == null) return;
    setState(() {
      if (isStart) {
        _start = picked;
      } else {
        _end = picked;
      }
    });
  }

  Future<void> _save() async {
    final String name = _name.text.trim();
    final String location = _location.text.trim();
    final int start = _minutesOf(_start);
    final int end = _minutesOf(_end);
    if (name.isEmpty) {
      setState(() => _error = '请填写课程名');
      return;
    }
    if (location.isEmpty) {
      setState(() => _error = '请填写上课地点');
      return;
    }
    if (end <= start) {
      setState(() => _error = '结束时间必须晚于开始时间');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    final CourseSession session = CourseSession(
      id: 'course-${DateTime.now().microsecondsSinceEpoch}',
      courseName: name,
      teacher: _teacher.text.trim(),
      location: location,
      weekday: _weekday,
      startMinutes: start,
      endMinutes: end,
      startPeriod: estimatePeriodForMinutes(start),
      endPeriod: estimatePeriodForMinutes(end),
      note: _note.text.trim().isEmpty ? null : _note.text.trim(),
    );
    await ref.read(weekScheduleProvider.notifier).addCourse(session);
    if (!mounted) return;
    context.pop();
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return KedaYaPageScaffold(
      title: '添加课程',
      child: ListView(
        children: <Widget>[
          TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: '课程名'),
            textInputAction: TextInputAction.next,
          ),
          const SizedBox(height: KedaYaTokens.space3),
          TextField(
            controller: _teacher,
            decoration: const InputDecoration(labelText: '任课教师（可选）'),
            textInputAction: TextInputAction.next,
          ),
          const SizedBox(height: KedaYaTokens.space3),
          TextField(
            controller: _location,
            decoration: const InputDecoration(labelText: '上课地点'),
            textInputAction: TextInputAction.next,
          ),
          const SizedBox(height: KedaYaTokens.space3),
          DropdownButtonFormField<CourseWeekday>(
            initialValue: _weekday,
            decoration: const InputDecoration(labelText: '星期'),
            items: <DropdownMenuItem<CourseWeekday>>[
              for (final CourseWeekday day in CourseWeekday.values)
                DropdownMenuItem<CourseWeekday>(
                  value: day,
                  child: Text(day.label),
                ),
            ],
            onChanged: (CourseWeekday? value) {
              if (value != null) setState(() => _weekday = value);
            },
          ),
          const SizedBox(height: KedaYaTokens.space3),
          Row(
            children: <Widget>[
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _pickTime(isStart: true),
                  child: Text('开始 ${_format(_start)}'),
                ),
              ),
              const SizedBox(width: KedaYaTokens.space3),
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _pickTime(isStart: false),
                  child: Text('结束 ${_format(_end)}'),
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space3),
          TextField(
            controller: _note,
            decoration: const InputDecoration(labelText: '备注（可选，≤60 字）'),
            maxLength: 60,
          ),
          if (_error != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Text(_error!, style: TextStyle(color: colors.danger)),
          ],
          const SizedBox(height: KedaYaTokens.space4),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: Text(_saving ? '保存中…' : '保存'),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          Text(
            '仅保存在本机，重启回到演示课表；真实课表需接入教务。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}
