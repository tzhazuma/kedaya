import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../theme/kedaya_tokens.dart';

/// 底部导航外壳（`StatefulShellRoute.indexedStack` 的 builder）。
///
/// 三个分支：首页 / 全部模块 / 我的。分支状态由 go_router 保留。
class KedaYaShell extends StatelessWidget {
  const KedaYaShell({required this.navigationShell, super.key});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: navigationShell.currentIndex,
        onDestinationSelected: (int index) => navigationShell.goBranch(
          index,
          // 再次点击当前分支时回到该分支的初始路由（iOS/Android 通用习惯）。
          initialLocation: index == navigationShell.currentIndex,
        ),
        destinations: const <NavigationDestination>[
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: '首页',
          ),
          NavigationDestination(
            icon: Icon(Icons.grid_view_outlined),
            selectedIcon: Icon(Icons.grid_view),
            label: '全部',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: '我的',
          ),
        ],
      ),
    );
  }
}

/// 页面通用外壳：统一背景色与标题，避免各页面自己写 Scaffold 参数。
class KedaYaPageScaffold extends StatelessWidget {
  const KedaYaPageScaffold({
    required this.title,
    required this.child,
    this.actions,
    this.bottom,
    this.padding = const EdgeInsets.all(KedaYaTokens.space4),
    super.key,
  });

  final String title;
  final Widget child;
  final List<Widget>? actions;
  final PreferredSizeWidget? bottom;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title), actions: actions, bottom: bottom),
      body: SafeArea(child: Padding(padding: padding, child: child)),
    );
  }
}
