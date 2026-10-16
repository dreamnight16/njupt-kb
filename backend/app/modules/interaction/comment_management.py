"""评论治理：保留正文和回复关系，对外序列化时遮蔽正文。"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import record_audit
from app.core.enums import AccountStatus
from app.core.errors import Conflict, Forbidden, InvalidInput, NotFound
from app.core.permissions import COMMENT_MODERATE, has_permission
from app.modules.interaction.models import Comment
from app.modules.interaction.schemas import CommentItem
from app.modules.interaction.service import _comment_items, assert_comment_resource, comment_status


async def list_managed_comments(db, *, hidden_only, cursor, limit):
    from sqlalchemy import Uuid, column, table
    from app.core.pagination import CursorPage, encode_cursor, normalize_page_size
    from app.modules.interaction.service import _decode_time_cursor
    resources = table("resources", column("id", Uuid), column("publication_status"))
    stmt = select(Comment).where(Comment.resource_id.in_(select(resources.c.id).where(resources.c.publication_status == "published")))
    if hidden_only:
        stmt = stmt.where(Comment.is_hidden.is_(True), Comment.withdrawn_at.is_(None))
    decoded = _decode_time_cursor(cursor)
    if decoded:
        t, i = decoded
        stmt = stmt.where((Comment.created_at < t) | ((Comment.created_at == t) & (Comment.id < i)))
    size = normalize_page_size(limit)
    rows = list((await db.scalars(stmt.order_by(Comment.created_at.desc(), Comment.id.desc()).limit(size + 1))).all())
    more = len(rows) > size
    rows = rows[:size]
    return CursorPage(items=await _comment_items(db, rows), has_more=more,
                      next_cursor=encode_cursor({"t": rows[-1].created_at.isoformat(), "i": str(rows[-1].id)}) if more else None)


async def manage_comment(
    db: AsyncSession, *, user, resource_id: uuid.UUID, comment_id: uuid.UUID,
    expected_revision: int, hidden: bool | None = None, reason: str | None = None,
    request_id: str | None = None,
) -> CommentItem:
    """hidden=None 表示作者撤回；布尔值表示管理员设置隐藏状态。"""
    if user.status != AccountStatus.ACTIVE:
        raise Forbidden("当前账号不能执行此操作")
    if hidden is not None and not has_permission(user, COMMENT_MODERATE):
        raise Forbidden("需要评论管理权限")
    if hidden is not None:
        reason = (reason or "").strip()
        if not reason or len(reason) > 500:
            raise InvalidInput("处理理由须为 1–500 字")
    await assert_comment_resource(db, resource_id=resource_id, user=user)
    # 回复、撤回、隐藏共用父评论行锁，避免隐藏提交后仍新增回复。
    comment = await db.scalar(
        select(Comment).where(Comment.id == comment_id, Comment.resource_id == resource_id)
        .with_for_update().execution_options(populate_existing=True)
    )
    if comment is None:
        raise NotFound("评论不存在")
    if hidden is None and comment.user_id != user.id:
        raise Forbidden("只能撤回自己的评论")
    if hidden is not None and comment.withdrawn_at is not None:
        raise Conflict("作者已撤回评论，不能隐藏或恢复")
    unchanged = comment.withdrawn_at is not None if hidden is None else comment.is_hidden == hidden
    if unchanged:
        return (await _comment_items(db, [comment]))[0]
    if comment.revision != expected_revision:
        raise Conflict("评论状态已变化，请刷新后重试", code="STALE_REVISION")
    before = {"status": comment_status(comment), "revision": comment.revision}
    if hidden is None:
        comment.withdrawn_at = datetime.now(timezone.utc)
        action = "comment.withdrawn"
    else:
        comment.is_hidden = hidden
        action = "comment.hidden" if hidden else "comment.restored"
    comment.revision += 1
    await record_audit(
        db, action=action, object_type="comment", object_id=comment.id,
        object_version=comment.revision, actor_id=user.id, before=before,
        after={"status": comment_status(comment), "revision": comment.revision},
        reason=reason, request_id=request_id,
    )
    await db.flush()
    return (await _comment_items(db, [comment]))[0]
