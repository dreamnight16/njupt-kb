import { RequestsClient } from '@/components/common/RequestsClient';
import { Notice } from '@/components/common/Notice';
import type { CourseDetail } from '@/lib/api/catalog';
import { serverFetch } from '@/lib/api/server';
import { isUuid } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function RequestsPage({ searchParams }: {
  searchParams: Promise<{ course_id?: string; new?: string }>;
}) {
  const params = await searchParams;
  const result = params.course_id && isUuid(params.course_id)
    ? await serverFetch<CourseDetail>(`/courses/${params.course_id}`) : null;
  return <>
    {params.course_id && !result?.data && <Notice tone="warning" title="未能带入课程">请在表单中重新选择课程。</Notice>}
    <RequestsClient key={`${params.course_id ?? ''}:${params.new ?? ''}`} initialCourse={result?.data ?? null} initialOpen={params.new === '1'} />
  </>;
}
