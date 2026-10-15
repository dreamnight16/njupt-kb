'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SkeletonList } from '@/components/ui/Skeleton';
import {
  appendReportEvent,
  listReportEvents,
  listReports,
  type ReportEventOut,
} from '@/lib/api/admin';
import { ApiError, describeError } from '@/lib/api/client';
import {
  REPORT_REASON_LABELS,
  type ReportOut,
  type ReportReasonCode,
} from '@/lib/api/moderation';
import type { ReportStatus } from '@/lib/api/types';
import { formatDateTime } from '@/lib/utils';

/** §18 工单状态流转，与服务端 REPORT_TRANSITIONS 一致；服务端仍是最终判定。 */
const REPORT_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  open: ['triaged', 'investigating', 'dismissed'],
  triaged: ['investigating', 'resolved', 'dismissed'],
  investigating: ['resolved', 'dismissed'],
  resolved: ['appealed'],
  dismissed: ['appealed'],
  appealed: ['triaged', 'investigating', 'resolved', 'dismissed'],
};

const reportStatusLabels: Record<ReportStatus, string> = {
  open: '待处理',
  triaged: '已分类',
  investigating: '调查中',
  resolved: '已解决',
  dismissed: '已驳回',
  appealed: '申诉中',
};

const reportStatusTones: Record<ReportStatus, string> = {
  open: 'bg-amber text-on-color',
  triaged: 'bg-steel text-on-color',
  investigating: 'bg-cyan text-on-color',
  resolved: 'bg-emerald text-on-color',
  dismissed: 'bg-crimson text-on-color',
  appealed: 'bg-violet text-on-color',
};

type StatusFilter = 'open' | 'all';

