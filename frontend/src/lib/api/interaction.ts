/**
 * 搜索、收藏、评价、评论、纠错与求资料接口（backend/app/modules/interaction/router.py）。
 * 收藏使用 PUT 设置 / DELETE 取消，不做会反转状态的 toggle（§20.1、§25.1）。
 */
import { api } from './client';
import type { CourseBrief } from './catalog';
import type { CursorPage, ResourceType } from './types';

export interface FollowItem {
  id: string;
  target_type: 'course' | 'creator';
  target_id: string;
  created_at: string;
  /** 目标摘要：课程为 CourseBrief，创作者为公开昵称；目标缺失时为 null。 */
  target: Record<string, unknown> | null;
}

export interface RatingSummary {
  average: number;
  count: number;
  /** 小样本采用收缩后的评分，不让单个五星无条件置顶（§20.1）。 */
  shrunk: number;
}

export interface SearchItem {
  resource_id: string;
  course_id: string;
  /** 课程摘要帮助区分同名不同课程代码的结果（§19.2）。 */
  course: CourseBrief | null;
  title: string;
  resource_type: ResourceType | null;
  freshness_status: string | null;
  published_version_id: string | null;
  rating: RatingSummary;
}

export interface RecommendationItem extends SearchItem {
  reasons: string[];
}

export interface RecommendationsOut {
  items: RecommendationItem[];
}

export interface FavoriteItem {
  resource_id: string;
  created_at: string;
  /** 资源下架时为 false：显示不可用状态，不自动打开旧版文件。 */
  available: boolean;
  publication_status: string;
  course_id: string | null;
  title: string | null;
}

export interface CommentItem {
  id: string;
  resource_id: string;
  user_id: string;
  display_name: string;
  parent_id: string | null;
  body: string | null;
  created_at: string;
  status: 'visible' | 'withdrawn' | 'hidden';
  revision: number;
}

