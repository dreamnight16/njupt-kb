"""0.0.3 注册图形验证码与「注册即可用」流程测试（隔离 SQLite）。

只验证本地可执行的业务逻辑：渲染产物、一次性校验、错误次数与过期、
注册防刷接线，以及 MAIL_ENABLED=false 时注册直接激活可登录。
"""

import base64
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from sqlalchemy import select

import test_content_workflow as workflow
from app.config import settings
from app.core.errors import InvalidInput, RateLimited
from app.core.security import token_digest
from app.modules.identity import service as identity_service
from app.modules.identity.models import CaptchaChallenge, User, UserIdentity


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _seed_challenge(self, *, code: str = "AB3D", expires_in: int = 5, attempts: int = 0):
    row = CaptchaChallenge(
        purpose="register",
        code_hash=token_digest(code),
        expires_at=_now() + timedelta(minutes=expires_in),
        attempts=attempts,
    )
    self.db.add(row)
    await self.db.flush()
    return row


class CaptchaServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await workflow.ContentWorkflowTests.asyncSetUp(self)

    asyncTearDown = workflow.ContentWorkflowTests.asyncTearDown

    async def test_create_captcha_renders_png_and_stores_digest(self):
        captcha_id, data_url = await identity_service.create_captcha(
            self.db, purpose="register", client_ip=None
        )
        self.assertTrue(data_url.startswith("data:image/png;base64,"))
        raw = base64.b64decode(data_url.split(",", 1)[1])
        self.assertTrue(raw.startswith(b"\x89PNG"))

        row = await self.db.get(CaptchaChallenge, captcha_id)
        self.assertIsNotNone(row)
        self.assertEqual(row.consumed_at, None)
        self.assertEqual(row.attempts, 0)
        self.assertEqual(len(row.code_hash), 64)

    async def test_verify_accepts_then_rejects_reuse(self):
        row = await _seed_challenge(self, code="AB3D")
        self.assertTrue(
            await identity_service.verify_captcha(
                self.db, captcha_id=str(row.id), code="ab3d", client_ip=None
            )
        )
        # 一次性：已消费的码第二次校验必须失败。
        self.assertFalse(
            await identity_service.verify_captcha(
                self.db, captcha_id=str(row.id), code="AB3D", client_ip=None
            )
        )

    async def test_verify_wrong_code_counts_attempts_then_succeeds(self):
        row = await _seed_challenge(self, code="AB3D")
        self.assertFalse(
            await identity_service.verify_captcha(
                self.db, captcha_id=str(row.id), code="XXXX", client_ip=None
            )
        )
        self.assertEqual(row.attempts, 1)
        # 未超过阈值时，正确答案仍可通过。
        self.assertTrue(
            await identity_service.verify_captcha(
                self.db, captcha_id=str(row.id), code="AB3D", client_ip=None
            )
        )

    async def test_verify_invalidates_after_too_many_attempts(self):
        row = await _seed_challenge(
            self, code="AB3D", attempts=settings.CAPTCHA_MAX_ATTEMPTS
        )
        self.assertFalse(
            await identity_service.verify_captcha(
                self.db, captcha_id=str(row.id), code="AB3D", client_ip=None
            )
        )
        # 超限即作废：即便给出正确答案也不再通过。
        self.assertIsNotNone(row.consumed_at)

    async def test_verify_rejects_expired(self):
        row = await _seed_challenge(self, code="AB3D", expires_in=-1)
        self.assertFalse(
            await identity_service.verify_captcha(
                self.db, captcha_id=str(row.id), code="AB3D", client_ip=None
            )
        )

    async def test_verify_rejects_malformed_id(self):
        self.assertFalse(
            await identity_service.verify_captcha(
                self.db, captcha_id="not-a-uuid", code="AB3D", client_ip=None
            )
        )


class RegisterCaptchaTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await workflow.ContentWorkflowTests.asyncSetUp(self)

    asyncTearDown = workflow.ContentWorkflowTests.asyncTearDown

    async def _register(self, **kwargs):
        payload = {
            "email": "captcha-user@example.test",
            "password": "a-strong-password-123",
            "display_name": "验证码用户",
            "request_id": "v003-captcha",
        }
        payload.update(kwargs)
        return await identity_service.register(self.db, **payload)

    async def test_register_requires_captcha_when_enabled(self):
        with patch.object(settings, "CAPTCHA_ENABLED", True):
            with self.assertRaises(InvalidInput):
                await self._register()
        # 校验失败不留下半成品账号（脚手架本身已有 owner/other 两个用户）。
        leftovers = (
            await self.db.execute(
                select(User).where(User.email == "captcha-user@example.test")
            )
        ).scalars().all()
        self.assertEqual(len(leftovers), 0)

    async def test_register_rejects_wrong_captcha(self):
        row = await _seed_challenge(self, code="AB3D")
        with patch.object(settings, "CAPTCHA_ENABLED", True):
            with self.assertRaises(InvalidInput):
                await self._register(
                    captcha_id=str(row.id), captcha_code="ZZZZ", client_ip=None
                )

    async def test_register_with_valid_captcha_activates_without_smtp(self):
        row = await _seed_challenge(self, code="AB3D")
        with patch.object(settings, "CAPTCHA_ENABLED", True), patch.object(
            settings, "MAIL_ENABLED", False
        ):
            user, sent = await self._register(
                captcha_id=str(row.id), captcha_code="ab3d", client_ip=None
            )
        self.assertFalse(sent)
        self.assertEqual(user.status, "active")
        self.assertIsNotNone(user.email_verified_at)
        identity = (
            await self.db.execute(select(UserIdentity).where(UserIdentity.user_id == user.id))
        ).scalars().one()
        self.assertEqual(identity.status, "verified")
        self.assertIsNotNone(identity.verified_at)

    async def test_register_bypasses_captcha_when_disabled(self):
        with patch.object(settings, "CAPTCHA_ENABLED", False), patch.object(
            settings, "MAIL_ENABLED", False
        ):
            user, sent = await self._register()
        self.assertFalse(sent)
        self.assertEqual(user.status, "active")

    async def test_register_rate_limits_captcha_requests_per_ip(self):
        from app.core import ratelimit

        # 进程内计数跨用例保留，先清空同一桶保证确定性。
        await ratelimit.reset_rate_limit("captcha:ip:203.0.113.9")
        with patch.object(settings, "CAPTCHA_RATE_LIMIT_PER_HOUR", 1):
            await identity_service.create_captcha(self.db, client_ip="203.0.113.9")
            with self.assertRaises(RateLimited):
                await identity_service.create_captcha(self.db, client_ip="203.0.113.9")


if __name__ == "__main__":
    unittest.main()
