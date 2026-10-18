"""topics 路由：只做参数解析与服务调用（docs/ARCHITECTURE.md §1）。

本模块为 §33 要求保留的历史专题功能，全部挂在 `/topics/*` 下（前缀由本文件声明，
外层 `/api/v1` 由 app/main.py 统一添加），不占用 `/courses`、`/resources`、`/search`
等主流程路径，也未纳入主导航。

列表接口统一返回 `CursorPage`（items / next_cursor / has_more）。
写操作（提交保研经验、提交转专业案例）要求登录，使用会话依赖 `get_current_user`。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db, get_request_id
from app.core.permissions import RESOURCE_REVIEW, require
from app.core.errors import NotEnabled
from app.core.pagination import CursorPage
from app.modules.topics import service
from app.modules.topics.schemas import (
    BaoyanExperienceCreate,
    BaoyanReviewIn,
    BaoyanExperienceOut,
    BaoyanPolicyOut,
    CompetitionListOut,
    CompetitionOut,
    KaoyanMajorOut,
    KaoyanSchoolOut,
    KaoyanScoreLineOut,
    ScrapedPageOut,
    TransferCaseCreate,
    TransferCaseOut,
    TransferPolicyOut,
)

router = APIRouter(prefix="/topics", tags=["topics"])


@router.get("/admin/baoyan/pending", response_model=list[BaoyanExperienceOut])
async def pending_baoyan(
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    reviewer=Depends(require(RESOURCE_REVIEW)),
):
    return await service.pending_experiences(db, reviewer_id=reviewer.id, limit=limit)


@router.post(
    "/admin/baoyan/{experience_id}/decisions", response_model=BaoyanExperienceOut
)
async def review_baoyan(
    experience_id: uuid.UUID,
    payload: BaoyanReviewIn,
    db: AsyncSession = Depends(get_db),
    reviewer=Depends(require(RESOURCE_REVIEW)),
    request_id: str = Depends(get_request_id),
):
    return await service.review_experience(
        db,
        reviewer=reviewer,
        experience_id=experience_id,
        approve=payload.approve,
        reason=payload.reason,
        request_id=request_id,
    )


# --------------------------------------------------------------------------- #
# 保研
# --------------------------------------------------------------------------- #
@router.get("/baoyan/policies", response_model=CursorPage[BaoyanPolicyOut])
async def list_baoyan_policies(
    college_id: uuid.UUID | None = Query(None),
    year: int | None = Query(None),
    limit: int | None = Query(None, ge=1, le=100),
    cursor: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_policies(
        db, college_id=college_id, year=year, limit=limit, cursor=cursor
    )


@router.get("/baoyan/experiences", response_model=CursorPage[BaoyanExperienceOut])
async def list_baoyan_experiences(
    college_id: uuid.UUID | None = Query(None),
    target_university: str | None = Query(None),
    year: int | None = Query(None),
    limit: int | None = Query(None, ge=1, le=100),
    cursor: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_experiences(
        db,
        college_id=college_id,
        target_university=target_university,
        year=year,
        limit=limit,
        cursor=cursor,
    )


@router.post(
    "/baoyan/experiences",
    response_model=BaoyanExperienceOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_baoyan_experience(
    payload: BaoyanExperienceCreate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_experience(db, user=user, payload=payload)


@router.get("/baoyan/experiences/{experience_id}", response_model=BaoyanExperienceOut)
async def get_baoyan_experience(
    experience_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await service.get_experience(db, experience_id=experience_id)


# --------------------------------------------------------------------------- #
# 竞赛
# --------------------------------------------------------------------------- #
@router.get("/competitions", response_model=CursorPage[CompetitionListOut])
async def list_competitions(
    category: str | None = Query(None),
    limit: int | None = Query(None, ge=1, le=100),
    cursor: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_competitions(db, category=category, limit=limit, cursor=cursor)


@router.get("/competitions/{competition_id}", response_model=CompetitionOut)
async def get_competition(
    competition_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await service.get_competition(db, competition_id=competition_id)


# --------------------------------------------------------------------------- #
# 考研
# --------------------------------------------------------------------------- #
@router.get("/kaoyan/schools", response_model=CursorPage[KaoyanSchoolOut])
async def list_kaoyan_schools(
    limit: int | None = Query(None, ge=1, le=100),
    cursor: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_schools(db, limit=limit, cursor=cursor)


@router.get("/kaoyan/schools/{school_id}/majors", response_model=CursorPage[KaoyanMajorOut])
async def list_kaoyan_majors(
    school_id: uuid.UUID,
    limit: int | None = Query(None, ge=1, le=100),
    cursor: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_majors(db, school_id=school_id, limit=limit, cursor=cursor)


@router.get("/kaoyan/score-lines", response_model=CursorPage[KaoyanScoreLineOut])
async def list_kaoyan_score_lines(
    school_id: uuid.UUID | None = Query(None),
    major_id: uuid.UUID | None = Query(None),
    year: int | None = Query(None),
    limit: int | None = Query(None, ge=1, le=100),
    cursor: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_score_lines(
        db, school_id=school_id, major_id=major_id, year=year, limit=limit, cursor=cursor
    )


# --------------------------------------------------------------------------- #
# 转专业
# --------------------------------------------------------------------------- #
@router.get("/transfer/policies", response_model=CursorPage[TransferPolicyOut])
async def list_transfer_policies(
    year: int | None = Query(None),
    college_id: uuid.UUID | None = Query(None),
    limit: int | None = Query(None, ge=1, le=100),
    cursor: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_transfer_policies(
        db, year=year, college_id=college_id, limit=limit, cursor=cursor
    )


def _require_transfer_review_workflow() -> None:
    # 界面仍为待评估：审核链建成前，不允许遗留接口直接投稿或公开用户内容。
    raise NotEnabled("转专业案例审核流程尚未启用，暂不接受投稿或公开展示")


@router.get(
    "/transfer/cases",
    response_model=CursorPage[TransferCaseOut],
    dependencies=[Depends(_require_transfer_review_workflow)],
)
async def list_transfer_cases(
    limit: int | None = Query(None, ge=1, le=100),
    cursor: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_transfer_cases(db, limit=limit, cursor=cursor)


@router.post(
    "/transfer/cases",
    response_model=TransferCaseOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_require_transfer_review_workflow)],
)
async def create_transfer_case(
    payload: TransferCaseCreate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_transfer_case(db, user=user, payload=payload)


# --------------------------------------------------------------------------- #
# 抓取
# --------------------------------------------------------------------------- #
@router.get("/scraper/latest", response_model=CursorPage[ScrapedPageOut])
async def list_scraper_latest(
    category: str | None = Query(None),
    limit: int | None = Query(None, ge=1, le=100),
    cursor: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_latest_pages(db, category=category, limit=limit, cursor=cursor)
