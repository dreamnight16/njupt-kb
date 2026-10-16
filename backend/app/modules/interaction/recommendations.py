"""P2 规则推荐：先过滤可见性，再以可解释的规则取前 N 条。"""

from __future__ import annotations

import uuid

from sqlalchemy import DateTime, String, Uuid, case, column, exists, false, func, or_, select, table
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.interaction.models import Favorite, Follow, Rating
from app.modules.interaction.schemas import RecommendationItem, RecommendationsOut
from app.modules.interaction.service import (
    RATING_CONFIDENCE_C,
    RATING_PRIOR,
    _course_brief_map,
    _summarize,
)


async def recommend_resources(
    db: AsyncSession, *, user=None, course_id: uuid.UUID | None = None, limit: int = 6,
) -> RecommendationsOut:
    from app.modules.access.visibility import visible_resource_ids

    resources = table(
        "resources", column("id", Uuid), column("course_id", Uuid),
        column("owner_id", Uuid), column("published_version_id", Uuid),
        column("publication_status", String), column("resource_type", String),
        column("freshness_status", String), column("updated_at", DateTime(timezone=True)),
    )
    versions = table(
        "resource_versions", column("id", Uuid), column("resource_id", Uuid),
        column("title", String), column("review_status", String),
    )
    ratings = select(
        Rating.resource_id, func.count(Rating.id).label("rating_count"),
        func.avg(Rating.score).label("average"),
    ).group_by(Rating.resource_id).subquery()
    favorites = select(
        Favorite.resource_id, func.count(Favorite.id).label("favorite_count"),
    ).group_by(Favorite.resource_id).subquery()
    r = resources.c
    count = func.coalesce(ratings.c.rating_count, 0)
    average = func.coalesce(ratings.c.average, 0.0)
    shrunk = (count * average + RATING_CONFIDENCE_C * RATING_PRIOR) / (count + RATING_CONFIDENCE_C)
    favorite_count = func.coalesce(favorites.c.favorite_count, 0)
    course_follow = creator_follow = false()
    if user is not None:
        course_follow = exists(select(Follow.id).where(
            Follow.user_id == user.id, Follow.target_type == "course", Follow.target_id == r.course_id,
        )).correlate(resources)
        creator_follow = exists(select(Follow.id).where(
            Follow.user_id == user.id, Follow.target_type == "creator", Follow.target_id == r.owner_id,
        )).correlate(resources)
    interest = case((or_(course_follow, creator_follow), 1), else_=0)
    freshness = case((r.freshness_status == "current", 0), else_=1)
    query = select(
        r.id, r.course_id, r.resource_type, r.freshness_status, r.published_version_id,
        versions.c.title, count.label("rating_count"), average.label("average"),
        favorite_count.label("favorite_count"),
        course_follow.label("course_follow"), creator_follow.label("creator_follow"),
    ).select_from(
        resources.join(versions, versions.c.id == r.published_version_id)
        .outerjoin(ratings, ratings.c.resource_id == r.id)
        .outerjoin(favorites, favorites.c.resource_id == r.id)
    ).where(
        r.publication_status == "published", versions.c.review_status == "approved",
        versions.c.resource_id == r.id, r.id.in_(visible_resource_ids(user)),
        r.freshness_status != "outdated",
    )
    if course_id is not None:
        query = query.where(r.course_id == course_id)
    ordering = [freshness, shrunk.desc(), favorite_count.desc(), r.updated_at.desc(), r.id]
    if user is not None:
        ordering.insert(0, interest.desc())
    rows = (await db.execute(query.order_by(*ordering).limit(limit))).all()
    courses = await _course_brief_map(db, [row.course_id for row in rows])
    items = []
    for row in rows:
        reasons = []
        if row.course_follow:
            reasons.append("来自你关注的课程")
        if row.creator_follow:
            reasons.append("来自你关注的贡献者")
        if course_id is not None:
            reasons.append("这门课的资料")
        if row.freshness_status == "current":
            reasons.append("现行内容")
        if row.rating_count:
            reasons.append(f"{row.rating_count} 条评价，评分已按样本量收缩")
        if row.favorite_count:
            reasons.append(f"{row.favorite_count} 人收藏")
        if not reasons:
            reasons.append("按更新时间推荐")
        items.append(RecommendationItem(
            resource_id=row.id, course_id=row.course_id, course=courses.get(row.course_id),
            title=row.title, resource_type=row.resource_type, freshness_status=row.freshness_status,
            published_version_id=row.published_version_id,
            rating=_summarize(row.rating_count, float(row.average)), reasons=reasons,
        ))
    return RecommendationsOut(items=items)
