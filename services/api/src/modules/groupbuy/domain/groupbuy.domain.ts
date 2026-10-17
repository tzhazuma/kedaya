import type { Page } from '@kedaya/contracts';
import type { ListParams } from '../../../common/crud/resource';

export interface GroupbuyListParams extends ListParams {
  category?: string;
  keyword?: string;
  kind?: GroupbuyKind;
}

export type GroupbuyKind = 'ordinary' | 'membership';
export type GroupbuyStatus = 'open' | 'grouped' | 'cancelled';

export interface GroupbuyMemberModel {
  id: string;
  userId: string;
  displayName: string;
  quantity: number;
  note: string | null;
  joinedAt: Date;
  receivedAt: Date | null;
  selections: Array<{ item: string; quantity: number }>;
}

export interface GroupbuyOrderModel {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  category: string;
  itemSpec: string | null;
  itemOptions: string[];
  targetCount: number;
  unitPriceFen: number;
  status: GroupbuyStatus;
  deadline: Date;
  pickupSpot: string | null;
  kind: GroupbuyKind;
  merchantName: string | null;
  membershipDeclaration: boolean;
  cancelReason: string | null;
  pickupNotice: string | null;
  createdAt: Date;
  updatedAt: Date;
  members: GroupbuyMemberModel[];
  joinedQuantity: number;
  participantCount: number;
}

export interface CreateGroupbuyOrderInput {
  title: string;
  description?: string | null;
  category: string;
  itemSpec?: string | null;
  items?: string[];
  targetCount: number;
  unitPriceFen?: number;
  pickupSpot: string;
  kind: GroupbuyKind;
  merchantName?: string | null;
  membershipDeclaration?: boolean;
}

export interface UpdateGroupbuyOrderInput {
  title?: string;
  description?: string | null;
  category?: string;
  targetCount?: number;
  unitPriceFen?: number;
  pickupSpot?: string;
}

export interface MemberChange {
  quantity: number;
  displayName: string;
  note?: string | null;
  selections?: Array<{ item: string; quantity: number }>;
}

export interface GroupbuyOrderRepository {
  list(params: GroupbuyListParams): Promise<Page<GroupbuyOrderModel>>;
  create(input: CreateGroupbuyOrderInput & { ownerId: string; deadline: Date; clientKey?: string }): Promise<GroupbuyOrderModel>;
  findById(id: string): Promise<GroupbuyOrderModel | null>;
  updateOwned(id: string, ownerId: string, input: UpdateGroupbuyOrderInput): Promise<GroupbuyOrderModel>;
  cancelOwned(id: string, ownerId: string): Promise<GroupbuyOrderModel>;
  changeMember(id: string, userId: string, input: MemberChange): Promise<GroupbuyOrderModel>;
  expireDue(now: Date): Promise<number>;
  publishPickupNotice(id: string, ownerId: string, notice: string): Promise<GroupbuyOrderModel>;
  markReceived(id: string, ownerId: string, userId: string, received: boolean): Promise<GroupbuyOrderModel>;
}

export const GROUPBUY_ORDER_REPOSITORY = Symbol('KEDAYA_GROUPBUY_ORDER_REPOSITORY');
