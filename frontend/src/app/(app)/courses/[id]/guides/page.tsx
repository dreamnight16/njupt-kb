import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Notice } from '@/components/common/Notice';
import { ResourceCard } from '@/components/resource/ResourceCard';
import type { CourseDetail } from '@/lib/api/catalog';
import type { ResourceListOut } from '@/lib/api/content';
import { serverFetch } from '@/lib/api/server';
import { isUuid } from '@/lib/utils';

export const metadata: Metadata = { title: '课程攻略' };
export const dynamic = 'force-dynamic';

export default async function CourseGuidesPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { cursor } = await searchParams;
  const [courseResult, guidesResult] = await Promise.all([
    serverFetch<CourseDetail>(`/courses/${id}`),
    serverFetch<ResourceListOut>(`/resources?course_id=${id}&resource_type=guide&limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  ]);
  if (courseResult.error?.status === 404) notFound();
  const course = courseResult.data;
  if (!course) return <Notice tone="warning" title="课程暂时无法加载">请稍后刷新重试。</Notice>;
  const guides = guidesResult.data;
  return (
    <div className="space-y-6">
      <header className="border-b border-divider pb-6">
        <Link href={`/courses/${id}`} className="text-sm text-brand underline underline-offset-2">返回 {course.name}</Link>
        <h1 className="dn-display mt-4 text-3xl">{course.name} · 课程攻略</h1>
        <p className="mt-3 text-text-secondary">学习路线、复习方法与课程经验。阅读前请核对适用学期、教师和资料时效。</p>
        <Link href={`/upload?course_id=${id}&type=guide`} className="mt-4 inline-flex min-h-11 items-center bg-brand px-4 text-sm font-medium text-on-color">分享课程攻略</Link>
      </header>
      {guidesResult.error ? (
        <Notice tone="warning" title="攻略暂时无法加载">{guidesResult.error.message}。请稍后重试。</Notice>
      ) : guides && guides.items.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {guides.items.map((item) => (
            <ResourceCard key={item.id} resourceId={item.id} title={item.title ?? '（未命名攻略）'}
              resourceType={item.resource_type} courseName={course.name} courseCode={course.code} freshness={item.freshness_status} />
          ))}
        </div>
      ) : (
        <Notice tone="info" title={cursor ? '这一页没有攻略' : '这门课还没有已发布的攻略'}>可以分享你的课程经验，通过审核后会在这里展示。</Notice>
      )}
      <nav aria-label="攻略分页" className="flex gap-6 text-sm text-brand">
        {cursor && <Link href={`/courses/${id}/guides`} className="min-h-11 content-center underline">返回第一页</Link>}
        {guides?.has_more && guides.next_cursor && <Link href={`/courses/${id}/guides?cursor=${encodeURIComponent(guides.next_cursor)}`} className="min-h-11 content-center underline">下一页攻略</Link>}
      </nav>
    </div>
  );
}
