"""notification 路由：站内通知的未读数、列表与已读操作（§21）。

router 只做解析与调用，业务规则全部在 service.py（docs/ARCHITECTURE.md §1）。
前缀由 main.py 统一添加，模块不得自行决定前缀。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db, get_request_id
from app.core.permissions import JOB_RETRY, require
from app.modules.notification.operations import EventRetry
from app.core.pagination import CursorPage
from app.modules.notification import service
from app.modules.notification.schemas import NotificationItem, ReadAllResult, UnreadCount

router = APIRouter(tags=["notification"])


@router.get("/admin/events")
async def failed_events(cursor: str | None = None, limit: int = Query(20, ge=1, le=100),
    user=Depends(require(JOB_RETRY)), db: AsyncSession = Depends(get_db)):
    from app.modules.notification.operations import list_events
    return await list_events(db, cursor=cursor, limit=limit)


@router.post("/admin/events/{event_id}/retry")
async def retry_event(event_id: uuid.UUID, payload: EventRetry, user=Depends(require(JOB_RETRY)),
    db: AsyncSession = Depends(get_db), trace=Depends(get_request_id)):
    from app.modules.notification.operations import retry_event
    return await retry_event(db, event_id=event_id, expected_attempts=payload.expected_attempts, user=user, trace=trace)


@router.get("/notifications", response_model=CursorPage[NotificationItem])
async def list_notifications(
    cursor: str | None = None,
    limit: int | None = Query(default=None, ge=1, le=100),
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CursorPage[NotificationItem]:
    return await service.list_notifications(
        db, user_id=user.id, cursor=cursor, limit=limit
    )


@router.get("/notifications/unread-count", response_model=UnreadCount)
async def unread_count(
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UnreadCount:
    return await service.unread_count(db, user_id=user.id)


@router.patch("/notifications/{notification_id}", response_model=NotificationItem)
async def mark_read(
    notification_id: uuid.UUID,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationItem:
    return await service.mark_read(db, user_id=user.id, notification_id=notification_id)


@router.post("/notifications/read-all", response_model=ReadAllResult)
async def mark_all_read(
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReadAllResult:
    return await service.mark_all_read(db, user_id=user.id)