export default function AdminReportsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<StatusFilter>('open');
  const [active, setActive] = useState<ReportOut | null>(null);

  const listQuery = useQuery({
    queryKey: ['admin-reports', filter],
    queryFn: () =>
      listReports({ status: filter === 'all' ? undefined : ['open'], limit: 20 }),
  });

  function openReport(report: ReportOut) {
    setActive(report);
    queryClient.invalidateQueries({ queryKey: ['admin-report-events', report.id] });
  }

  const count = listQuery.data?.items.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['open', '待处理'],
            ['all', '全部'],
          ] as [StatusFilter, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`inline-flex min-h-11 items-center px-3 text-sm font-medium ${
              filter === value
                ? 'bg-brand text-on-color'
                : 'border border-control-border text-text-primary hover:bg-canvas'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {listQuery.isLoading ? (
        <SkeletonList count={3} />
      ) : listQuery.error ? (
        <Notice
          tone="warning"
          title="投诉工单暂时无法加载"
          action={<Button variant="secondary" onClick={() => listQuery.refetch()}>重试</Button>}
        >
          {describeError(listQuery.error).message}
        </Notice>
      ) : count > 0 ? (
        <ul className="space-y-3">
          {listQuery.data?.items.map((report) => (
            <li key={report.id} className="border border-divider bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-text-primary">
                    {REPORT_REASON_LABELS[report.reason_code as ReportReasonCode] ??
                      report.reason_code}
                    <span
                      className={`ml-2 px-2 py-0.5 text-xs font-semibold ${
                        reportStatusTones[report.status as ReportStatus] ?? 'bg-steel text-on-color'
                      }`}
                    >
                      {reportStatusLabels[report.status as ReportStatus] ?? report.status}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    资源 {report.resource_id.slice(0, 8)}… · 提交于{' '}
                    {formatDateTime(report.created_at)}
                  </p>
                  {report.description && (
                    <p className="mt-2 text-sm text-text-secondary">{report.description}</p>
                  )}
                </div>
                <Button variant="primary" onClick={() => openReport(report)}>
                  处理
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Notice tone="info" title="当前没有待处理投诉">
          新的举报会进入独立工单；未经核实的举报不会直接影响创作者收益。
        </Notice>
      )}

      {active && (
        <ReportModal
          report={active}
          onClose={() => setActive(null)}
          onChanged={() => {
            queryClient.invalidateQueries({ queryKey: ['admin-reports'] });
            queryClient.invalidateQueries({ queryKey: ['admin-moderation-summary'] });
          }}
        />
      )}
    </div>
  );
}

function ReportModal({
  report,
  onClose,
  onChanged,
}: {
  report: ReportOut;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [toStatus, setToStatus] = useState<ReportStatus | ''>('');
  const [note, setNote] = useState('');
  const [interimAction, setInterimAction] = useState<'none' | 'restrict_access' | 'release_access'>(
    'none',
  );

  const eventsQuery = useQuery({
    queryKey: ['admin-report-events', report.id],
    queryFn: () => listReportEvents(report.id),
  });

  const options = REPORT_TRANSITIONS[report.status as ReportStatus] ?? [];

  const eventMutation = useMutation({
    mutationFn: () =>
      appendReportEvent(report.id, {
        to_status: toStatus as ReportStatus,
        note: note.trim() || undefined,
        interim_action: interimAction,
      }),
    onSuccess: () => {
      toast.success('工单状态已更新');
      setToStatus('');
      setNote('');
      setInterimAction('none');
      onChanged();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        toast.error('工单状态已被其他操作改变，请刷新后重试。');
        onChanged();
        return;
      }
      toast.error(describeError(error).message);
    },
  });

  return (
    <Modal isOpen onClose={onClose} title={`投诉工单 · ${report.id.slice(0, 8)}…`}>
      <div className="space-y-5">
        <section className="space-y-1 text-sm">
          <p className="text-text-primary">
            {REPORT_REASON_LABELS[report.reason_code as ReportReasonCode] ?? report.reason_code}
          </p>
          <p className="text-text-secondary">
            状态：
            {reportStatusLabels[report.status as ReportStatus] ?? report.status} · 提交于{' '}
            {formatDateTime(report.created_at)}
          </p>
          <p className="text-text-secondary">
            资源：
            <Link
              href={`/resources/${report.resource_id}`}
              className="underline underline-offset-2 hover:text-text-primary"
            >
              {report.resource_id}
            </Link>
          </p>
          {report.description && <p className="text-text-secondary">{report.description}</p>}
        </section>

        <section aria-labelledby="report-events">
          <h3 id="report-events" className="text-sm font-semibold text-text-primary">
            处理记录
          </h3>
          {eventsQuery.isLoading ? (
            <SkeletonList count={2} />
          ) : eventsQuery.error ? (
            <p className="mt-2 text-sm text-text-secondary">
              处理记录暂时无法加载：{describeError(eventsQuery.error).message}
            </p>
          ) : eventsQuery.data && eventsQuery.data.items.length > 0 ? (
            <ol className="mt-2 space-y-2">
              {eventsQuery.data.items.map((event: ReportEventOut) => (
                <li key={event.id} className="border border-divider bg-surface p-3 text-sm">
                  <p className="text-text-primary">
                    {reportStatusLabels[event.from_status ?? 'open'] ?? event.from_status ?? '提交'}
                    {' → '}
                    {reportStatusLabels[event.to_status]}
                  </p>
                  {event.note && <p className="mt-1 text-text-secondary">{event.note}</p>}
                  {event.evidence?.interim_note ? (
                    <p className="mt-1 text-xs text-text-secondary">
                      临时措施：{String(event.evidence.interim_note)}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-text-secondary">
                    {formatDateTime(event.created_at)}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-text-secondary">还没有处理记录。</p>
          )}
        </section>

        {options.length > 0 ? (
          <form
            className="space-y-3 border-t border-divider pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!toStatus) {
                toast.error('请选择目标状态');
                return;
              }
              eventMutation.mutate();
            }}
          >
            <p className="text-sm text-text-secondary">
              临时措施只降低可见性，与最终认定分开记录（§18）。
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-text-primary">
                流转到
                <select
                  value={toStatus}
                  onChange={(event) => setToStatus(event.target.value as ReportStatus)}
                  className="mt-1 min-h-11 w-full border border-control-border bg-surface px-3 text-sm text-text-primary focus:border-brand focus:outline-2 focus:outline-offset-1 focus:outline-focus"
                >
                  <option value="">请选择</option>
                  {options.map((status) => (
                    <option key={status} value={status}>
                      {reportStatusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-text-primary">
                临时措施
                <select
                  value={interimAction}
                  onChange={(event) =>
                    setInterimAction(event.target.value as typeof interimAction)
                  }
                  className="mt-1 min-h-11 w-full border border-control-border bg-surface px-3 text-sm text-text-primary focus:border-brand focus:outline-2 focus:outline-offset-1 focus:outline-focus"
                >
                  <option value="none">无</option>
                  <option value="restrict_access">临时限制访问</option>
                  <option value="release_access">解除临时限制</option>
                </select>
              </label>
            </div>
            <label className="block text-sm font-medium text-text-primary">
              处理说明（建议填写）
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={2000}
                className="mt-1 w-full border border-control-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-2 focus:outline-offset-1 focus:outline-focus"
                placeholder="记录判断依据；举报人会收到处理结果通知。"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                关闭
              </Button>
              <Button type="submit" isLoading={eventMutation.isPending}>
                提交处理
              </Button>
            </div>
          </form>
        ) : (
          <Notice tone="info" title="当前状态没有可用的流转">
            终态工单只能进入申诉流程，由后续处理重新打开。
          </Notice>
        )}
      </div>
    </Modal>
  );
}
