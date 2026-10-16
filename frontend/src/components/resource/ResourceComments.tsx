'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { describeError } from '@/lib/api/client';
import { createComment, listComments, moderateComment, withdrawComment, type CommentItem } from '@/lib/api/interaction';
import { formatDateTime } from '@/lib/utils';
import { isAdmin, useAuthStore } from '@/stores/authStore';
import type { CursorPage } from '@/lib/api/types';
import type { InfiniteData } from '@tanstack/react-query';

/**
 * 资源评论（§20.2）。评论与举报、纠错分开建模：这里只承载讨论。
 * 回复使用 parent_id 平铺返回，前端按一层缩进展示，不做无限嵌套。
 */
export function ResourceComments({ resourceId }: { resourceId: string }) {
  const queryClient = useQueryClient();
  const { status, user } = useAuthStore();
  const authed = status === 'authenticated';
  const canWrite = authed && user?.status === 'active';
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [action, setAction] = useState<{ item: CommentItem; kind: 'withdraw' | 'hide' | 'restore' } | null>(null);
  const [reason, setReason] = useState('');
  const queryKey = ['comments', resourceId, user?.id ?? 'guest'];

  const query = useInfiniteQuery({
    queryKey,
    enabled: status !== 'loading',
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listComments(resourceId, pageParam),
    getNextPageParam: (page) => (page.has_more ? page.next_cursor : undefined),
  });

  const mutation = useMutation({
    mutationFn: () => createComment(resourceId, body.trim(), replyTo?.id ?? null),
    onSuccess: () => {
      setBody('');
      setReplyTo(null);
      toast.success('评论已发表');
      queryClient.invalidateQueries({ queryKey: ['comments', resourceId] });
    },
    onError: (error) => {
      toast.error(describeError(error).message);
      queryClient.invalidateQueries({ queryKey: ['comments', resourceId] });
    },
  });

  const management = useMutation({
    mutationFn: async () => {
      if (!action) throw new Error('请选择评论');
      return action.kind === 'withdraw'
        ? withdrawComment(resourceId, action.item.id, action.item.revision)
        : moderateComment(resourceId, action.item.id, action.item.revision, action.kind === 'hide', reason.trim());
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<InfiniteData<CursorPage<CommentItem>>>(queryKey, (data) => data ? {
        ...data, pages: data.pages.map((page) => ({
          ...page, items: page.items.map((item) => item.id === updated.id ? updated : item),
        })),
      } : data);
      setReplyTo(null);
      setAction(null);
      setReason('');
      toast.success('评论状态已更新');
      queryClient.invalidateQueries({ queryKey: ['comments', resourceId] });
    },
    onError: (error) => {
      const described = describeError(error);
      toast.error(described.message);
      if (described.code === 'STALE_REVISION') {
        setAction(null);
        setReason('');
      }
      queryClient.invalidateQueries({ queryKey: ['comments', resourceId] });
    },
  });

  const closeAction = useCallback(() => {
    if (!management.isPending) setAction(null);
  }, [management.isPending]);

  function openAction(item: CommentItem, kind: 'withdraw' | 'hide' | 'restore') {
    setAction({ item, kind });
    setReason('');
  }

  const comments = query.data?.pages.flatMap((page) => page.items) ?? [];
  const names = new Map(comments.map((item) => [item.id, item.display_name]));

  function submit() {
    if (!body.trim()) {
      toast.error('请先填写评论内容');
      return;
    }
    mutation.mutate();
  }

  return (
    <div className="space-y-4">
      {canWrite ? (
        <div className="space-y-2">
          {replyTo && (
            <p className="text-sm text-text-secondary">
              正在回复 {replyTo.display_name}
              <Button variant="ghost" className="ml-2" onClick={() => setReplyTo(null)}>
                取消回复
              </Button>
            </p>
          )}
          <label htmlFor="comment-body" className="block text-sm font-medium text-text-primary">
            {replyTo ? '回复内容' : '发表评论'}
          </label>
          <textarea
            id="comment-body"
            value={body}
            maxLength={2000}
            rows={3}
            onChange={(event) => setBody(event.target.value)}
            className="w-full border border-control-border bg-surface px-3 py-2 text-sm"
          />
          <Button onClick={submit} isLoading={mutation.isPending}>
            {replyTo ? '发表回复' : '发表评论'}
          </Button>
        </div>
      ) : (
        <Notice tone="info" title={authed ? '当前账号不能发表评论' : '登录后可以参与讨论'}>
          {authed ? '请完成邮箱验证或联系管理员。' : <>
          <Link href="/login" className="underline underline-offset-2">
            登录
          </Link>{' '}
          后可以发表评论或回复他人。
          </>}
        </Notice>
      )}

      {query.isPending ? (
        <p role="status" className="text-sm text-text-secondary">
          正在加载评论…
        </p>
      ) : query.error ? (
        <Notice
          tone="warning"
          title="评论暂时无法加载"
          action={<Button variant="secondary" onClick={() => query.refetch()}>重试</Button>}
        >
          {describeError(query.error).message}
        </Notice>
      ) : comments.length === 0 ? (
        <Notice tone="info" title="还没有评论">
          第一条评论可以说明资料是否适用，帮助其他同学判断。
        </Notice>
      ) : (
        <>
          <ul className="space-y-3">
            {comments.map((item) => (
              <li
                key={item.id}
                className={`border border-divider bg-surface p-4 ${item.parent_id ? 'ml-6' : ''}`}
              >
                <p className="text-sm text-text-primary">
                  <Link
                    href={`/creators/${item.user_id}`}
                    className="font-medium underline underline-offset-2"
                  >
                    {item.display_name}
                  </Link>
                  {item.parent_id && names.has(item.parent_id) && (
                    <span className="text-text-secondary">
                      {' '}
                      回复 {names.get(item.parent_id)}
                    </span>
                  )}
                </p>
                <p className="mt-1 whitespace-pre-line break-words text-sm text-text-primary">
                  {item.status === 'withdrawn' ? '该评论已由作者撤回' : item.status === 'hidden' ? '该评论已由管理员隐藏' : item.body}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-secondary">
                  <span>{formatDateTime(item.created_at)}</span>
                  {canWrite && item.status === 'visible' && !item.parent_id && user?.id !== item.user_id && (
                    <button type="button" className="underline underline-offset-2" onClick={() => setReplyTo(item)}>
                      回复
                    </button>
                  )}
                  {canWrite && user?.id === item.user_id && item.status !== 'withdrawn' && (
                    <button type="button" className="min-h-11 underline underline-offset-2" onClick={() => openAction(item, 'withdraw')}>撤回评论</button>
                  )}
                  {canWrite && isAdmin(user) && item.status !== 'withdrawn' && (
                    <button type="button" className="min-h-11 underline underline-offset-2" onClick={() => openAction(item, item.status === 'hidden' ? 'restore' : 'hide')}>
                      {item.status === 'hidden' ? '恢复评论' : '隐藏评论'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {query.hasNextPage && (
            <Button
              variant="secondary"
              isLoading={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              加载更多评论
            </Button>
          )}
        </>
      )}
      <Modal isOpen={!!action} onClose={closeAction}
        title={action?.kind === 'withdraw' ? '撤回评论' : action?.kind === 'hide' ? '隐藏评论' : '恢复评论'}>
        <div className="space-y-4 p-6">
          <p className="text-sm text-text-secondary">{action?.kind === 'withdraw'
            ? '撤回后正文不再展示，已有回复保留。撤回后不能恢复。'
            : '处理会保留评论与回复关系，并记录处理理由。'}</p>
          {action && action.kind !== 'withdraw' && <div>
            <label htmlFor="comment-moderation-reason" className="block text-sm font-medium">处理理由</label>
            <textarea id="comment-moderation-reason" rows={3} maxLength={500} value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-2 w-full border border-control-border bg-surface p-2 text-sm" />
            <p className="mt-1 text-xs text-text-secondary">请简述原因，不要复制敏感正文。</p>
          </div>}
          <div className="flex gap-3">
            <Button onClick={() => management.mutate()} isLoading={management.isPending}
              disabled={!action || (action.kind !== 'withdraw' && !reason.trim())}>确认处理</Button>
            <Button variant="secondary" disabled={management.isPending} onClick={() => setAction(null)}>取消</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
