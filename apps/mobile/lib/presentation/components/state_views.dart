import 'package:flutter/material.dart';

import '../../domain/models/api_error.dart';
import '../theme/kedaya_theme_extension.dart';
import '../theme/kedaya_tokens.dart';

/// 加载态。
///
/// 契约 §8 明确禁止首屏空白等待网络，因此这里是一个**局部的**加载指示器
/// （用于列表/详情的二次加载），而不是全屏 splash。
class KedaYaLoadingState extends StatelessWidget {
  const KedaYaLoadingState({this.message, super.key});

  final String? message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(KedaYaTokens.space6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const SizedBox(
              width: 28,
              height: 28,
              child: CircularProgressIndicator(strokeWidth: 2.5),
            ),
            if (message != null) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space3),
              Text(
                message!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  color: KedaYaTokens.colorTextMuted,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// 空态（三态之一）。空态不是错误：文案必须说清"为什么是空的"。
class KedaYaEmptyState extends StatelessWidget {
  const KedaYaEmptyState({
    required this.title,
    this.description,
    this.icon = Icons.inbox_outlined,
    this.onRetry,
    this.retryLabel = '刷新',
    super.key,
  });

  final String title;
  final String? description;
  final IconData icon;
  final VoidCallback? onRetry;
  final String retryLabel;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(KedaYaTokens.space6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: 40, color: KedaYaTokens.colorTextMuted),
            const SizedBox(height: KedaYaTokens.space3),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: KedaYaTokens.fontSizeMd,
                fontWeight: KedaYaTokens.fontWeightSemibold,
                color: KedaYaTokens.colorText,
              ),
            ),
            if (description != null) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                description!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  color: KedaYaTokens.colorTextMuted,
                  height: KedaYaTokens.lineHeightNormal,
                ),
              ),
            ],
            if (onRetry != null) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space4),
              OutlinedButton(onPressed: onRetry, child: Text(retryLabel)),
            ],
          ],
        ),
      ),
    );
  }
}

/// 错误态（三态之一）。
///
/// 把 [ApiException] 的 `ApiErrorCode` 翻译成用户能行动的中文提示 ——
/// 契约 §5/§9 的两类"不是 bug 的失败"（未绑定校园系统、未二次同意）必须给出明确出路。
class KedaYaErrorState extends StatelessWidget {
  const KedaYaErrorState({required this.error, this.onRetry, super.key});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final ApiException? apiException =
        error is ApiException ? error as ApiException : null;
    final ApiError? detail = apiException?.error;
    final String message = detail?.userMessage ?? '出了点问题：$error';
    final String? hint = switch (detail?.code) {
      ApiErrorCode.campusBindingRequired => '该功能依赖校园系统，请先在「我的 → 校园系统绑定」里完成绑定。',
      ApiErrorCode.consentRequired => '该模块属于敏感模块，需要先阅读并同意隐私说明。',
      ApiErrorCode.unauthenticated => '登录状态已失效，请重新登录后再试。',
      ApiErrorCode.upstreamUnavailable => '校园系统暂时不可用，稍后重试即可，不影响其它功能。',
      _ => null,
    };

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(KedaYaTokens.space6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(
              Icons.error_outline,
              size: 40,
              color: KedaYaTokens.colorDanger,
            ),
            const SizedBox(height: KedaYaTokens.space3),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: KedaYaTokens.fontSizeMd,
                fontWeight: KedaYaTokens.fontWeightSemibold,
                color: KedaYaTokens.colorText,
              ),
            ),
            if (hint != null) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                hint,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  color: KedaYaTokens.colorTextMuted,
                  height: KedaYaTokens.lineHeightNormal,
                ),
              ),
            ],
            if (apiException?.traceId != null) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space2),
              SelectableText(
                'traceId: ${apiException!.traceId}',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: context.kedayaColors.textMuted,
                ),
              ),
            ],
            if (onRetry != null) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space4),
              FilledButton(onPressed: onRetry, child: const Text('重试')),
            ],
          ],
        ),
      ),
    );
  }
}
