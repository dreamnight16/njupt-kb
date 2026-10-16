"""运营任务工作台路由（设计文档 §27）。

只做参数解析并调用 `service`；前缀由 `app/main.py` 统一加 `/api/v1`。
工作台是管理员操作台：聚合了失败事件/任务，要求 `ops.view`（当前仅管理员拥有，
不自动授予资料审核员）。安全运营视图要求 `audit.view`：与审计记录同级的安全聚合。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, get_current_user
from app.core.enums import AccountStatus, Role
from app.core.pagination import CursorPage
from app.core.permissions import AUDIT_VIEW, METRICS_VIEW, OPS_VIEW, USER_SUSPEND, require
from app.modules.ops import accounts, personal
from app.modules.ops import service
from app.modules.ops.schemas import (
    MetricsOut,
    OpsAlertsOut,
    SecurityOverviewOut,
    WorkbenchOut,
)

if TYPE_CHECKING:  # pragma: no cover
    from app.modules.identity.models import User

router = APIRouter(tags=["ops"])


@router.get("/admin/workbench", response_model=WorkbenchOut)
async def get_workbench(
    user: "User" = Depends(require(OPS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> WorkbenchOut:
    return await service.workbench_summary(db)


@router.get("/admin/alerts", response_model=OpsAlertsOut)
async def get_alerts(
    user: "User" = Depends(require(OPS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> OpsAlertsOut:
    """运营告警：达到阈值的指标才返回，供管理员优先处置（buchong.md）。"""
    return await service.check_ops_alerts(db)


@router.get("/admin/security/overview", response_model=SecurityOverviewOut)
async def get_security_overview(
    user: "User" = Depends(require(AUDIT_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> SecurityOverviewOut:
    """安全运营视图：近 1 小时登录失败 Top、近 24 小时新 IP 登录、近 7 天下载速率告警审计的只读聚合。"""
    return await service.security_overview(db)


@router.get("/admin/metrics", response_model=MetricsOut)
async def get_metrics(
    user: "User" = Depends(require(METRICS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> MetricsOut:
    """只读 SLO 指标：连接池预算、缓存统计、事件/任务积压与慢查询阈值（高并发专项 §13）。"""
    return await service.metrics_summary(db)


@router.get("/me/overview", response_model=personal.PersonalOverview)
async def personal_overview(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await personal.overview(db, user)


@router.get("/me/downloads", response_model=CursorPage[personal.DownloadHistoryItem])
async def download_history(cursor: str | None = None, limit: int | None = Query(None, ge=1, le=100),
    user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await personal.downloads(db, user, cursor=cursor, limit=limit)


@router.get("/me/feed", response_model=CursorPage[personal.FeedItem])
async def following_feed(cursor: str | None = None, limit: int | None = Query(None, ge=1, le=100),
    user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await personal.feed(db, user, cursor=cursor, limit=limit)


@router.get("/admin/users", response_model=CursorPage[accounts.ManagedUser])
async def managed_users(keyword: str | None = Query(None, max_length=120), status: AccountStatus | None = None,
    role: Role | None = None, cursor: str | None = None, limit: int | None = Query(None, ge=1, le=100),
    user=Depends(require(USER_SUSPEND)), db: AsyncSession = Depends(get_db)):
    return await accounts.list_users(db, keyword=keyword, status=status, role=role, cursor=cursor, limit=limit)
