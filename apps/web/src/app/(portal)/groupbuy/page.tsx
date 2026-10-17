import type { Metadata } from 'next';

import { CampusGroupBuyList } from './CampusGroupBuy';

export const metadata: Metadata = {
  title: '凑凑',
  description: '校园凑凑：拼单统计与找搭子。',
};

export default function GroupBuyPage() {
  return <CampusGroupBuyList />;
}
