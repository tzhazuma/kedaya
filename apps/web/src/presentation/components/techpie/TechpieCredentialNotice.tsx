import { ShieldCheck } from 'lucide-react';

import { TRANSITIONAL_IDENTITY_NOTICE } from '@/application/techpie/session';

import { KdyAlert } from '../KdyAlert';

/**
 * 凭证处理声明（TechPie 切片共用）。
 *
 * 它不是装饰文案：规格 §10.3 与契约 §11.4 I1/I3 是**用户可见的承诺**，
 * 因此必须在页面上写清楚"可达鸭碰什么、不碰什么"。
 */
export function TechpieCredentialNotice({ compact = false }: { compact?: boolean }) {
  return (
    <KdyAlert tone="info" title="可达鸭如何处理你的校园凭证">
      <ul className="flex list-disc flex-col gap-1 pl-4">
        <li>
          <strong className="font-medium text-body">两级身份是分开的</strong>
          ：登录态里只有「你是谁」（学号 / 姓名 / 院系），
          <strong className="font-medium text-body">不包含</strong>
          任何校园系统的 cookie、会话或票据。
        </li>
        <li>
          <strong className="font-medium text-body">Phase 0 不代持校园会话</strong>
          ：校园卡走独立 OPENID 通道；WebView 由你在学校页面自己登录，
          可达鸭只转发一次性票据，不接触你的登录凭证。
        </li>
        <li>
          <strong className="font-medium text-body">凭证不进日志</strong>
          ：cookie、会话、密码、票据与付款码都不会写入日志或埋点。
        </li>
        {compact ? null : (
          <li>
            <strong className="font-medium text-body">未绑定也能用</strong>
            ：「已登录但未绑定」是合法状态，不绑定不影响可达鸭的全部自有功能。
          </li>
        )}
      </ul>
      {compact ? null : (
        <p className="mt-2 flex items-start gap-1.5 text-xs">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{TRANSITIONAL_IDENTITY_NOTICE}</span>
        </p>
      )}
    </KdyAlert>
  );
}
