import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Notice } from '@/components/common/Notice';
import { CreatorFollowButton } from '@/components/creator/CreatorFollowButton';
import { Avatar } from '@/components/common/Avatar';
import { ResourceCard } from '@/components/resource/ResourceCard';
import {
  CONTRIBUTION_KIND_LABELS,
  type ContributionKind,
  type CreatorProfileOut,
} from '@/lib/api/creator';
import type { ResourceListItem } from '@/lib/api/content';
import { serverFetch } from '@/lib/api/server';
import type { CursorPage } from '@/lib/api/types';
import { isUuid } from '@/lib/utils';

export const dynamic = 'force-dynamic';

async function loadProfile(id: string) {
  return serverFetch<CreatorProfileOut>(`/creators/${id}`);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: '贡献者' };

  const { data } = await loadProfile(id);
  if (!data) return { title: '贡献者' };

  return {
    title: `${data.display_name} · 贡献者`,
    description: data.headline ?? `${data.display_name} 在课程知识平台分享的资料与贡献记录。`,
    alternates: { canonical: `/creators/${data.user_id}` },
  };
}

export default async function CreatorProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const profileResult = await loadProfile(id);
  if (profileResult.error?.status === 404) notFound();
  const profile = profileResult.data;

  if (!profile) {
    return (
      <Notice tone="warning" title="贡献者信息暂时无法加载">
        {profileResult.error?.message ?? '请稍后重试。'}
      </Notice>
    );
  }

  const resourcesResult = await serverFetch<CursorPage<ResourceListItem>>(
    `/resources?owner_id=${id}&limit=20`,
  );
  const { contribution } = profile;
  const kinds = Object.entries(contribution.by_kind) as [ContributionKind, number][];

  return (
    <div className="space-y-8">
      <header className="bg-steel px-6 py-8 text-on-color">
        <p className="dn-kicker">CONTRIBUTOR</p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Avatar url={profile.avatar_url} name={profile.display_name} />
          <div className="min-w-0">
            <h1 className="dn-display text-3xl md:text-4xl">{profile.display_name}</h1>
            {profile.headline && (
              <p className="mt-2 text-sm text-on-color">{profile.headline}</p>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-on-color">
          <span>贡献记录 {contribution.total} 次</span>
          <span>贡献分 {contribution.points}</span>
          <span>{contribution.is_creator ? '已建立贡献者资料' : '尚未建立贡献者资料'}</span>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <CreatorFollowButton creatorId={profile.user_id} />
      </div>

      {profile.bio && (
        <section aria-labelledby="creator-bio">
          <h2 id="creator-bio" className="dn-display text-2xl">
            简介
          </h2>
          <p className="mt-3 max-w-3xl whitespace-pre-line text-text-secondary">{profile.bio}</p>
        </section>
      )}

      <section aria-labelledby="creator-contribution">
        <h2 id="creator-contribution" className="dn-display text-2xl">
          贡献构成
        </h2>
        {kinds.length > 0 ? (
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {kinds.map(([kind, count]) => (
              <div key={kind} className="border border-divider bg-surface p-4">
                <dt className="text-sm text-text-secondary">
                  {CONTRIBUTION_KIND_LABELS[kind] ?? kind}
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-text-primary">{count}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="mt-3">
            <Notice tone="info" title="还没有可展示的贡献记录">
              资料通过审核、修订被采纳或纠错被采纳后会记为贡献（§24.1）。
            </Notice>
          </div>
        )}
      </section>

      <section aria-labelledby="creator-resources">
        <h2 id="creator-resources" className="dn-display text-2xl">
          公开资料
        </h2>
        <div className="mt-3">
          {resourcesResult.error ? (
            <Notice tone="warning" title="资料列表暂时无法加载">
              {resourcesResult.error.message}
            </Notice>
          ) : resourcesResult.data && resourcesResult.data.items.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {resourcesResult.data.items.map((item) => (
                <ResourceCard
                  key={item.id}
                  resourceId={item.id}
                  title={item.title ?? '（未命名资料）'}
                  resourceType={item.resource_type}
                  freshness={item.freshness_status}
                />
              ))}
            </div>
          ) : (
            <Notice tone="info" title="还没有公开资料">
              只有通过审核并发布的资料会出现在这里；未公开或不对外可见的资料不会显示。
            </Notice>
          )}
        </div>
      </section>

      <p className="text-sm text-text-secondary">
        贡献记录用于展示与运营，不承诺兑换现金。想查看自己的贡献，可前往{' '}
        <Link href="/me/contributions" className="underline underline-offset-2">
          我的贡献
        </Link>
        。
      </p>
    </div>
  );
}
