/**
 * 用例：加载 wildlife 的"字典"数据（物种 / 区域 / 命名个体）。
 *
 * 多个页面（区域列表、轨迹页、上报页、审核队列）都需要同一份字典，
 * 因此把它收敛成一个用例，避免每个页面各自拼一遍（拼错就会出现"物种名显示成 id"）。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import type { WildlifeRepository } from '@/domain/ports/wildlife';

import type { WildlifeCatalog } from './listSightings';

export async function loadWildlifeCatalog(
  repository: WildlifeRepository,
): Promise<Result<WildlifeCatalog, ApiError>> {
  const [speciesResult, zonesResult, individualsResult] = await Promise.all([
    repository.species(),
    repository.zones({ limit: 50 }),
    repository.individuals({ limit: 50 }),
  ]);

  if (!speciesResult.ok) return err(speciesResult.error);
  if (!zonesResult.ok) return err(zonesResult.error);
  if (!individualsResult.ok) return err(individualsResult.error);

  return ok({
    species: speciesResult.value,
    zones: zonesResult.value.items,
    individuals: individualsResult.value.items,
  });
}
