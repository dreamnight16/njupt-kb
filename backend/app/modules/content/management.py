"""Author workspace and exact-version inspection, separate from public browsing."""

import uuid
from datetime import datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidInput, NotFound
from app.core.pagination import (
    CursorPage,
    decode_cursor,
    encode_cursor,
    normalize_page_size,
)
from app.modules.content import service
from app.modules.content.models import (
    Resource,
    ResourceVersion,
    ResourceTag,
    RightsDeclaration,
    Tag,
)
from app.modules.content.schemas import (
    ManagedResourceOut,
    RightsDeclarationIn,
    VersionDetailOut,
)


async def _assert_workspace_access(db, user, resource, version=None):
    if resource.owner_id == user.id:
        return
    if service._is_manager(user):
        from app.modules.moderation.service import can_review

        if version is None or await can_review(db, user, version.id):
            return
    raise NotFound("资料不存在")


async def list_my_resources(db: AsyncSession, *, user, cursor=None, limit=None):
    size = normalize_page_size(limit)
    stmt = select(Resource).where(Resource.owner_id == user.id)
    if cursor:
        data = decode_cursor(cursor)
        try:
            timestamp, last_id = (
                datetime.fromisoformat(data["ts"]),
                uuid.UUID(data["id"]),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise InvalidInput("cursor 无效") from exc
        stmt = stmt.where(
            or_(
                Resource.updated_at < timestamp,
                and_(Resource.updated_at == timestamp, Resource.id < last_id),
            )
        )
    rows = list(
        (
            await db.execute(
                stmt.order_by(Resource.updated_at.desc(), Resource.id.desc()).limit(
                    size + 1
                )
            )
        ).scalars()
    )
    has_more, rows = len(rows) > size, rows[:size]
    versions = (
        list(
            (
                await db.execute(
                    select(ResourceVersion)
                    .where(ResourceVersion.resource_id.in_([row.id for row in rows]))
                    .order_by(ResourceVersion.version_no.desc())
                )
            ).scalars()
        )
        if rows
        else []
    )
    latest: dict[uuid.UUID, ResourceVersion] = {}
    for version in versions:
        latest.setdefault(version.resource_id, version)
    items = [
        ManagedResourceOut(
            id=row.id,
            course_id=row.course_id,
            publication_status=row.publication_status,
            revision=row.revision,
            latest_version=service._version_out(latest[row.id]),
            updated_at=row.updated_at,
        )
        for row in rows
        if row.id in latest
    ]
    return CursorPage[ManagedResourceOut](
        items=items,
        has_more=has_more,
        next_cursor=(
            encode_cursor(
                {"ts": rows[-1].updated_at.isoformat(), "id": str(rows[-1].id)}
            )
            if has_more
            else None
        ),
    )


async def list_versions(db: AsyncSession, *, user, resource_id: uuid.UUID):
    resource = await service.get_resource(db, resource_id)
    await _assert_workspace_access(db, user, resource)
    versions = (
        await db.execute(
            select(ResourceVersion)
            .where(ResourceVersion.resource_id == resource_id)
            .order_by(ResourceVersion.version_no.desc())
        )
    ).scalars()
    from app.modules.moderation.service import can_review

    result = []
    for version in versions:
        if resource.owner_id == user.id or await can_review(db, user, version.id):
            result.append(service._version_out(version))
    if not result:
        raise NotFound("资料不存在")
    return result


async def get_version_detail(
    db: AsyncSession, *, user, resource_id: uuid.UUID, version_id: uuid.UUID
):
    resource = await service.get_resource(db, resource_id)
    version = await service.get_version(db, version_id)
    if version.resource_id != resource.id:
        raise NotFound("版本不存在")
    await _assert_workspace_access(db, user, resource, version)
    rights = await db.scalar(
        select(RightsDeclaration).where(RightsDeclaration.version_id == version_id)
    )
    tags = list(
        (
            await db.execute(
                select(Tag.name)
                .join(ResourceTag)
                .where(ResourceTag.resource_id == resource_id)
            )
        ).scalars()
    )
    from app.modules.moderation.service import latest_decision_reason

    return VersionDetailOut(
        resource_id=resource.id,
        course_id=resource.course_id,
        resource_type=resource.resource_type,
        publication_status=resource.publication_status,
        resource_revision=resource.revision,
        version=service._version_out(version),
        files=[
            service._file_out(link, file)
            for link, file in await service.version_files(db, version_id)
        ],
        rights=RightsDeclarationIn(
            rights_basis=rights.rights_basis,
            source=rights.source,
            original_author=rights.original_author,
            license=rights.license,
            declaration_text_version=rights.declaration_text_version,
        )
        if rights
        else None,
        tags=tags,
        review_reason=await latest_decision_reason(db, version_id),
        can_edit=resource.owner_id == user.id,
    )
