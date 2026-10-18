import type { Metadata } from 'next';
import Link from 'next/link';

import { CourseCard } from '@/components/catalog/CourseCard';
import { Notice } from '@/components/common/Notice';
import type { CollegeBrief, CourseListItem, MajorBrief } from '@/lib/api/catalog';
import { serverFetch } from '@/lib/api/server';
import type { CursorPage } from '@/lib/api/types';
import { firstSearchParam, isUuid } from '@/lib/utils';
import CoursesFilterForm from './CoursesFilterForm';

export const metadata: Metadata = {
  title: '课程',
  description: '按课程名称、代码与专业浏览南京邮电大学课程，进入课程查看开课范围与分类资料。',
  alternates: { canonical: '/courses' },
};

export const dynamic = 'force-dynamic';

interface CoursesSearchParams {
  q?: string | string[];
  college_id?: string | string[];
  major_id?: string | string[];
  cursor?: string | string[];
}

function buildQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<CoursesSearchParams>;
}) {
  const params = await searchParams;
  const keyword = firstSearchParam(params.q)?.trim() || '';
  const rawCollegeId = firstSearchParam(params.college_id);
  const rawMajorId = firstSearchParam(params.major_id);
  const collegeId = isUuid(rawCollegeId) ? rawCollegeId : '';
  const majorId = isUuid(rawMajorId) ? rawMajorId : '';
  const cursor = firstSearchParam(params.cursor) || '';

  const query = buildQuery({
    q: keyword || undefined,
    college_id: collegeId || undefined,
    major_id: majorId || undefined,
    cursor: cursor || undefined,
    limit: '20',
  });

  const [listResult, collegesResult, majorsResult] = await Promise.all([
    serverFetch<CursorPage<CourseListItem>>(`/courses${query}`),
    serverFetch<CollegeBrief[]>('/colleges'),
    serverFetch<MajorBrief[]>('/majors'),
  ]);

  const colleges = collegesResult.data ?? [];
  const majors = majorsResult.data ?? [];
  const hasFilters = Boolean(keyword || collegeId || majorId);

  const nextCursor = listResult.data?.next_cursor ?? null;

  return (
    <div className="space-y-6">
      <header className="bg-ink px-6 py-8 text-on-ink">
        <p className="dn-kicker">COURSES</p>
        <h1 className="dn-display mt-2 text-3xl">课程列表</h1>
        <p className="mt-2 max-w-2xl text-on-ink">
          课程代码可能随培养方案变化，同名课程默认分开。
        </p>
      </header>

      <CoursesFilterForm
        key={JSON.stringify([keyword, collegeId, majorId, cursor])}
        colleges={colleges}
        majors={majors}
        keyword={keyword}
        collegeId={collegeId}
        majorId={majorId}
        hasFilters={hasFilters}
      />

      {(collegesResult.error || majorsResult.error) && (
        <Notice tone="info" title="学院与专业筛选项暂时不可用">
          仍可按关键词搜索课程。{collegesResult.error?.message || majorsResult.error?.message}
        </Notice>
      )}

      {listResult.error ? (
        <Notice tone="warning" title="课程列表暂时无法加载">
          {listResult.error.message}。这不表示没有课程，请稍后重试。
        </Notice>
      ) : listResult.data && listResult.data.items.length > 0 ? (
        <>
          <p className="text-sm text-text-secondary">
            共显示 {listResult.data.items.length} 门课程
          </p>
          <div className="dn-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listResult.data.items.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>
          {nextCursor && (
            <div className="flex justify-center pt-2">
              <Link
                href={`/courses${buildQuery({
                  q: keyword || undefined,
                  college_id: collegeId || undefined,
                  major_id: majorId || undefined,
                  cursor: nextCursor,
                })}`}
                className="inline-flex min-h-11 items-center border border-control-border px-5 text-sm font-medium text-text-primary hover:bg-canvas"
              >
                下一页
              </Link>
            </div>
          )}
        </>
      ) : (
        <Notice tone="info" title={hasFilters ? '没有匹配的课程' : '课程目录中还没有课程'}>
          {hasFilters
            ? '换个关键词，或放宽筛选条件。'
            : '目录由维护者导入。'}
        </Notice>
      )}
    </div>
  );
}
