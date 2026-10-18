import type { Metadata } from 'next';
import Link from 'next/link';

import { Notice } from '@/components/common/Notice';
import { serverFetch } from '@/lib/api/server';
import type { KaoyanSchool } from '@/lib/api/topics';
import type { CursorPage } from '@/lib/api/types';

export const metadata: Metadata = { title: '考研专题' };
export const dynamic = 'force-dynamic';

export default async function KaoyanPage() {
  const result = await serverFetch<CursorPage<KaoyanSchool>>('/topics/kaoyan/schools?limit=40');
  const schools = result.data?.items ?? [];

  return (
    <div className="space-y-8">
      <header className="border-b border-divider pb-6">
        <p className="text-sm text-text-secondary">院校 / 专业 / 分数线</p>
        <h1 className="dn-display mt-2 text-3xl">考研专题</h1>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/search?q=考研" className="inline-flex min-h-11 items-center bg-brand px-4 text-sm font-medium text-on-color">
            找考研资料
          </Link>
          <Link href="/me/guides" className="inline-flex min-h-11 items-center border border-control-border px-4 text-sm">
            写备考攻略
          </Link>
        </div>
      </header>

      <section aria-labelledby="kaoyan-schools" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="kaoyan-schools" className="text-xl font-semibold">院校</h2>
        </div>
        {result.error ? (
          <Notice tone="warning" title="院校暂时无法加载">{result.error.message}</Notice>
        ) : schools.length === 0 ? (
          <Notice tone="info" title="还没有院校记录" />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {schools.map((school) => (
              <li key={school.id} className="border border-divider bg-surface p-4">
                <Link href={`/kaoyan/schools/${school.id}`} className="text-base font-medium underline underline-offset-2">
                  {school.name}
                </Link>
                {school.is_njupt && (
                  <span className="ml-2 bg-brand px-2 py-0.5 text-xs text-on-color">本校</span>
                )}
                {school.website_url && (
                  <a
                    href={school.website_url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="mt-2 block text-sm text-brand underline underline-offset-2"
                  >
                    研究生院网站
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

    </div>
  );
}