export interface CorrectionItem {
  id: string;
  resource_id: string;
  version_id: string;
  submitter_id: string;
  description: string;
  suggested_course_id?: string | null;
  suggested_resource_type?: ResourceType | null;
  status: string;
  resolution_note: string | null;
  fixed_version_id: string | null;
  handled_by: string | null;
  handled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RequestItem {
  id: string;
  course_id: string;
  scope: string | null;
  description: string;
  status: string;
  follower_count: number;
  resolved_resource_id: string | null;
  created_at: string;
  requester_id: string;
  revision: number;
  handled_at: string | null;
  resolution_available: boolean;
  resolved_resource_title: string | null;
}

export interface RequestResponseItem {
  id: string; request_id: string; submitted_by: string;
  resource_id: string | null; resource_title: string | null;
  available: boolean; created_at: string;
}

export async function getRequest(id: string): Promise<RequestItem> {
  return (await api.get(`/requests/${id}`)).data;
}
export async function changeRequestStatus(id: string, payload: { status: 'open' | 'fulfilled' | 'closed'; expected_revision: number; resource_id?: string; reason?: string }): Promise<RequestItem> {
  return (await api.post(`/requests/${id}/status`, payload)).data;
}
export async function listRequestResponses(id: string, cursor?: string | null): Promise<CursorPage<RequestResponseItem>> {
  return (await api.get(`/requests/${id}/responses`, { params: { cursor: cursor || undefined } })).data;
}
export async function submitRequestResponse(id: string, resourceId: string): Promise<RequestResponseItem> {
  return (await api.post(`/requests/${id}/responses`, { resource_id: resourceId })).data;
}

export interface RequestCreateResult {
  created: boolean;
  request: RequestItem;
}

export interface FollowResult {
  followed: boolean;
  follower_count: number;
}

export interface CreatorPublic {
  user_id: string;
  display_name: string;
  contribution: Record<string, unknown> | null;
}

export interface SearchParams {
  q?: string;
  university_id?: string;
  curriculum_id?: string;
  course_id?: string;
  semester_id?: string;
  teacher_id?: string;
  resource_type?: ResourceType;
  applicable_year?: number;
  cursor?: string | null;
  limit?: number;
}

export async function search(params: SearchParams = {}): Promise<CursorPage<SearchItem>> {
  const { data } = await api.get<CursorPage<SearchItem>>('/search', { params });
  return data;
}

export async function setFavorite(resourceId: string): Promise<void> {
  await api.put(`/me/favorites/${resourceId}`);
}

export async function removeFavorite(resourceId: string): Promise<void> {
  await api.delete(`/me/favorites/${resourceId}`);
}

export async function listFavorites(
  cursor?: string | null,
): Promise<CursorPage<FavoriteItem>> {
  const { data } = await api.get<CursorPage<FavoriteItem>>('/me/favorites', {
    params: { cursor: cursor || undefined },
  });
  return data;
}

// --- 关注（§20.2）：PUT 设置 / DELETE 取消，与收藏同样避免 toggle 反转 ---

export async function setFollow(
  targetType: 'course' | 'creator',
  targetId: string,
): Promise<void> {
  await api.put(`/me/follows/${targetType}/${targetId}`);
}

export async function removeFollow(
  targetType: 'course' | 'creator',
  targetId: string,
): Promise<void> {
  await api.delete(`/me/follows/${targetType}/${targetId}`);
}

export async function listFollows(params: {
  target_type?: 'course' | 'creator';
  cursor?: string | null;
} = {}): Promise<CursorPage<FollowItem>> {
  const { data } = await api.get<CursorPage<FollowItem>>('/me/follows', {
    params: { ...params, cursor: params.cursor || undefined },
  });
  return data;
}

export async function submitRating(
  resourceId: string,
  versionId: string,
  score: number,
): Promise<RatingSummary> {
  const { data } = await api.put<RatingSummary>(
    `/resources/${resourceId}/versions/${versionId}/rating`,
    { score },
  );
  return data;
}

export async function ratingSummary(resourceId: string): Promise<RatingSummary> {
  const { data } = await api.get<RatingSummary>(
    `/resources/${resourceId}/ratings/summary`,
  );
  return data;
}

export async function listComments(
  resourceId: string,
  cursor?: string | null,
): Promise<CursorPage<CommentItem>> {
  const { data } = await api.get<CursorPage<CommentItem>>(
    `/resources/${resourceId}/comments`,
    { params: { cursor: cursor || undefined } },
  );
  return data;
}

export async function createComment(
  resourceId: string,
  body: string,
  parentId?: string | null,
): Promise<CommentItem> {
  const { data } = await api.post<CommentItem>(`/resources/${resourceId}/comments`, {
    body,
    parent_id: parentId ?? null,
  });
  return data;
}

export async function withdrawComment(resourceId: string, commentId: string, expectedRevision: number): Promise<CommentItem> {
  return (await api.post<CommentItem>(`/resources/${resourceId}/comments/${commentId}/withdraw`, {
    expected_revision: expectedRevision,
  })).data;
}

export async function moderateComment(resourceId: string, commentId: string, expectedRevision: number, hidden: boolean, reason: string): Promise<CommentItem> {
  return (await api.post<CommentItem>(`/resources/${resourceId}/comments/${commentId}/moderation`, {
    expected_revision: expectedRevision, hidden, reason,
  })).data;
}

export async function createCorrection(payload: {
  resource_id: string;
  version_id: string;
  description: string;
  suggested_course_id?: string;
  suggested_resource_type?: ResourceType;
}): Promise<CorrectionItem> {
  const { data } = await api.post<CorrectionItem>('/corrections', payload);
  return data;
}

export async function applyClassificationFix(id: string, expectedRevision: number, note: string): Promise<CorrectionItem> {
  return (await api.post<CorrectionItem>(`/admin/corrections/${id}/classification`, { expected_revision: expectedRevision, resolution_note: note })).data;
}

export async function listMyCorrections(
  cursor?: string | null,
): Promise<CursorPage<CorrectionItem>> {
  const { data } = await api.get<CursorPage<CorrectionItem>>('/me/corrections', {
    params: { cursor: cursor || undefined },
  });
  return data;
}

export async function listCorrections(params: {
  status?: string;
  cursor?: string | null;
  limit?: number;
} = {}): Promise<CursorPage<CorrectionItem>> {
  const { data } = await api.get<CursorPage<CorrectionItem>>('/admin/corrections', {
    params: { ...params, cursor: params.cursor || undefined },
  });
  return data;
}

export async function updateCorrectionStatus(
  correctionId: string,
  payload: {
    status: 'accepted' | 'rejected' | 'fixed';
    resolution_note?: string | null;
    fixed_version_id?: string | null;
  },
): Promise<CorrectionItem> {
  const { data } = await api.post<CorrectionItem>(
    `/admin/corrections/${correctionId}/status`,
    payload,
  );
  return data;
}

export async function createRequest(payload: {
  course_id: string;
  scope?: string | null;
  description: string;
}): Promise<RequestCreateResult> {
  const { data } = await api.post<RequestCreateResult>('/requests', payload);
  return data;
}

export async function listRequests(params: {
  course_id?: string;
  status?: string;
  cursor?: string | null;
  limit?: number;
} = {}): Promise<CursorPage<RequestItem>> {
  const { data } = await api.get<CursorPage<RequestItem>>('/requests', {
    params: { ...params, cursor: params.cursor || undefined },
  });
  return data;
}

export async function followRequest(requestId: string): Promise<FollowResult> {
  const { data } = await api.post<FollowResult>(`/requests/${requestId}/follow`);
  return data;
}

export async function listMyRequests(
  cursor?: string | null,
): Promise<CursorPage<RequestItem>> {
  const { data } = await api.get<CursorPage<RequestItem>>('/me/requests', {
    params: { cursor: cursor || undefined },
  });
  return data;
}

export async function creatorProfile(userId: string): Promise<CreatorPublic> {
  const { data } = await api.get<CreatorPublic>(`/creators/${userId}`);
  return data;
}
