import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

import 'pages/ai_portrait_page.dart';

/// AI 校园画像路由段。
///
/// ⚠️ 当前任务边界不允许修改 `lib/app/app_router.dart`，因此这里提供
/// **可直接展开**的路由工厂；装配时在 `createAppRouter` 的 `routes` 列表里
/// 加一行 `...buildAiPortraitRoutes()` 即可。
List<RouteBase> buildAiPortraitRoutes() => <RouteBase>[
      GoRoute(
        path: '/ai-portrait',
        name: 'ai-portrait',
        builder: (BuildContext context, GoRouterState state) =>
            const AiPortraitPage(),
      ),
    ];
