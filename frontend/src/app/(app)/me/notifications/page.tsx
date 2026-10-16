"use client";
import Link from "next/link";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/common/Notice";
import {
  listNotifications,
  setNotificationRead,
  markAllNotificationsRead,
} from "@/lib/api/notification";
import { describeError } from "@/lib/api/client";
import { formatDateTime, isUuid } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
export default function NotificationsPage() {
  const user = useAuthStore((s) => s.user);
  const client = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ["notifications", user?.id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listNotifications(pageParam),
    getNextPageParam: (p) => (p.has_more ? p.next_cursor : undefined),
    enabled: !!user,
  });
  function refresh() {
    client.invalidateQueries({ queryKey: ["notifications"] });
    client.invalidateQueries({ queryKey: ["unread-count"] });
  }
  const read = useMutation({
    mutationFn: (id: string) => setNotificationRead(id, true),
    onSuccess: refresh,
    onError: (e) => toast.error(describeError(e).message),
  });
  const all = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: (r) => {
      refresh();
      toast.success(`已将 ${r.updated} 条通知标为已读`);
    },
    onError: (e) => toast.error(describeError(e).message),
  });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="dn-display text-3xl">通知</h1>
        <Button
          variant="secondary"
          onClick={() => all.mutate()}
          isLoading={all.isPending}
        >
          全部标为已读
        </Button>
      </div>
      {query.error ? (
        <Notice
          tone="warning"
          title="通知加载失败"
          action={<Button onClick={() => query.refetch()}>重试</Button>}
        >
          {describeError(query.error).message}
        </Notice>
      ) : query.isPending ? (
        <p role="status">正在加载通知…</p>
      ) : query.data?.pages.every((p) => !p.items.length) ? (
        <Notice title="还没有通知">
        </Notice>
      ) : (
        <ul className="space-y-3">
          {query.data?.pages
            .flatMap((p) => p.items)
            .map((item) => {
              const req = item.data?.request_id,
                res = item.data?.resource_id;
              const href =
                typeof req === "string" && isUuid(req)
                  ? `/requests/${req}`
                  : typeof res === "string" && isUuid(res)
                    ? `/resources/${res}`
                    : null;
              return (
                <li
                  key={item.id}
                  className="space-y-2 border border-divider p-4"
                >
                  <h2 className="font-medium">
                    {item.title} · {item.is_read ? "已读" : "未读"}
                  </h2>
                  <p className="break-words text-sm">{item.body}</p>
                  <p className="text-xs text-text-secondary">
                    {formatDateTime(item.created_at)}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {href && (
                      <Link
                        className="inline-flex min-h-11 items-center text-brand underline"
                        href={href}
                      >
                        查看详情
                      </Link>
                    )}
                    {!item.is_read && (
                      <Button
                        variant="ghost"
                        onClick={() => read.mutate(item.id)}
                        isLoading={read.isPending && read.variables === item.id}
                      >
                        标为已读
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
        </ul>
      )}
      {query.hasNextPage && (
        <Button
          onClick={() => query.fetchNextPage()}
          isLoading={query.isFetchingNextPage}
        >
          更多通知
        </Button>
      )}
    </div>
  );
}
