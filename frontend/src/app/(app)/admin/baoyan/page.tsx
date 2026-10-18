'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/common/Notice';
import { SkeletonList } from '@/components/ui/Skeleton';
import { describeError } from '@/lib/api/client';
import { listColleges, listMajors, listPendingExperiences, reviewExperience } from '@/lib/api/topics';
import { hasPermission, useAuthStore } from '@/stores/authStore';

export default function BaoyanReviewPage() {
  const client = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const canReview = hasPermission(user, 'resource.review');
  const query = useQuery({ queryKey: ['pending-experiences', user?.id], queryFn: listPendingExperiences, enabled: canReview });
  const colleges = useQuery({ queryKey: ['colleges'], queryFn: listColleges });
  const majors = useQuery({ queryKey: ['majors', 'all'], queryFn: () => listMajors() });
  const review = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => reviewExperience(id, approve, reasons[id]?.trim() || ''),
    onSuccess: () => {
      toast.success('审核结果已保存');
      void client.invalidateQueries({ queryKey: ['pending-experiences'] });
    },
    onError: (error) => toast.error(describeError(error).message),
  });
  if (!canReview) return <Notice tone="warning" title="需要审核权限">请使用具有内容审核权限的账号访问。</Notice>;
  return <section className="space-y-4">
    <h2 className="dn-display text-2xl">保研经验审核</h2>
    <p className="text-sm text-text-secondary">请核对内容来源，并检查是否含有个人信息。</p>
    {query.isLoading ? <SkeletonList /> : query.isError ? <Notice tone="error" title="审核队列无法加载">{describeError(query.error).message}<Button variant="secondary" onClick={() => void query.refetch()}>重试</Button></Notice> : query.data?.length === 0 ? <Notice title="没有待审经验帖" /> : <ul className="space-y-4">
      {query.data?.map((item) => <li key={item.id} className="space-y-3 border border-divider bg-surface p-4">
        <h3 className="font-semibold">{item.year} · {item.target_university}</h3>
        <p className="text-sm text-text-secondary">{colleges.data?.find((row) => row.id === item.college_id)?.name ?? item.college_id} · {majors.data?.find((row) => row.id === item.major_id)?.name ?? item.major_id}</p>
        <p className="text-sm text-text-secondary">{[item.target_college, item.target_major, item.offer_result, item.gpa_rank].filter(Boolean).join(' · ')}</p>
        <p className="text-sm text-text-secondary">原专业：{item.original_major || '未填写'} · GPA：{item.gpa ?? '未填写'}</p>
        {([
          ['夏令营经历', item.summer_camp_experience], ['面试经历', item.pre_interview_experience],
          ['面试问题', item.interview_questions ? JSON.stringify(item.interview_questions) : null],
          ['时间线', item.timeline ? JSON.stringify(item.timeline) : null], ['建议', item.advice],
          ['标签', item.tags ? JSON.stringify(item.tags) : null],
        ] as const).map(([label, text]) => text && <div key={label}><h4 className="text-sm font-medium">{label}</h4><p className="whitespace-pre-wrap break-words text-sm">{text}</p></div>)}
        <label className="block text-sm">审核理由
          <textarea value={reasons[item.id] ?? ''} maxLength={500} rows={2} onChange={(event) => setReasons({ ...reasons, [item.id]: event.target.value })} className="mt-1 w-full border border-control-border px-3 py-2" />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button disabled={review.isPending || !reasons[item.id]?.trim() || user?.id === item.author_id} onClick={() => review.mutate({ id: item.id, approve: true })}>通过并公开</Button>
          <Button variant="danger" disabled={review.isPending || !reasons[item.id]?.trim() || user?.id === item.author_id} onClick={() => review.mutate({ id: item.id, approve: false })}>拒绝</Button>
        </div>
      </li>)}
    </ul>}
  </section>;
}
