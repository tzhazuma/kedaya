import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../theme/kedaya_tokens.dart';

/// 404 页（`GoRouter.errorBuilder`）。
class NotFoundPage extends StatelessWidget {
  const NotFoundPage({required this.location, super.key});

  final String location;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('页面不存在')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(KedaYaTokens.space6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Icon(
                Icons.explore_off_outlined,
                size: 40,
                color: KedaYaTokens.colorTextMuted,
              ),
              const SizedBox(height: KedaYaTokens.space3),
              Text(
                '没有找到这个页面',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: KedaYaTokens.space2),
              SelectableText(
                location,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: KedaYaTokens.colorTextMuted,
                  fontFamily: KedaYaTokens.fontFamilyMono,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space4),
              FilledButton(
                onPressed: () => context.go('/home'),
                child: const Text('回到首页'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
