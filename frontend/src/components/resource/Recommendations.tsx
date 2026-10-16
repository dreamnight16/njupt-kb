import { Notice } from '@/components/common/Notice';
import { ResourceCard } from '@/components/resource/ResourceCard';
import type { RecommendationsOut } from '@/lib/api/interaction';
import { serverFetch } from '@/lib/api/server';

export async function Recommendations({ courseId }: { courseId?: string }) {
  const result = await serverFetch<RecommendationsOut>(
    `/recommendations?limit=6${courseId ? `&course_id=${courseId}` : ''}`,
  );
  return (
    <section aria-label={courseId ? '这门课值得看看' : '值得看看'}>
      <h2 className="dn-display text-2xl">{courseId ? '这门课值得看看' : '值得看看'}</h2>
      <p className="mt-2 text-sm text-text-secondary">
        优先关注的课程与贡献者，再参考时效、评价、收藏和更新时间；其中保留一个新内容探索位。
      </p>
      <div className="mt-4">
        {result.error ? (
          <Notice tone="warning" title="推荐暂时无法加载">可以继续浏览课程或搜索资料。</Notice>
        ) : result.data && result.data.items.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2">
            {result.data.items.map((item) => (
              <li key={item.resource_id}>
                <ResourceCard resourceId={item.resource_id} title={item.title}
                  resourceType={item.resource_type} courseName={item.course?.name}
                  courseCode={item.course?.code} freshness={item.freshness_status} rating={item.rating} />
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                  {item.explore && (
                    <span className="border border-control-border px-1.5 py-0.5 text-[0.6875rem] font-semibold text-text-primary">
                      探索位
                    </span>
                  )}
                  <span>{item.reasons.join(' · ')}</span>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <Notice tone="info" title="暂时没有可推荐的资料">可以继续浏览课程或搜索资料。</Notice>
        )}
      </div>
    </section>
  );
}
