"""运营任务工作台路由（设计文档 §27）。

只做参数解析并调用 `service`；前缀由 `app/main.py` 统一加 `/api/v1`。
工作台是管理员操作台：聚合了失败事件/任务，要求 `job.retry`（当前仅管理员拥有）。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.core.permissions import JOB_RETRY, require
from app.modules.ops import service
from app.modules.ops.schemas import WorkbenchOut

if TYPE_CHECKING:  # pragma: no cover
    from app.modules.identity.models import User

router = APIRouter(tags=["ops"])


@router.get("/admin/workbench", response_model=WorkbenchOut)
async def get_workbench(
    user: "User" = Depends(require(JOB_RETRY)),
    db: AsyncSession = Depends(get_db),
) -> WorkbenchOut:
    return await service.workbench_summary(db)
