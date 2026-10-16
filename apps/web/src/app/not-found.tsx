import Link from 'next/link';

import { KdyButton } from '@/presentation/components/KdyButton';
import { KdyEmpty } from '@/presentation/components/KdyEmpty';

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-16">
      <KdyEmpty
        title="页面不存在"
        description="你访问的模块或拼单可能已被下架。可以从首页的 20 个模块入口重新进入。"
        action={
          <div className="flex flex-wrap items-center justify-center gap-3">
            <KdyButton href="/">返回首页</KdyButton>
            <KdyButton href="/groupbuy" variant="secondary">
              去拼单列表
            </KdyButton>
          </div>
        }
      />
      <p className="text-center text-xs text-muted">
        提示：模块占位页的地址形如{' '}
        <Link href="/m/forum" className="font-mono underline">
          /m/forum
        </Link>
        。
      </p>
    </div>
  );
}
