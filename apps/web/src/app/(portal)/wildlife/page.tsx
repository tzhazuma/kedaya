import type { Metadata } from 'next';
import ResidentsArchive from './ResidentsArchive';
export const metadata: Metadata = { title: '野生居民档案', description: '记录每一次偶遇，认识校园里的每一位野生居民。校园动物共享地图、观察明信片与身份档案。' };
export default function WildlifePage(){ return <ResidentsArchive/>; }
