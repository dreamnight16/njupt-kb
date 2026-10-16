"use client";
import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/common/Notice";
import { api, describeError } from "@/lib/api/client";
import type { CursorPage } from "@/lib/api/types";
import type { CommentItem } from "@/lib/api/interaction";
import { isAdmin, useAuthStore } from "@/stores/authStore";
export default function Page() {
  const user = useAuthStore((s) => s.user);
  return isAdmin(user) ? <Queue /> : <Notice title="需要管理员权限" />;
}
function Queue() {
  const user = useAuthStore((s) => s.user);

  const [hidden, setHidden] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ["admin-comments", hidden, user?.id],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<CursorPage<CommentItem>>("/admin/comments", {
          params: { hidden_only: hidden, cursor: pageParam || undefined },
        })
      ).data,
    getNextPageParam: (p) => (p.has_more ? p.next_cursor : undefined),
    enabled: isAdmin(user),
  });
  return (
    <div className="space-y-4">
      <h2 className="dn-display text-2xl">评论管理</h2>
      <p className="text-sm text-text-secondary">
        已发布资料的评论；撤回和隐藏正文继续遮蔽，处理请进入资料讨论区。
      </p>
      <Button variant="secondary" onClick={() => setHidden(!hidden)}>
        {hidden ? "查看全部评论" : "只看已隐藏"}
      </Button>
      {query.error ? (
        <Notice
          tone="warning"
          title="列表加载失败"
          action={<Button onClick={() => query.refetch()}>重试</Button>}
        >
          {describeError(query.error).message}
        </Notice>
      ) : query.isPending ? (
        <p role="status">正在加载…</p>
      ) : query.data?.pages.every((p) => !p.items.length) ? (
        <Notice title="没有符合条件的评论" />
      ) : (
        <ul className="space-y-3">
          {query.data?.pages
            .flatMap((p) => p.items)
            .map((item) => (
              <li key={item.id} className="space-y-2 border border-divider p-4">
                <p className="text-sm">
                  {item.display_name} ·{" "}
                  {item.status === "withdrawn"
                    ? "已撤回"
                    : item.status === "hidden"
                      ? "已隐藏"
                      : "正常"}
                </p>
                <p className="break-words text-sm">
                  {item.body ?? "正文已遮蔽"}
                </p>
                <Link
                  className="inline-flex min-h-11 items-center text-brand underline"
                  href={`/resources/${item.resource_id}#resource-comments`}
                >
                  查看讨论并处理
                </Link>
              </li>
            ))}
        </ul>
      )}
      {query.hasNextPage && (
        <Button
          onClick={() => query.fetchNextPage()}
          isLoading={query.isFetchingNextPage}
        >
          更多评论
        </Button>
      )}
    </div>
  );
}
