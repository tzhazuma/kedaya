import type { WildlifeAnimal, WildlifeAnimalInput, WildlifeCategory, WildlifePage, WildlifePhoto, WildlifeSighting, WildlifeSightingInput } from '@kedaya/contracts/wildlife'
import type { ApiClient, QueryMap } from '../../data/api/request'
import type { Result } from '@kedaya/shared'
import type { ApiError } from '@kedaya/contracts'

async function unwrap<T>(result: Promise<Result<T, ApiError>>): Promise<T> {
  const value = await result
  if (!value.ok) throw new Error(value.error.message)
  return value.value
}
/** 本模块始终使用共享 API；不把本地 mock 数据作为公开观察记录。 */
export function createWildlifeArchive(api: ApiClient) {
  return {
    categories: () => unwrap(api.get<WildlifeCategory[]>('/wildlife/categories')),
    sightings: (query: QueryMap = {}) => unwrap(api.get<WildlifePage<WildlifeSighting>>('/wildlife/sightings', query)),
    sighting: (id: string) => unwrap(api.get<WildlifeSighting>(`/wildlife/sightings/${encodeURIComponent(id)}`)),
    saveSighting: (body: WildlifeSightingInput, id?: string) => {
      if (!id) return unwrap(api.post<WildlifeSighting>('/wildlife/sightings', body))
      const { clientRequestId: _, ...update } = body
      return unwrap(api.patch<WildlifeSighting>(`/wildlife/sightings/${encodeURIComponent(id)}`, update))
    },
    removeSighting: (id: string) => unwrap(api.del<{ deleted: true }>(`/wildlife/sightings/${encodeURIComponent(id)}`)),
    animals: (query: QueryMap = {}) => unwrap(api.get<WildlifePage<WildlifeAnimal>>('/wildlife/animals', query)),
    animal: (id: string) => unwrap(api.get<WildlifeAnimal>(`/wildlife/animals/${encodeURIComponent(id)}`)),
    saveAnimal: (body: WildlifeAnimalInput, id?: string) => {
      if (!id) return unwrap(api.post<WildlifeAnimal>('/wildlife/animals', body))
      const { clientRequestId: _, ...update } = body
      return unwrap(api.patch<WildlifeAnimal>(`/wildlife/animals/${encodeURIComponent(id)}`, update))
    },
  }
}
export type WildlifeArchive = ReturnType<typeof createWildlifeArchive>
export type { WildlifePhoto }
