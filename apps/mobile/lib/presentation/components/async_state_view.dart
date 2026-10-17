import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'state_views.dart';

/// 三态渲染器：把 `AsyncValue<T>` 直接映射为 **loading / error / empty / data**。
///
/// 为什么单独抽一个组件：契约 §7 要求所有列表页行为一致，
/// 不允许各页面自己写一套 `when(...)` 而漏掉空态。
class AsyncStateView<T> extends StatelessWidget {
  const AsyncStateView({
    required this.value,
    required this.builder,
    this.isEmpty,
    this.emptyTitle = '暂无内容',
    this.emptyDescription,
    this.loadingMessage,
    this.onRetry,
    super.key,
  });

  final AsyncValue<T> value;

  /// 数据态渲染。
  final Widget Function(BuildContext context, T data) builder;

  /// 判定"数据是空的"。返回 true 时渲染空态而不是 [builder]。
  final bool Function(T data)? isEmpty;

  final String emptyTitle;
  final String? emptyDescription;
  final String? loadingMessage;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => value.when(
        data: (T data) {
          if (isEmpty?.call(data) ?? false) {
            return KedaYaEmptyState(
              title: emptyTitle,
              description: emptyDescription,
              onRetry: onRetry,
            );
          }
          return builder(context, data);
        },
        loading: () => KedaYaLoadingState(message: loadingMessage),
        error: (Object error, StackTrace stackTrace) =>
            KedaYaErrorState(error: error, onRetry: onRetry),
        // 下拉刷新时保留旧数据，避免列表闪成骨架屏。
        skipLoadingOnRefresh: true,
      );
}
