'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { CANTEEN_NAMES, DISH_CATEGORIES, DISH_CATEGORY_LABELS, checkDishEnergyConsistency, fenToYuan, validateDishInput } from '@kedaya/shared';

import type { CreateDishInput, CanteenDish, DishCategory } from '@/domain/models/canteen';
import { NUTRIENT_FIELDS } from '@/domain/models/canteen';
import { getRepositories } from '@/data/repositories';

import { queryKeys } from '../../query/keys';
import { asApiError, errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { KdyAlert } from '../KdyAlert';
import { KdyBadge } from '../KdyBadge';
import { KdyButton } from '../KdyButton';
import { KdyCard } from '../KdyCard';
import { KdySkeleton } from '../KdySkeleton';

/**
 * 菜品营养数据管理（营养管家园后台，ADR 0006）。
 *
 * 「对于食堂中每一道菜，上传其主要营养成分」的落地处：
 * 表格看全量菜品，表单录/改六项营养（每份口径）。
 *
 * 数据默认来自 mock（无后端可跑）；`NEXT_PUBLIC_KEDAYA_USE_MOCK=false` 切真后端。
 */

const CATEGORY_FILTERS: ReadonlyArray<DishCategory | 'all'> = ['all', ...DISH_CATEGORIES];

const EMPTY_FORM = {
  canteen: '第一食堂',
  name: '',
  category: 'other' as DishCategory,
  servingG: '100',
  caloriesKcal: '',
  proteinG: '',
  fatG: '',
  carbG: '',
  fiberG: '0',
  sodiumMg: '0',
  priceYuan: '',
};

function toNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

export function DishManager() {
  const repositories = getRepositories();
  const queryClient = useQueryClient();

  const [q, setQ] = useState('');
  const [category, setCategory] = useState<DishCategory | 'all'>('all');
  /** 食堂筛选（`all` = 不限）。与分类/关键词是**叠加**条件 */
  const [canteen, setCanteen] = useState<string>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  /** 能量一致性提示（非阻断） */
  const [formWarning, setFormWarning] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.canteen.list({ q, category, canteen }),
    queryFn: async () =>
      unwrapOrThrow(
        await repositories.dishes.list({
          q,
          category: category === 'all' ? undefined : category,
          // 「不限食堂」不下传（而不是传空串，空串会被后端当成真的筛一个叫 "" 的食堂）
          canteen: canteen === 'all' ? undefined : canteen,
          limit: 50,
        }),
      ),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.canteen.root });
  };

  const saveMutation = useMutation({
    mutationFn: async (input: { id: string | null; values: CreateDishInput }) =>
      input.id === null
        ? unwrapOrThrow(await repositories.dishes.create(input.values))
        : unwrapOrThrow(await repositories.dishes.update(input.id, input.values)),
    onMutate: () => {
      setFormError(undefined);
      setFormWarning(null);
    },
    onError: (error) => setFormError(errorMessage(error)),
    onSuccess: () => {
      setFormOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => unwrapOrThrow(await repositories.dishes.remove(id)),
    onError: (error) => setFormError(errorMessage(error)),
    onSuccess: () => {
      setPendingDeleteId(null);
      invalidate();
    },
  });

  function openCreate(): void {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(undefined);
    setFormWarning(null);
    setFormOpen(true);
  }

  function openEdit(dish: CanteenDish): void {
    setEditingId(dish.id);
    setForm({
      canteen: dish.canteen,
      name: dish.name,
      category: dish.category,
      servingG: String(dish.servingG),
      caloriesKcal: String(dish.caloriesKcal),
      proteinG: String(dish.proteinG),
      fatG: String(dish.fatG),
      carbG: String(dish.carbG),
      fiberG: String(dish.fiberG),
      sodiumMg: String(dish.sodiumMg),
      priceYuan: String(dish.priceFen / 100),
    });
    setFormError(undefined);
    setFormOpen(true);
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const priceYuan = toNumber(form.priceYuan);
    const values = {
      canteen: form.canteen.trim(),
      name: form.name.trim(),
      category: form.category,
      servingG: toNumber(form.servingG),
      caloriesKcal: toNumber(form.caloriesKcal),
      proteinG: toNumber(form.proteinG),
      fatG: toNumber(form.fatG),
      carbG: toNumber(form.carbG),
      fiberG: toNumber(form.fiberG),
      sodiumMg: toNumber(form.sodiumMg),
      priceFen: priceYuan === null ? null : Math.round(priceYuan * 100),
    };
    if (Object.values(values).some((value) => value === null)) {
      setFormError('请把全部字段填完整（可以是 0）');
      return;
    }
    const input = values as CreateDishInput;
    // 规则与小程序 mock 同一份（shared validateDishInput）
    const invalid = validateDishInput(input);
    if (invalid !== null) {
      setFormError(invalid);
      return;
    }
    // 能量一致性：只提示、不拦截（真实菜品含纤维/酒精，本就允许偏差）
    setFormWarning(checkDishEnergyConsistency(input));
    void saveMutation.mutate({ id: editingId, values: input });
  }

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy data-testid="dishes-loading">
        <KdyCard className="flex flex-col gap-3">
          <KdySkeleton className="h-6 w-40" />
          <KdySkeleton lines={5} />
        </KdyCard>
      </div>
    );
  }

  if (query.isError) {
    return (
      <KdyAlert
        tone="danger"
        title="菜品库加载失败"
        action={
          <KdyButton size="sm" variant="secondary" onClick={() => void query.refetch()}>
            <RefreshCw className="size-3.5" aria-hidden />
            重试
          </KdyButton>
        }
      >
        <p>{errorMessage(query.error)}</p>
        <p className="mt-1 text-xs">错误码：{asApiError(query.error).code}</p>
      </KdyAlert>
    );
  }

  const dishes = query.data.items;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="dishes-list-heading">
        <header className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="dishes-list-heading" className="text-lg font-semibold text-body">
              菜品库
            </h2>
            <p className="text-xs text-muted">
              营养值为<strong className="font-semibold">每份</strong>口径（不是每 100g）。共 {dishes.length} 道
              {repositories.mode === 'mock' ? ' · mock 数据，刷新后回到种子' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <KdyButton size="sm" variant="secondary" onClick={() => void query.refetch()} disabled={query.isFetching}>
              <RefreshCw className={query.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden />
              刷新
            </KdyButton>
            <KdyButton size="sm" onClick={openCreate}>
              <Plus className="size-3.5" aria-hidden />
              新建菜品
            </KdyButton>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-48">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="按菜名搜索，如：红烧排骨"
              aria-label="按菜名搜索菜品"
              className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-sm text-body placeholder:text-muted"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategory(item)}
                aria-pressed={category === item}
                className={
                  category === item
                    ? 'rounded-pill border border-brand-strong bg-brand px-2.5 py-1 text-xs text-ink'
                    : 'rounded-pill border border-border bg-surface px-2.5 py-1 text-xs text-muted hover:text-body'
                }
              >
                {item === 'all' ? '全部' : DISH_CATEGORY_LABELS[item]}
              </button>
            ))}
          </div>
        </div>

        {/*
          食堂筛选：白名单来自 `@kedaya/shared` 的 `CANTEEN_NAMES`（与小程序端同一份），
          手写一份必然漂移 —— 漂移的表现是「筛选点下去是空列表」。
          `all` 不在白名单里，只是「不限食堂」这个开关。
        */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">食堂</span>
          {(['all', ...CANTEEN_NAMES] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCanteen(item)}
              aria-pressed={canteen === item}
              className={
                canteen === item
                  ? 'rounded-pill border border-brand-strong bg-brand px-2.5 py-1 text-xs text-ink'
                  : 'rounded-pill border border-border bg-surface px-2.5 py-1 text-xs text-muted hover:text-body'
              }
            >
              {item === 'all' ? '不限' : item}
            </button>
          ))}
        </div>

        {formError !== undefined && !formOpen ? (
          <KdyAlert tone="danger" title="操作失败">
            <p>{formError}</p>
          </KdyAlert>
        ) : null}

        <KdyCard padded={false} className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] border-collapse text-sm">
              <caption className="sr-only">菜品营养数据表</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">菜品</th>
                  <th scope="col" className="py-2 pr-3 font-medium">食堂</th>
                  <th scope="col" className="py-2 pr-3 font-medium">品类</th>
                  <th scope="col" className="py-2 pr-3 font-medium">每份</th>
                  <th scope="col" className="py-2 pr-3 font-medium">热量</th>
                  <th scope="col" className="py-2 pr-3 font-medium">蛋白</th>
                  <th scope="col" className="py-2 pr-3 font-medium">脂肪</th>
                  <th scope="col" className="py-2 pr-3 font-medium">碳水</th>
                  <th scope="col" className="py-2 pr-3 font-medium">纤维</th>
                  <th scope="col" className="py-2 pr-3 font-medium">钠</th>
                  <th scope="col" className="py-2 pr-3 font-medium">价格</th>
                  <th scope="col" className="py-2 pr-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {dishes.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-8 text-center text-sm text-muted">
                      没有匹配的菜品。调整搜索条件，或新建一道。
                    </td>
                  </tr>
                ) : (
                  dishes.map((dish) => (
                    <tr key={dish.id} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3">
                        <span className="flex flex-col">
                          <span className="font-medium text-body">{dish.name}</span>
                          <span className="font-mono text-xs text-muted">{dish.id}</span>
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-muted">{dish.canteen}</td>
                      <td className="py-2 pr-3">
                        <KdyBadge tone="neutral">{DISH_CATEGORY_LABELS[dish.category]}</KdyBadge>
                      </td>
                      <td className="py-2 pr-3 text-muted">{dish.servingG} g</td>
                      <td className="py-2 pr-3 text-body">{dish.caloriesKcal} kcal</td>
                      <td className="py-2 pr-3 text-muted">{dish.proteinG} g</td>
                      <td className="py-2 pr-3 text-muted">{dish.fatG} g</td>
                      <td className="py-2 pr-3 text-muted">{dish.carbG} g</td>
                      <td className="py-2 pr-3 text-muted">{dish.fiberG} g</td>
                      <td className="py-2 pr-3 text-muted">{dish.sodiumMg} mg</td>
                      <td className="py-2 pr-3 text-muted">¥{fenToYuan(dish.priceFen)}</td>
                      <td className="py-2 pr-3">
                        {pendingDeleteId === dish.id ? (
                          <span className="flex items-center gap-1.5 text-xs">
                            <span className="text-danger">确认删除？</span>
                            <button
                              type="button"
                              onClick={() => removeMutation.mutate(dish.id)}
                              className="rounded-md bg-danger px-2 py-0.5 text-inverse"
                            >
                              确认
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDeleteId(null)}
                              className="rounded-md border border-border px-2 py-0.5 text-muted"
                            >
                              取消
                            </button>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <KdyButton size="sm" variant="ghost" onClick={() => openEdit(dish)}>
                              <Pencil className="size-3.5" aria-hidden />
                              编辑
                            </KdyButton>
                            <KdyButton size="sm" variant="ghost" onClick={() => setPendingDeleteId(dish.id)}>
                              <Trash2 className="size-3.5" aria-hidden />
                              删除
                            </KdyButton>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </KdyCard>
      </section>

      {formOpen ? (
        <section className="flex flex-col gap-3" aria-labelledby="dishes-form-heading">
          <header className="flex flex-wrap items-end justify-between gap-2">
            <h2 id="dishes-form-heading" className="text-lg font-semibold text-body">
              {editingId === null ? '新建菜品' : `编辑：${form.name || editingId}`}
            </h2>
            <KdyButton size="sm" variant="ghost" onClick={() => setFormOpen(false)}>
              收起
            </KdyButton>
          </header>

          <KdyCard>
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="flex flex-col gap-1 text-xs text-muted">
                  食堂
                  <input
                    value={form.canteen}
                    onChange={(event) => setForm({ ...form, canteen: event.target.value })}
                    list="kdy-dish-canteen-options"
                    className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-body"
                  />
                  {/* 自由文本 + 白名单候选：校内的「丝路餐厅」等不在白名单里，不能堵死 */}
                  <datalist id="kdy-dish-canteen-options">
                    {CANTEEN_NAMES.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  菜名
                  <input
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    placeholder="如：红烧排骨"
                    className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-body"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  菜的种类
                  <select
                    value={form.category}
                    onChange={(event) => setForm({ ...form, category: event.target.value as DishCategory })}
                    className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-body"
                  >
                    {DISH_CATEGORIES.map((item) => (
                      <option key={item} value={item}>
                        {DISH_CATEGORY_LABELS[item]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  每份克数 (g)
                  <input
                    type="number"
                    value={form.servingG}
                    onChange={(event) => setForm({ ...form, servingG: event.target.value })}
                    className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-body"
                  />
                </label>
              </div>

              <fieldset className="rounded-md border border-border p-3">
                <legend className="px-1 text-xs text-muted">每份营养成分</legend>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {NUTRIENT_FIELDS.map((field) => (
                    <label key={field.key} className="flex flex-col gap-1 text-xs text-muted">
                      {field.label} ({field.unit})
                      <input
                        type="number"
                        value={form[field.key]}
                        onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                        className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-body"
                      />
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="flex flex-col gap-1 text-xs text-muted">
                  价格 (元)
                  <input
                    type="number"
                    step="0.5"
                    value={form.priceYuan}
                    onChange={(event) => setForm({ ...form, priceYuan: event.target.value })}
                    placeholder="如：14"
                    className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-body"
                  />
                </label>
              </div>

              {formError !== undefined ? (
                <KdyAlert tone="danger" title="保存被拒绝">
                  <p>{formError}</p>
                </KdyAlert>
              ) : null}

              {/*
                能量一致性提示（不阻断保存）：
                热量与 4×蛋白 + 4×碳水 + 9×脂肪 差太多时，基本是少打/多打了一位数字。
                服务端只拦 >60% 的离谱值，35%-60% 之间由这里提醒人工复核。
              */}
              {formWarning !== null ? (
                <KdyAlert tone="warning" title="请复核一下">
                  <p>{formWarning}</p>
                </KdyAlert>
              ) : null}

              <div className="flex items-center gap-2">
                <KdyButton type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? '保存中…' : editingId === null ? '创建菜品' : '保存修改'}
                </KdyButton>
                <KdyButton type="button" variant="ghost" onClick={() => setFormOpen(false)}>
                  取消
                </KdyButton>
              </div>
            </form>
          </KdyCard>
        </section>
      ) : null}
    </div>
  );
}
