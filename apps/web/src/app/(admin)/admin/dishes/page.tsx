import type { Metadata } from 'next';

import { DishManager } from '@/presentation/components/admin/DishManager';
import { PageHeader } from '@/presentation/components/PageHeader';

export const metadata: Metadata = {
  title: '菜品营养数据 · 管理后台',
  description:
    '营养管家园后台：录入与维护食堂每道菜的主要营养成分（每份口径），小程序端据此做识别、记录与推荐。',
  robots: { index: false, follow: false },
};

export default function AdminDishesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="菜品营养数据管理"
        description="对食堂中每一道菜上传其主要营养成分（热量 / 蛋白质 / 脂肪 / 碳水 / 膳食纤维 / 钠，每份口径）。数据默认来自 mock；接真实后端后即操作线上菜品库（写操作需要管理员权限）。"
      />
      <DishManager />
    </div>
  );
}
