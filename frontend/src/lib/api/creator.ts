import { api } from './client';
import type { CursorPage } from './types';

/** 贡献记录类型（§24.1）：只接受事实型贡献，不含访问/下载等使用行为。 */
export type ContributionKind =
  | 'published_resource'
  | 'accepted_revision'
  | 'adopted_correction'
  | 'resolved_request';

export const CONTRIBUTION_KIND_LABELS: Record<ContributionKind, string> = {
  published_resource: '发布资料',
  accepted_revision: '修订被采纳',
  adopted_correction: '纠错被采纳',
  resolved_request: '解决资料需求',
};

export interface ContributionSummary {
  user_id: string;
  total: number;
  by_kind: Partial<Record<ContributionKind, number>>;
  /** 展示用贡献分，不承诺兑换现金。 */
  points: number;
  is_creator: boolean;
}

export interface ContributionOut {
  id: string;
  user_id: string;
  kind: ContributionKind;
  reference_type: string;
  reference_id: string;
  note: string | null;
  points: number;
  revoked_at: string | null;
  created_at: string;
}

export interface CreatorProfileOut {
  user_id: string;
  display_name: string;
  headline: string | null;
  bio: string | null;
  avatar_url: string | null;
  contribution: ContributionSummary;
}

/** 本人视角：额外返回是否公开，且未公开的简介也如实返回，便于回填表单。 */
export interface CreatorSelfProfileOut extends CreatorProfileOut {
  is_public: boolean;
}

export interface CreatorProfileUpdate {
  headline?: string | null;
  bio?: string | null;
  is_public?: boolean;
}

export async function getCreatorProfile(userId: string): Promise<CreatorProfileOut> {
  const { data } = await api.get<CreatorProfileOut>(`/creators/${userId}`);
  return data;
}

export async function getMyCreatorProfile(): Promise<CreatorSelfProfileOut> {
  const { data } = await api.get<CreatorSelfProfileOut>('/me/creator-profile');
  return data;
}

export async function updateMyCreatorProfile(
  payload: CreatorProfileUpdate,
): Promise<CreatorSelfProfileOut> {
  const { data } = await api.put<CreatorSelfProfileOut>('/me/creator-profile', payload);
  return data;
}

export async function listMyContributions(
  cursor?: string | null,
): Promise<CursorPage<ContributionOut>> {
  const { data } = await api.get<CursorPage<ContributionOut>>('/me/contributions', {
    params: { cursor: cursor || undefined },
  });
  return data;
}
