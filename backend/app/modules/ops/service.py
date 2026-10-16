"""运营任务工作台服务（设计文档 §27）。

聚合当前待办数量，供管理员一次请求拿到全部跳转入口。只读聚合，不写库、不加缓存、
不建定时任务；每个指标用一条 COUNT 聚合，避免逐条 N+1 查询（§27、§29）。

跨模块只读取其它模块拥有的表：模型类在函数体内局部导入，不在模块顶层导入
（docs/ARCHITECTURE.md §2）。本模块不新增 domain event 类型。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.modules.ops.schemas import OpsAlertOut, OpsAlertsOut, WorkbenchItem, WorkbenchOut


async def _count(db: AsyncSession, model, *conditions) -> int:
    stmt = select(func.count()).select_from(model)
    for condition in conditions:
        stmt = stmt.where(condition)
    return int(await db.scalar(stmt) or 0)


async def workbench_summary(db: AsyncSession) -> WorkbenchOut:
    """一次请求内聚合全部待办计数；每条指标一次 COUNT，无逐条查询。"""
    from app.core.enums import (
        CorrectionStatus,
        JobStatus,
        ReportStatus,
        RequestStatus,
        ReviewStatus,
    )
    from app.modules.interaction.models import Correction, ResourceRequest
    from app.modules.jobs.models import Job
    from app.modules.moderation.models import Report, Review
    from app.modules.notification.models import DomainEvent, DomainEventStatus

    # “未处理投诉/举报”指尚未终结（未 resolved / dismissed）的工单（§18）。
    open_report_statuses = [
        ReportStatus.OPEN.value,
        ReportStatus.TRIAGED.value,
        ReportStatus.INVESTIGATING.value,
        ReportStatus.APPEALED.value,
    ]

    pending_reviews = await _count(
        db, Review, Review.status == ReviewStatus.PENDING.value
    )
    open_corrections = await _count(
        db, Correction, Correction.status == CorrectionStatus.OPEN.value
    )
    open_reports = await _count(db, Report, Report.status.in_(open_report_statuses))
    open_requests = await _count(
        db, ResourceRequest, ResourceRequest.status == RequestStatus.OPEN.value
    )
    failed_events = await _count(
        db, DomainEvent, DomainEvent.status == DomainEventStatus.FAILED.value
    )
    failed_jobs = await _count(db, Job, Job.status == JobStatus.FAILED.value)

    items = [
        WorkbenchItem(
            key="pending_reviews",
            label="待审资料版本",
            count=pending_reviews,
            href="/admin/reviews",
        ),
        WorkbenchItem(
            key="open_corrections",
            label="未处理纠错",
            count=open_corrections,
            href="/admin/corrections",
        ),
        WorkbenchItem(
            key="open_reports",
            label="未处理投诉/举报",
            count=open_reports,
            href="/admin/reports",
        ),
        WorkbenchItem(
            key="open_requests",
            label="开放中的求资料需求",
            count=open_requests,
            href="/requests",
        ),
        WorkbenchItem(
            key="failed_tasks",
            label="失败的异步事件/任务",
            count=failed_events + failed_jobs,
            href="/admin/workbench#failed-queues",
        ),
    ]
    return WorkbenchOut(
        items=items,
        total=sum(item.count for item in items),
        generated_at=datetime.now(timezone.utc),
    )


async def check_ops_alerts(db: AsyncSession) -> OpsAlertsOut:
    """只读聚合运营告警：达到阈值的指标才返回，供管理员优先处置（buchong.md）。

    不写库、不加缓存、不自动处置；每条指标一次 COUNT。阈值来自 settings（可调默认值）。
    告警只展示，不触发封禁/清理/回滚等副作用。
    """
    from app.core.enums import (
        CorrectionStatus,
        JobStatus,
        ReportStatus,
        RequestStatus,
        ReviewStatus,
    )
    from app.modules.interaction.models import Correction, ResourceRequest
    from app.modules.jobs.models import Job
    from app.modules.moderation.models import Report, Review
    from app.modules.notification.models import DomainEvent, DomainEventStatus

    # 与工作台一致的口径：未处理举报含 OPEN/TRIAGED/INVESTIGATING/APPEALED（§18）。
    open_report_statuses = [
        ReportStatus.OPEN.value,
        ReportStatus.TRIAGED.value,
        ReportStatus.INVESTIGATING.value,
        ReportStatus.APPEALED.value,
    ]

    pending_reviews = await _count(db, Review, Review.status == ReviewStatus.PENDING.value)
    open_corrections = await _count(
        db, Correction, Correction.status == CorrectionStatus.OPEN.value
    )
    open_reports = await _count(db, Report, Report.status.in_(open_report_statuses))
    open_requests = await _count(
        db, ResourceRequest, ResourceRequest.status == RequestStatus.OPEN.value
    )
    failed_events = await _count(
        db, DomainEvent, DomainEvent.status == DomainEventStatus.FAILED.value
    )
    failed_jobs = await _count(db, Job, Job.status == JobStatus.FAILED.value)

    # (key, label, count, href, warn_threshold)
    metrics = [
        ("open_reports", "未处理举报积压", open_reports, "/admin/reports", settings.OPS_ALERT_OPEN_REPORTS),
        ("pending_reviews", "待审资料版本积压", pending_reviews, "/admin/reviews", settings.OPS_ALERT_PENDING_REVIEWS),
        ("open_corrections", "未处理纠错积压", open_corrections, "/admin/corrections", settings.OPS_ALERT_OPEN_CORRECTIONS),
        ("open_requests", "开放求资料需求积压", open_requests, "/requests", settings.OPS_ALERT_OPEN_REQUESTS),
        ("failed_jobs", "失败异步任务积压", failed_jobs, "/admin/workbench#failed-queues", settings.OPS_ALERT_FAILED_JOBS),
        ("failed_events", "失败领域事件积压", failed_events, "/admin/workbench#failed-queues", settings.OPS_ALERT_FAILED_EVENTS),
    ]

    critical_mult = max(1, settings.OPS_ALERT_CRITICAL_MULTIPLIER)
    alerts: list[OpsAlertOut] = []
    for key, label, count, href, threshold in metrics:
        if threshold <= 0 or count < threshold:
            continue
        level = "critical" if count >= threshold * critical_mult else "warning"
        alerts.append(
            OpsAlertOut(
                key=key,
                label=label,
                count=count,
                href=href,
                level=level,
                threshold=threshold,
            )
        )

    # critical 优先，其次按计数降序，便于管理员聚焦最紧急项。
    alerts.sort(key=lambda a: (a.level != "critical", -a.count))
    return OpsAlertsOut(
        alerts=alerts,
        has_critical=any(a.level == "critical" for a in alerts),
        generated_at=datetime.now(timezone.utc),
    )
