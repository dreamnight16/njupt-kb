'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';

import { Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/Button';
import { SkeletonList } from '@/components/ui/Skeleton';
import { describeError } from '@/lib/api/client';
import { getWorkbench } from '@/lib/api/admin';
import { isAdmin, useAuthStore } from '@/stores/authStore';
import { formatDateTime } from '@/lib/utils';

export default function AdminWorkbenchPage() {
  const user = useAuthStore((s) => s.user);
  return isAdmin(user) ? <Workbench /> : <Notice title="需要管理员权限" />;
}

function Workbench() {
  const query = useQuery({
    queryKey: ['admin-workbench'],
    queryFn: getWorkbench,
  });

  if (query.isLoading) {
    return <SkeletonList count={4} />;
  }

  if (query.error) {
    return (
      <Notice
        tone="warning"
        title="工作台暂时无法加载"
        action={
          <Button variant="secondary" onClick={() => query.refetch()}>
            重试
          </Button>
        }
      >
        {describeError(query.error).message}
      </Notice>
    );
  }

  const data = query.data;
  if (!data) {
    return <Notice tone="info" title="暂无待办数据" />;
  }

  const hasPending = data.items.some((item) => item.count > 0);

  return (
    <div className="space-y-6">
      {!hasPending ? (
        <Notice tone="success" title="当前没有待办">
          待审版本、纠错、投诉、求资料与失败任务均为 0。
        </Notice>
      ) : (
        <ul className="dn-stagger grid gap-3 sm:grid-cols-2">
          {data.items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="flex items-center justify-between gap-4 border border-divider bg-surface p-4 hover:bg-canvas"
              >
                <span className="min-w-0">
                  <span className="dn-kicker block text-text-secondary">
                    {item.label}
                  </span>
                  <span className="dn-display mt-1 block text-2xl text-text-primary">
                    {item.count}
                  </span>
                </span>
                <ArrowRight
                  className="h-5 w-5 shrink-0 text-text-secondary"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-text-secondary">
        合计待办 {data.total} 项 · 生成于 {formatDateTime(data.generated_at)}
      </p>
    </div>
  );
}
