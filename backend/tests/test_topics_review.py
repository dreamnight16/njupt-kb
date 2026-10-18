"""Topic submission review and catalog ownership contracts on isolated SQLite."""

import unittest
import uuid
from sqlalchemy import select
import httpx
import test_content_workflow as workflow
from app.core.deps import get_current_user
from app.core.errors import Conflict, Forbidden, InvalidInput, NotFound
from app.db import get_db
from app.main import app
from app.modules.catalog.models import College, Major
from app.modules.moderation.models import AuditLog
from app.modules.notification.models import Notification
from app.modules.topics import service
from app.modules.topics.schemas import BaoyanExperienceCreate


class TopicReviewTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await workflow.ContentWorkflowTests.asyncSetUp(self)
        self.college = College(
            university_id=self.school.id, name="学院", status="active"
        )
        self.db.add(self.college)
        await self.db.flush()
        self.major = Major(
            university_id=self.school.id,
            college_id=self.college.id,
            name="专业",
            status="active",
        )
        self.db.add(self.major)
        await self.db.commit()
        self.payload = BaoyanExperienceCreate(
            college_id=self.college.id,
            major_id=self.major.id,
            target_university="测试院校",
            year=2026,
            advice="准备经验",
        )

    asyncTearDown = workflow.ContentWorkflowTests.asyncTearDown

    async def test_pending_hidden_until_review_and_decision_is_audited_and_notified(
        self,
    ):
        created = await service.create_experience(
            self.db, user=self.owner, payload=self.payload
        )
        self.assertEqual(created.status, "pending")
        with self.assertRaises(NotFound):
            await service.get_experience(self.db, experience_id=created.id)
        public = await service.list_experiences(
            self.db,
            college_id=None,
            target_university=None,
            year=None,
            limit=20,
            cursor=None,
        )
        self.assertEqual(public.items, [])
        self.assertEqual(
            len(await service.pending_experiences(self.db, reviewer_id=self.other.id)),
            1,
        )
        self.assertEqual(
            await service.pending_experiences(self.db, reviewer_id=self.owner.id), []
        )
        result = await service.review_experience(
            self.db,
            reviewer=self.other,
            experience_id=created.id,
            approve=True,
            reason="核验通过",
            request_id="test-review",
        )
        self.assertEqual(result.status, "active")
        self.assertEqual(
            (await service.get_experience(self.db, experience_id=created.id)).id,
            created.id,
        )
        self.assertIsNotNone(
            await self.db.scalar(
                select(AuditLog).where(AuditLog.action == "baoyan_experience.reviewed")
            )
        )
        self.assertIsNotNone(
            await self.db.scalar(
                select(Notification).where(Notification.user_id == self.owner.id)
            )
        )
        with self.assertRaises(Conflict):
            await service.review_experience(
                self.db,
                reviewer=self.other,
                experience_id=created.id,
                approve=False,
                reason="重复操作",
                request_id="repeat",
            )

    async def test_rejection_self_review_and_mismatched_major(self):
        invalid = self.payload.model_copy(update={"college_id": uuid.uuid4()})
        with self.assertRaises(InvalidInput):
            await service.create_experience(self.db, user=self.owner, payload=invalid)
        created = await service.create_experience(
            self.db, user=self.owner, payload=self.payload
        )
        with self.assertRaises(Forbidden):
            await service.review_experience(
                self.db,
                reviewer=self.owner,
                experience_id=created.id,
                approve=True,
                reason="自己通过",
                request_id="self",
            )
        result = await service.review_experience(
            self.db,
            reviewer=self.other,
            experience_id=created.id,
            approve=False,
            reason="缺少来源",
            request_id="reject",
        )
        self.assertEqual(result.status, "rejected")
        with self.assertRaises(NotFound):
            await service.get_experience(self.db, experience_id=created.id)

    async def test_review_endpoints_require_permission(self):
        async def database():
            yield self.db

        async def current():
            return self.other

        app.dependency_overrides[get_db] = database
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
                cookies={"njupt_csrf": "test-csrf"},
                headers={"X-CSRF-Token": "test-csrf"},
            ) as client:
                for method in (client.get, client.post):
                    response = await method("/api/v1/topics/transfer/cases")
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(
                        response.json()["error"]["code"], "FEATURE_NOT_ENABLED"
                    )
                self.assertEqual(
                    (
                        await client.get("/api/v1/topics/admin/baoyan/pending")
                    ).status_code,
                    401,
                )
                app.dependency_overrides[get_current_user] = current
                self.assertEqual(
                    (
                        await client.get("/api/v1/topics/admin/baoyan/pending")
                    ).status_code,
                    403,
                )
                self.other.role = "admin"
                self.assertEqual(
                    (
                        await client.get("/api/v1/topics/admin/baoyan/pending")
                    ).status_code,
                    200,
                )
        finally:
            app.dependency_overrides.clear()
