import 'package:flutter/material.dart';

import '../../data/mock/mock_controls.dart';
import '../../data/mock/mock_failure.dart';

/// mock 三态演示开关（真实运行时不存在此入口）。
///
/// 抽成公共组件：`groupbuy` / `forum` / `faq` 的列表页都需要同一个入口，
/// 契约 §7 要求所有列表页行为一致，三态演示不该各写一套。
/// 它只操作 [MockControls]，不触碰任何端口 —— 因此对真实运行时是惰性的。
class MockStateMenu extends StatelessWidget {
  const MockStateMenu(
      {required this.controls, required this.onChanged, super.key});

  final MockControls controls;

  /// 切换后回调（通常是 `ref.invalidate` 对应的列表 provider）。
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) => PopupMenuButton<String>(
        tooltip: 'mock 三态演示',
        icon: const Icon(Icons.science_outlined),
        onSelected: (String value) {
          controls.emptyResults = value == 'empty';
          controls.failureMode = value == 'error'
              ? MockFailureMode.upstreamUnavailable
              : MockFailureMode.none;
          onChanged();
        },
        itemBuilder: (BuildContext context) => const <PopupMenuEntry<String>>[
          PopupMenuItem<String>(value: 'normal', child: Text('正常数据')),
          PopupMenuItem<String>(value: 'empty', child: Text('空列表（empty 态）')),
          PopupMenuItem<String>(value: 'error', child: Text('上游故障（error 态）')),
        ],
      );
}
