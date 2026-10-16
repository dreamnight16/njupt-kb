"""应用配置。

设计文档 §31.1：配置分环境管理，启动时检查必要配置，生产环境不能静默使用示例密钥。
"""

from __future__ import annotations

import secrets
from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_SECRETS = {
    "",
    "change-me",
    "njupt-kb-dev-secret",
    "njupt-kb-dev-secret-change-in-production",
    "请修改为随机长字符串",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=True
    )

    ENV: Literal["dev", "test", "prod"] = "dev"
    APP_NAME: str = "南邮课程知识平台"
    API_PREFIX: str = "/api/v1"
    PUBLIC_BASE_URL: str = "http://localhost:3000"

    # --- 数据库：本地与部署保持同一语义（§8），统一 PostgreSQL ---
    DATABASE_URL: str = "postgresql+asyncpg://njupt:njupt@localhost:5432/njupt_kb"
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 10
    DB_ECHO: bool = False

    # --- Redis：缓存与任务投递，不作为唯一业务事实来源（§8）---
    REDIS_URL: str = "redis://localhost:6379/0"

    # --- 会话与安全（§14.2）---
    SECRET_KEY: str = ""
    SESSION_COOKIE_NAME: str = "njupt_session"
    SESSION_TTL_HOURS: int = 24 * 14
    SESSION_TOUCH_INTERVAL_MINUTES: int = 30
    CSRF_COOKIE_NAME: str = "njupt_csrf"
    CSRF_HEADER_NAME: str = "X-CSRF-Token"
    COOKIE_DOMAIN: str | None = None
    COOKIE_SECURE: bool | None = None
    LOGIN_RATE_LIMIT_PER_HOUR: int = 20
    LOGIN_FAILURE_LOCKOUT_THRESHOLD: int = 10

    # --- 对象存储（§16）：私有原件、私有预览、隔离上传区 ---
    S3_ENDPOINT_URL: str = "http://localhost:9000"
    # 用于浏览器直传/下载的可达地址；签名时使用，不能在签名后替换域名。
    S3_PUBLIC_ENDPOINT_URL: str | None = None
    S3_REGION: str = "us-east-1"
    S3_ACCESS_KEY_ID: str = "njupt"
    S3_SECRET_ACCESS_KEY: str = "njupt-dev-secret"
    S3_BUCKET_QUARANTINE: str = "njupt-quarantine"
    S3_BUCKET_PRIVATE: str = "njupt-private"
    # 头像等公开静态资源桶（设计文档 §43：avatars 走 CDN）。
    S3_BUCKET_PUBLIC: str = "njupt-public"
    # 公开资源的永久访问前缀（CDN 或对外可读的桶地址）；留空时按 endpoint + bucket 拼装。
    S3_PUBLIC_BASE_URL: str | None = None
    S3_FORCE_PATH_STYLE: bool = True
    S3_PRESIGN_UPLOAD_SECONDS: int = 900
    S3_PRESIGN_DOWNLOAD_SECONDS: int = 60
    S3_MAX_CONCURRENCY: int = 8

    # --- 上传限制（§16.1，D06 待确认，本版建议值）---
    MAX_UPLOAD_SIZE_BYTES: int = 50 * 1024 * 1024
    ALLOWED_UPLOAD_MIME: list[str] = Field(
        default_factory=lambda: [
            "application/pdf",
            "image/png",
            "image/jpeg",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ]
    )

    # --- 头像：直接上传到公开桶，不需要走隔离区扫描（§14.2、§43）---
    AVATAR_MAX_SIZE_BYTES: int = 2 * 1024 * 1024
    ALLOWED_AVATAR_MIME: list[str] = Field(
        default_factory=lambda: ["image/png", "image/jpeg", "image/webp"]
    )

    # --- 内容安全检查（§13.1：扫描不可用不得默认 passed）---
    SCANNER: Literal["clamav", "disabled"] = "clamav"
    CLAMD_HOST: str = "clamav"
    CLAMD_PORT: int = 3310
    SCAN_TIMEOUT_SECONDS: int = 120

    # --- 预览转换（§13.1、§17.1）---
    PREVIEW_MAX_PAGES: int = 3
    PREVIEW_THUMBNAIL_WIDTH: int = 1000
    LIBREOFFICE_BIN: str = "soffice"
    DERIVATIVE_TIMEOUT_SECONDS: int = 180

    # --- beta11 第一页图片预览与用户水印（prevew.md）---
    # 图片预览默认只渲染第一页：浏览器拿到的是 page1.webp，不是完整 PDF（prevew.md 五）。
    PREVIEW_IMAGE_ENABLED: bool = True
    PREVIEW_IMAGE_WIDTH: int = 1200
    PREVIEW_IMAGE_QUALITY: int = 82
    # 水印低可见度但可追溯：斜向重复「用户短码 + 日期」，不用破坏阅读的大水印（prevew.md 十二）。
    PREVIEW_WATERMARK_ENABLED: bool = True
    PREVIEW_WATERMARK_OPACITY: int = 28  # 0-255，Alpha 通道

    # --- beta11 API 分级限流（pachong.md 三、四）---
    # 第一层规则，按角色分级、可调，不写死；subject 优先取登录用户，其次会话，最后 IP，
    # 避免校园网同一公网 IP 下互相挤占（pachong.md 四）。0 表示不限制。
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_WINDOW_SECONDS: int = 60
    RATE_LIMIT_SEARCH: dict[str, int] = {
        "anon": 30, "user": 60, "contributor": 60, "reviewer": 60, "admin": 120,
    }
    RATE_LIMIT_BROWSE: dict[str, int] = {
        "anon": 60, "user": 120, "contributor": 120, "reviewer": 120, "admin": 240,
    }
    RATE_LIMIT_RESOURCE: dict[str, int] = {
        "anon": 60, "user": 120, "contributor": 120, "reviewer": 120, "admin": 240,
    }
    RATE_LIMIT_DOWNLOAD: dict[str, int] = {
        "anon": 5, "user": 10, "contributor": 20, "reviewer": 30, "admin": 60,
    }
    RATE_LIMIT_UPLOAD: dict[str, int] = {
        "anon": 0, "user": 5, "contributor": 20, "reviewer": 30, "admin": 60,
    }
    RATE_LIMIT_LOGIN: dict[str, int] = {
        "anon": 5, "user": 5, "contributor": 5, "reviewer": 5, "admin": 5,
    }

    # --- 邮件（§21：仅用于验证与找回密码）---
    MAIL_ENABLED: bool = False
    MAIL_FROM: str = "no-reply@example.com"
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_STARTTLS: bool = True

    # --- 任务（§22）---
    JOB_MAX_ATTEMPTS: int = 5
    JOB_LEASE_SECONDS: int = 600
    JOB_SCAN_INTERVAL_SECONDS: int = 30

    # --- 幂等（§25.1：首期建议至少 24 小时）---
    IDEMPOTENCY_TTL_HOURS: int = 24

    # --- CORS：不使用通配符与凭据组合（§28）---
    CORS_ORIGINS: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    # --- 阶段开关（§6）：关闭时接口必须显式不可用，不返回假成功（§25.2）---
    COMMERCE_ENABLED: bool = False
    AI_ENABLED: bool = False
    AI_BASE_URL: str = ""
    AI_API_KEY: str = ""
    AI_MODEL: str = ""
    AI_MONTHLY_BUDGET_CENTS: int = 0

    @model_validator(mode="after")
    def _validate(self) -> "Settings":
        if not self.SECRET_KEY:
            if self.ENV == "prod":
                raise ValueError("生产环境必须显式配置 SECRET_KEY")
            self.SECRET_KEY = secrets.token_urlsafe(48)
        elif self.ENV == "prod" and self.SECRET_KEY in INSECURE_SECRETS:
            raise ValueError("生产环境检测到示例 SECRET_KEY，拒绝启动")
        if self.ENV == "prod" and "*" in self.CORS_ORIGINS:
            raise ValueError("生产环境不允许 CORS_ORIGINS 使用通配符")
        if self.ENV == "prod" and not self.COOKIE_SECURE:
            raise ValueError("生产环境必须启用 COOKIE_SECURE")
        if self.AI_ENABLED and not (self.AI_BASE_URL and self.AI_MODEL):
            raise ValueError("AI_ENABLED=true 时必须配置 AI_BASE_URL 与 AI_MODEL")
        return self

    @property
    def cookie_secure(self) -> bool:
        if self.COOKIE_SECURE is not None:
            return self.COOKIE_SECURE
        return self.ENV == "prod"

    @property
    def is_prod(self) -> bool:
        return self.ENV == "prod"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
