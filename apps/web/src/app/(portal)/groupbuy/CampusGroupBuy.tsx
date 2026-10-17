'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  changeOrder, createOrder, currentStatus, joinedQuantity, purchaseSummary,
  readOrders, registerQuantity, withdrawQuantity,
  type CampusOrder,
} from './campus-store';

const inputClass = 'min-h-15 w-full rounded-lg border border-border bg-surface px-5 py-3 text-xl text-body outline-none focus:border-brand';
const primaryClass = 'min-h-15 rounded-lg bg-brand px-6 py-3 text-xl font-semibold text-white disabled:opacity-50';
const secondaryClass = 'min-h-15 rounded-lg border border-border bg-surface px-6 py-3 text-xl text-body';

function statusLabel(order: CampusOrder): string {
  return order.status === 'grouped' ? '已成团' : order.status === 'cancelled' ? '已取消' : '拼单中';
}

function useOrders() {
  const [orders, setOrders] = useState<CampusOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const refresh = () => { setOrders(readOrders()); setLoaded(true); };
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('kedaya:groupbuy-changed', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('kedaya:groupbuy-changed', refresh);
      window.clearInterval(timer);
    };
  }, []);
  return { orders, loaded };
}

export function CampusGroupBuyList() {
  const { orders, loaded } = useOrders();
  const router = useRouter();
  const [activeFeature, setActiveFeature] = useState<'groupbuy' | 'buddy'>('groupbuy');
  const [showCreate, setShowCreate] = useState(false);
  const [kind, setKind] = useState<'ordinary' | 'membership'>('ordinary');
  const [declared, setDeclared] = useState(false);
  const [ownerName, setOwnerName] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [title, setTitle] = useState('');
  const [itemSpec, setItemSpec] = useState('');
  const [description, setDescription] = useState('');
  const [targetCount, setTargetCount] = useState('');
  const [price, setPrice] = useState('');
  const [pickupSpot, setPickupSpot] = useState('');
  const [message, setMessage] = useState('');

  const submit = () => {
    const itemOptions = itemSpec.split(/[\n，,]/).map((item) => item.trim()).filter(Boolean);
    if (kind === 'membership' && !declared) { setMessage('请确认本人持有该商家会员资格'); return; }
    const priceFen = itemOptions.length > 1 ? 0 : price.trim() ? Math.round(Number(price) * 100) : 0;
    if (!Number.isInteger(priceFen) || priceFen < 0) { setMessage('参考单价格式不正确'); return; }
    try {
      const order = createOrder({
        ownerName, kind, merchantName, title, itemSpec: itemOptions.join('、'), itemOptions, description,
        targetCount: Number(targetCount), priceFen, pickupSpot,
      });
      router.push(`/groupbuy/${encodeURIComponent(order.id)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建失败');
    }
  };

  return <main className="flex h-auto flex-col gap-6 overflow-visible pb-10 text-xl leading-relaxed">
    <header className="rounded-xl border border-border bg-surface p-6">
      <p className="text-lg text-muted">校园同学 · 一起凑个伴</p>
      <h1 className="mt-1 text-[40px] font-bold text-body">凑凑</h1>
      <p className="mt-2 text-xl text-muted">在这里拼单，也可以找搭子。约上同学，把校园里的小事办得更方便。</p>
    </header>

    <nav className="flex flex-wrap gap-3" aria-label="凑凑功能">
      <button type="button" aria-pressed={activeFeature === 'groupbuy'} className={activeFeature === 'groupbuy' ? primaryClass : secondaryClass} onClick={() => setActiveFeature('groupbuy')}>拼单</button>
      <button type="button" aria-pressed={activeFeature === 'buddy'} className={activeFeature === 'buddy' ? primaryClass : secondaryClass} onClick={() => setActiveFeature('buddy')}>找搭子</button>
    </nav>

    {activeFeature === 'buddy' ? <section className="rounded-xl border border-border bg-surface p-6" aria-label="找搭子">
      <h2 className="text-[28px] font-semibold text-body">找搭子</h2>
      <p className="mt-3 text-xl text-muted">想约同学一起运动、自习、吃饭或出行？找搭子的发布与报名页面正在建设中。</p>
    </section> : <>
    <section className="rounded-xl border border-border bg-surface p-6" aria-label="拼单说明">
      <h2 className="text-[28px] font-semibold text-body">拼单</h2>
      <p className="mt-2 text-xl text-muted">按登记总份数成团。创建后 24 小时未成团自动取消；成团后清单锁定。平台不收款。</p>
      <button type="button" className={`${primaryClass} mt-4`} onClick={() => setShowCreate(!showCreate)}>{showCreate ? '收起表单' : '发起拼单'}</button>
    </section>

    {showCreate && <section className="grid gap-4 rounded-xl border border-border bg-surface p-6" aria-label="发起拼单">
      <h2 className="text-[28px] font-semibold text-body">发起拼单</h2>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={kind === 'ordinary' ? primaryClass : secondaryClass} onClick={() => setKind('ordinary')}>普通拼单</button>
        <button type="button" className={kind === 'membership' ? primaryClass : secondaryClass} onClick={() => setKind('membership')}>会员代购</button>
      </div>
      <label className="text-xl text-body">发起人称呼<input className={inputClass} value={ownerName} onChange={(event) => setOwnerName(event.target.value)} maxLength={40} placeholder="例如：小王" /></label>
      {kind === 'membership' && <>
        <label className="text-xl text-body">会员商家<input className={inputClass} value={merchantName} onChange={(event) => setMerchantName(event.target.value)} maxLength={100} placeholder="例如：山姆会员商店" /></label>
        <label className="flex items-center gap-2 text-xl text-body"><input type="checkbox" checked={declared} onChange={(event) => setDeclared(event.target.checked)} />我确认本人持有该商家会员资格</label>
        <p className="text-lg text-muted">当前仅记录发起人自述，平台尚未核验会员资格。请勿填写会员卡号或密码。</p>
      </>}
      <label className="text-xl text-body">拼单标题<input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="例如：宿舍楼拼纸巾" /></label>
      <label className="text-xl text-body">商品与规格（每行一种，最多 12 种）<textarea className={inputClass} value={itemSpec} onChange={(event) => setItemSpec(event.target.value)} maxLength={1200} placeholder={'抽纸 3 包/份\n洗衣液 1 瓶/份'} /></label>
      <label className="text-xl text-body">补充说明<textarea className={inputClass} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xl text-body">目标总份数<input className={inputClass} type="number" min="1" max="999" value={targetCount} onChange={(event) => setTargetCount(event.target.value)} /></label>
        {itemSpec.split(/[\n，,]/).filter((item) => item.trim()).length <= 1 && <label className="text-xl text-body">参考单价（元，可留空）<input className={inputClass} type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></label>}
      </div>
      <label className="text-xl text-body">线下取货地点<input className={inputClass} value={pickupSpot} onChange={(event) => setPickupSpot(event.target.value)} maxLength={100} /></label>
      {message && <p role="alert" className="text-xl text-red-600">{message}</p>}
      <button type="button" className={primaryClass} onClick={submit}>创建拼单</button>
    </section>}

    <section className="grid gap-4 sm:grid-cols-2" aria-label="拼单列表">
      {!loaded && <p className="rounded-xl border border-border bg-surface p-6 text-xl text-muted">正在加载拼单…</p>}
      {loaded && orders.length === 0 && <p className="rounded-xl border border-border bg-surface p-6 text-xl text-muted">还没有拼单，发起一个给宿舍群统计需求吧。</p>}
      {orders.map((order) => <Link key={order.id} href={`/groupbuy/${encodeURIComponent(order.id)}`} className="rounded-xl border border-border bg-surface p-6 hover:border-brand">
        <div className="flex flex-wrap items-start justify-between gap-4"><h2 className="text-xxl font-semibold text-body">{order.title}</h2><span className="text-lg text-brand-strong">{statusLabel(order)}</span></div>
        <p className="mt-2 text-lg text-muted">{order.kind === 'membership' ? `${order.merchantName} · 会员代购（发起人自述持卡）` : '普通拼单'}</p>
        <p className="mt-3 text-xl text-body">{joinedQuantity(order)} / {order.targetCount} 份 · {order.members.length} 人参与</p>
        <div className="mt-2 h-3 rounded-full bg-surface-alt"><div className="h-3 rounded-full bg-brand" style={{ width: `${Math.min(100, joinedQuantity(order) / order.targetCount * 100)}%` }} /></div>
        <p className="mt-2 text-lg text-muted">取货：{order.pickupSpot} · 截止：{new Date(order.deadline).toLocaleString('zh-CN')}</p>
      </Link>)}
    </section>
    <p className="text-lg text-muted">网页演示数据保存在当前浏览器。小程序与真实 API 的拼单数据需登录后使用。</p>
    </>}
  </main>;
}

export function CampusGroupBuyDetail({ id }: { id: string }) {
  const { orders, loaded } = useOrders();
  const order = orders.find((item) => item.id === id);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [itemQuantities, setItemQuantities] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const [message, setMessage] = useState('');

  const apply = (operation: (item: CampusOrder) => CampusOrder) => {
    try { changeOrder(id, operation); setMessage('已更新'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '操作失败'); }
  };

  if (!loaded) return <p className="text-xl text-muted">正在加载拼单…</p>;
  if (!order) return <div className="flex h-auto flex-col gap-5 overflow-visible pb-10 text-xl leading-relaxed"><Link href="/groupbuy" className="text-xl text-brand-strong">返回凑凑</Link><p className="text-xl text-muted">拼单不存在，或不在当前浏览器中。</p></div>;
  const status = currentStatus(order);
  const remaining = Math.max(0, status.targetCount - joinedQuantity(status));
  const options = status.itemOptions?.length ? status.itemOptions : [status.itemSpec];
  const submitRegistration = () => {
    const selections = options.length > 1
      ? options.map((item) => ({ item, quantity: Number(itemQuantities[item] ?? '0') })).filter((line) => line.quantity > 0)
      : [{ item: options[0]!, quantity: Number(quantity) }];
    const total = selections.reduce((sum, line) => sum + line.quantity, 0);
    apply((item) => registerQuantity(item, name, total, note, selections));
  };
  return <main className="flex h-auto flex-col gap-5 overflow-visible pb-10 text-xl leading-relaxed">
    <Link href="/groupbuy" className="text-xl text-brand-strong">← 返回凑凑</Link>
    <section className="rounded-xl border border-border bg-surface p-6">
      <p className="text-lg text-muted">{status.kind === 'membership' ? `会员代购 · ${status.merchantName} · 发起人自述持卡` : '普通拼单'}</p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4"><h1 className="text-[40px] font-bold text-body">{status.title}</h1><span className="text-xl text-brand-strong">{statusLabel(status)}</span></div>
      <p className="mt-3 text-xl text-body">商品：{options.join('、')}</p>
      {status.description && <p className="mt-1 text-xl text-muted">{status.description}</p>}
      <p className="mt-4 text-xl text-body">{joinedQuantity(status)} / {status.targetCount} 份 · {status.members.length} 人参与 · 还差 {remaining} 份</p>
      <div className="mt-2 h-3 rounded-full bg-surface-alt"><div className="h-3 rounded-full bg-brand" style={{ width: `${Math.min(100, joinedQuantity(status) / status.targetCount * 100)}%` }} /></div>
      <p className="mt-3 text-lg text-muted">参考单价：{options.length > 1 ? '多商品线下核价' : status.priceFen ? `¥${(status.priceFen / 100).toFixed(2)}` : '线下协商'} · 取货：{status.pickupSpot}</p>
      <p className="mt-1 text-lg text-muted">发起人：{status.ownerName} · 创建后 24 小时截止：{new Date(status.deadline).toLocaleString('zh-CN')}</p>
      {status.cancelReason === 'TIMEOUT_24H' && <p className="mt-2 text-xl text-red-600">24 小时未成团，已自动取消。</p>}
      {status.pickupNotice && <p className="mt-3 rounded-lg bg-surface-alt p-3 text-xl text-body">取货通知：{status.pickupNotice}</p>}
    </section>
    <section className="grid gap-4 rounded-xl border border-border bg-surface p-6">
      <h2 className="text-xxl font-semibold text-body">登记需求</h2>
      <p className="text-lg text-muted">使用相同称呼再次登记可修改份数；仅发起拼单不会自动占一份。成团后清单锁定。</p>
      <label className="text-xl text-body">我的称呼<input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} maxLength={40} /></label>
      {options.length > 1 ? options.map((item) => <label key={item} className="text-xl text-body">{item}（份）<input className={inputClass} type="number" min="0" max="99" value={itemQuantities[item] ?? ''} onChange={(event) => setItemQuantities((previous) => ({ ...previous, [item]: event.target.value }))} /></label>) : <label className="text-xl text-body">份数<input className={inputClass} type="number" min="1" max="99" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>}
      <label className="text-xl text-body">备注<input className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder="口味、规格等" /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryClass} disabled={status.status !== 'open'} onClick={submitRegistration}>登记或修改</button>
        <button type="button" className={secondaryClass} disabled={status.status !== 'open'} onClick={() => apply((item) => withdrawQuantity(item, name))}>退出拼单</button>
      </div>
      {message && <p role="status" className="text-xl text-muted">{message}</p>}
    </section>
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xxl font-semibold text-body">采购汇总</h2><button type="button" className={secondaryClass} onClick={() => { void navigator.clipboard.writeText(purchaseSummary(status)).then(() => setMessage('采购汇总已复制')).catch(() => setMessage('复制失败，请检查浏览器剪贴板权限')); }}>复制清单</button></div>
      <p className="mt-3 text-xl text-body">按商品：</p>
      <ul className="mt-1 text-xl text-body">{options.map((item) => <li key={item}>{item} × {status.members.reduce((sum, member) => sum + (member.selections?.find((line) => line.item === item)?.quantity ?? (options.length === 1 ? member.quantity : 0)), 0)}</li>)}</ul>
      <p className="mt-2 text-lg text-muted">按成员：</p>
      <ul className="mt-1 divide-y divide-border text-xl text-body">{status.members.map((member) => <li key={member.name} className="flex flex-wrap justify-between gap-2 py-2"><span>{member.name}{member.note ? ` · ${member.note}` : ''}</span><span>{(member.selections ?? [{ item: options[0]!, quantity: member.quantity }]).map((line) => `${line.item} × ${line.quantity}`).join('、')}{member.receivedAt ? ' · 已领取' : ''}</span>{status.status === 'grouped' && name.trim() === status.ownerName && <button type="button" className="text-lg text-brand-strong" onClick={() => apply((item) => ({ ...item, members: item.members.map((entry) => entry.name === member.name ? { ...entry, receivedAt: entry.receivedAt ? null : new Date().toISOString() } : entry) }))}>{member.receivedAt ? '撤销领取' : '标记领取'}</button>}</li>)}</ul>
      {status.members.length === 0 && <p className="mt-2 text-xl text-muted">还没有人登记。</p>}
    </section>
    {status.status === 'grouped' && <section className="grid gap-4 rounded-xl border border-border bg-surface p-6"><h2 className="text-xxl font-semibold text-body">取货管理</h2><p className="text-lg text-muted">发起人填写自己的称呼后可发布通知与标记领取。</p><label className="text-xl text-body">取货通知<input className={inputClass} value={notice} onChange={(event) => setNotice(event.target.value)} maxLength={500} placeholder="例如：今晚 19:00 在宿舍楼大厅领取" /></label><button type="button" className={primaryClass} onClick={() => { if (name.trim() !== status.ownerName) { setMessage('请先填写发起人称呼'); return; } if (!notice.trim()) { setMessage('请填写取货通知'); return; } apply((item) => ({ ...item, pickupNotice: notice.trim() })); }}>发布通知</button></section>}
    {status.status === 'open' && <section className="rounded-xl border border-border bg-surface p-6"><h2 className="text-xxl font-semibold text-body">发起人操作</h2><p className="mt-1 text-lg text-muted">网页演示中请核对发起人称呼；真实 API 会校验登录账号。</p><button type="button" className={`${secondaryClass} mt-3`} onClick={() => { if (name.trim() !== status.ownerName) { setMessage('请先填写发起人称呼'); return; } if (window.confirm('确定取消拼单？')) apply((item) => ({ ...item, status: 'cancelled', cancelReason: 'CREATOR_CANCELLED' })); }}>取消拼单</button></section>}
    <p className="text-lg text-muted">线下自行采购与结算，平台不收款。网页演示数据仅保存在当前浏览器。</p>
  </main>;
}
