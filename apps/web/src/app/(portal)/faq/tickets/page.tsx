import type { Metadata } from 'next';

import { KdyButton } from '@/presentation/components/KdyButton';
import { PageHeader } from '@/presentation/components/PageHeader';
import { FaqTicketList } from '@/presentation/components/faq/FaqTicketList';

export const metadata: Metadata = {
  title: '我的工单',
  description: '可达鸭常见问题工单：提交问题、查看管理员回复与处理状态。无需登录即可提交。',
};

export default function FaqTicketsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="校园服务 · faq"
        title="我的工单"
        description="知识库里没有答案时，在这里提问。联系方式只接受邮箱或微信号（不保存明文手机号）。"
        actions={
          <KdyButton href="/faq" variant="secondary" size="sm">
            返回知识库
          </KdyButton>
        }
      />
      <FaqTicketList />
    </div>
  );
}
