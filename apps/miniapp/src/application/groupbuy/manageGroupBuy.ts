import { err, type Result } from '@kedaya/shared'
import type { GroupBuy } from '../../domain/models/groupbuy'
import type { RepositoryError } from '../../domain/ports/errors'
import type { CreateGroupBuyInput, GroupBuyRepository } from '../../domain/ports/groupbuyRepository'
import type { SessionStorePort } from '../../domain/ports/sessionPort'

type Draft = Omit<CreateGroupBuyInput, 'initiatorId' | 'initiatorName'>

export function createManageGroupBuyUseCase(repository: GroupBuyRepository, session: SessionStorePort) {
  function actor() {
    return session.getSnapshot().profile
  }
  return {
    create(draft: Draft): Promise<Result<GroupBuy, RepositoryError>> {
      const profile = actor()
      if (!profile) return Promise.resolve(err({ code: 'UNAUTHENTICATED', message: '请先登录后发起拼单' }))
      return repository.create({ ...draft, initiatorId: profile.id, initiatorName: profile.nickname })
    },
    withdraw(id: string): Promise<Result<GroupBuy, RepositoryError>> {
      const profile = actor()
      if (!profile) return Promise.resolve(err({ code: 'UNAUTHENTICATED', message: '请先登录' }))
      return repository.withdraw(id, profile.id)
    },
    cancel(id: string): Promise<Result<GroupBuy, RepositoryError>> {
      const profile = actor()
      if (!profile) return Promise.resolve(err({ code: 'UNAUTHENTICATED', message: '请先登录' }))
      return repository.cancel(id, profile.id)
    },
    publishPickupNotice(id: string, notice: string): Promise<Result<GroupBuy, RepositoryError>> {
      const profile = actor()
      if (!profile) return Promise.resolve(err({ code: 'UNAUTHENTICATED', message: '请先登录' }))
      return repository.publishPickupNotice(id, profile.id, notice)
    },
    markReceived(id: string, memberId: string, received: boolean): Promise<Result<GroupBuy, RepositoryError>> {
      const profile = actor()
      if (!profile) return Promise.resolve(err({ code: 'UNAUTHENTICATED', message: '请先登录' }))
      return repository.markReceived(id, profile.id, memberId, received)
    },
  }
}
