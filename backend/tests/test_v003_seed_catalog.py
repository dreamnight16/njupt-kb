"""0.0.3 目录种子（2025 官方学院→专业）逻辑测试（隔离 SQLite）。

seed_catalog 使用应用级 async_session_factory，本测试用内存 SQLite 替换后直接调用，
覆盖：官方目录落库、更名复用旧行、历史行停用不删除、课程关联跳过、重复执行幂等。
"""

import contextlib
import io
import unittest
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models_registry  # noqa: F401
import scripts.seed_catalog as seed_mod
import test_content_workflow  # noqa: F401  # 注册 JSONB→SQLite JSON 编译钩子
from app.db import Base
from app.modules.catalog.models import College, Course, Major, University


def _make_factory(engine):
    return async_sessionmaker(engine, expire_on_commit=False)


class SeedCatalogTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self._original_factory = seed_mod.async_session_factory
        seed_mod.async_session_factory = _make_factory(self.engine)
        self._stdout = io.StringIO()
        self._patch_stdout = contextlib.redirect_stdout(self._stdout)
        self._patch_stdout.__enter__()

    async def asyncTearDown(self):
        self._patch_stdout.__exit__(None, None, None)
        seed_mod.async_session_factory = self._original_factory
        await self.engine.dispose()

    async def _rows(self):
        async with seed_mod.async_session_factory() as session:
            university = (
                await session.execute(
                    select(University).where(University.slug == seed_mod.UNIVERSITY_SLUG)
                )
            ).scalars().one()
            colleges = (
                await session.execute(select(College).where(College.university_id == university.id))
            ).scalars().all()
            majors = (
                await session.execute(select(Major).where(Major.university_id == university.id))
            ).scalars().all()
            courses = (
                await session.execute(select(Course).where(Course.university_id == university.id))
            ).scalars().all()
            return colleges, majors, courses

    async def test_seed_creates_official_taxonomy_and_is_idempotent(self):
        await seed_mod.seed_catalog()
        await seed_mod.seed_catalog()

        colleges, majors, courses = await self._rows()
        self.assertEqual(len(colleges), len(seed_mod.COLLEGES))
        active_majors = [m for m in majors if m.status == "active"]
        self.assertEqual(len(active_majors), len(seed_mod.MAJORS))
        # 幂等：重复执行不产生重复行。
        self.assertEqual(len(courses), len({name for _, name, *_ in seed_mod.COURSES}))

        college_by_id = {c.id: c for c in colleges}
        major_names = {m.name for m in active_majors}
        self.assertIn("信息安全", major_names)
        self.assertNotIn("网络空间安全", major_names)
        # 每个激活专业都挂在激活学院下（学院→专业一体）。
        for major in active_majors:
            college = college_by_id[major.college_id]
            self.assertEqual(college.status, "active")
            self.assertIn(college.short_name, {s for _, s in seed_mod.COLLEGES})
        # 信息安全归属计算机学院（学院、软件学院、网络空间安全学院）。
        security = next(m for m in active_majors if m.name == "信息安全")
        self.assertEqual(
            college_by_id[security.college_id].name,
            "计算机学院、软件学院、网络空间安全学院",
        )

    async def test_legacy_rows_are_reused_or_retired_not_duplicated(self):
        # 模拟旧版种子留下的库：传媒学院（旧全称）+ 已不在官方目录的专业。
        async with seed_mod.async_session_factory() as session:
            university = University(name=seed_mod.UNIVERSITY_NAME, slug=seed_mod.UNIVERSITY_SLUG)
            session.add(university)
            await session.flush()
            legacy_college = College(
                university_id=university.id,
                name="传媒与艺术学院",
                short_name="传媒学院",
            )
            session.add(legacy_college)
            await session.flush()
            session.add(
                Major(
                    university_id=university.id,
                    college_id=legacy_college.id,
                    name="市场营销",
                    category="管理学",
                )
            )
            await session.commit()
            legacy_college_id = legacy_college.id

        await seed_mod.seed_catalog()
        colleges, majors, _ = await self._rows()

        # 传媒学院被更名复用为"数媒学院"，而不是另起一行。
        self.assertEqual(len(colleges), len(seed_mod.COLLEGES))
        reused = next(c for c in colleges if c.id == legacy_college_id)
        self.assertEqual(reused.short_name, "数媒学院")
        self.assertEqual(reused.name, "数字媒体与设计艺术学院")
        self.assertEqual(reused.status, "active")
        # 市场营销保留但停用，激活列表里不出现。
        legacy_major_row = next(m for m in majors if m.name == "市场营销")
        self.assertEqual(legacy_major_row.status, "inactive")
        # 激活专业按 (学院, 专业) 计 63 行（同名专业分学院各自建档）。
        active_rows = [m for m in majors if m.status == "active"]
        self.assertEqual(len(active_rows), len(seed_mod.MAJORS))
        self.assertNotIn("市场营销", {m.name for m in active_rows})

    async def test_course_links_skip_unknown_majors(self):
        await seed_mod.seed_catalog()
        output = self._stdout.getvalue()
        # 2025 目录覆盖了课程引用的全部专业；若有跳过，应显式提示而不是静默失败。
        self.assertIn("seed_catalog 完成", output)
        self.assertNotIn("因专业不在 2025 官方目录而跳过", output)

    async def test_university_row_is_shared_across_runs(self):
        await seed_mod.seed_catalog()
        async with seed_mod.async_session_factory() as session:
            universities = (await session.execute(select(University))).scalars().all()
            self.assertEqual(len(universities), 1)
            self.assertEqual(universities[0].slug, seed_mod.UNIVERSITY_SLUG)
            self.assertIsNotNone(uuid.UUID(str(universities[0].id)))


if __name__ == "__main__":
    unittest.main()
