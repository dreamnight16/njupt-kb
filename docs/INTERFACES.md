# 跨模块接口声明

## beta13 增补

- `moderation.comment_reports.create_comment_report` / `create_comment_appeal`：按 `reporter_id`/`appellant_id` 做提交频控（`check_rate_limit`，`COMMENT_REPORT_RATE_LIMIT`/`COMMENT_APPEAL_RATE_LIMIT`，窗口 `*_RATE_WINDOW_SECONDS`）与"本人未处理数"上限（`COMMENT_REPORT_OPEN_CAP`/`COMMENT_APPEAL_OPEN_CAP`）；超限返回 `429 RATE_LIMITED`（未处理上限用 code `REPORT_OPEN_CAP_EXCEEDED`/`APPEAL_OPEN_CAP_EXCEEDED`）。检查在既有唯一索引判定之前，不改变受理/驳回/处置权限与审计。
- `ops.service.check_ops_alerts(db)` 与 `GET /admin/alerts`（权限 `ops.view`）：只读聚合未处理举报、待审版本、未处理纠错、开放需求、失败事件与失败任务，各一次 COUNT；按 `OPS_ALERT_*` 阈值生成 `level=warning|critical`（critical 倍率 `OPS_ALERT_CRITICAL_MULTIPLIER`），非 critical 优先、按计数降序；返回 `OpsAlertsOut{alerts, has_critical, generated_at}`。不写库、不自动处置。
- `access.service.revoke_preview_grant(db, *, actor, grant_id, reason, request_id)` 与 `POST /admin/preview-grants/{grant_id}/revoke`（权限 `RESOURCE_REVIEW`，返回 `PreviewGrantOut`）：撤销单条预览凭证，`reason` 1–255 字，置 `status=revoked`、清 `preview-grant:{id}` 缓存、写审计；已撤销返回 `409 PREVIEW_GRANT_ALREADY_REVOKED`（幂等）。
- `access.service.revoke_resource_previews(db, *, actor, resource_id, reason, request_id)` 与 `POST /admin/resources/{resource_id}/preview-revoke`（权限 `RESOURCE_REVIEW`，返回 `{resource_id, revoked_count}`）：按资源批量仅撤销活跃态（`issued`/`consumed`），不删凭证记录，清 `preview-resource:{id}` 缓存并写审计；资源不存在经 content 抛 404。
- `identity.service.run_retention_cleanup(db, *, retention_days=ACCOUNT_RETENTION_DAYS=30, now=None)`：对 `status=deleted`、`deleted_at` 非空、`purged_at` 空且 `deleted_at ≤ now-retention_days` 的账号，置墓碑邮箱 `purged+{id}@purged.invalid`、清 `email_verified_at` 并置 `purged_at`、撤销全部会话、撤销该用户 `EMAIL` 类 `UserIdentity`，逐条写 `identity.account_purged` 审计。**不删用户行、业务记录与审计**，只收敛 PII；返回清理条数。定时入口 `python -m app.modules.identity.retention`。
- `core.storage.presign_preview_download(storage_key, *, bucket, file_name=None)`：预览专用短期预签名，固定走 `PREVIEW_URL_TTL_SECONDS`（默认 300s），不改变既有 `presign_download` 语义。`access.issue_preview_grant` 据该 TTL 设置 `PreviewGrant.valid_until` 并用它签发。
- `access.watermark_integrity.compute_watermark_token(*, user_id, resource_id, version_id)` / `verify_watermark_token(...)`：`SECRET_KEY` 的 HMAC-SHA256，把水印令牌绑定到 (用户, 资源, 版本)，`compare_digest` 恒定时间比对、任一入参被篡改即 False；令牌不带权限判断，权限仍由 authorize 负责。`PreviewGrantResult` 新增 `watermark_token`，随 `issue_preview_grant` 返回供渲染侧复核。
- `core/aigateway.py`（启用前构建块，AI 默认关闭、不接线上供应商）：`CircuitBreaker`（`AI_GATEWAY_FAILURE_THRESHOLD` 连续失败熔断、`AI_GATEWAY_COOLDOWN_SECONDS` 后半开试探、一成一败）、`CallBudget`（每 `request_id` 的 `AI_REQUEST_MAX_CALLS`/`AI_REQUEST_MAX_TOKENS` 预算）、`sanitize_ai_prompt`（剥离控制字符与提示注入越权标记）、`call_ai_safe`（`AI_ENABLED=False` 立即返回 None 空操作；启用时经熔断/预算/`AI_GATEWAY_TIMEOUT_SECONDS` 并优雅降级）。均进程内实现，生产熔断/预算应接 Redis（NOT_RUN）。
- `core.middleware.SecurityHeadersMiddleware`（注册于最外层）：为 API 响应下发 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、`Permissions-Policy`、CSP `default-src 'none'; frame-ancestors 'none'; base-uri 'none'`、`X-XSS-Protection: 0`、`Cache-Control: no-store`（已有缓存策略不覆盖）；`cookie_secure` 为真加 HSTS。生产（`is_prod`）非 HTTPS（`X-Forwarded-Proto: https` 放行）返回 `403 INSECURE_TRANSPORT`。
- `errors` 通用 500 处理器：生产返回 `500 INTERNAL_ERROR`（不泄露堆栈/内部路径/配置），dev 返回异常详情；业务错误体形状不变。
- 依赖基线升级（安全补丁，最小变更）：`fastapi 0.115.6→0.115.12`（查询参数解析 ReDoS，GHSA-2m2c-j64x-2xpp）、`Pillow 11.1.0→11.3.0`（CVE-2025-48379）。迁移仅 `0009_beta13_retention`（`users.purged_at` + 索引）。

## beta12 增补

- `identity.service.set_account_status(db, *, user_id, status, reason, actor_id, request_id)`：人工暂停/恢复账号的唯一写入口。行锁读取目标；仅有效管理员可操作，不能暂停/恢复自己或其他管理员；`reason` 必填；状态必须按 `active→suspended→active` 流转，非法流向、状态已变化或目标已注销返回 409 `ACCOUNT_STATE_CHANGED`。会话撤销与同事务审计由调用方 `moderation.set_account_restriction` 负责，本函数不重复实现。
- `POST /admin/users/{user_id}/suspend` 与 `/admin/users/{user_id}/reinstate`（204）：`reason` 必填；复用 `set_account_restriction`，暂停时撤销全部会话并写审计；恢复已注销账号返回 409。
- `GET /admin/users`（权限 `user.suspend`）：`keyword/status/role` 过滤 + 游标分页；只返回 ID、邮箱、昵称、角色、状态、验证与注册时间，不含口令等敏感字段；`keyword` 中的 `%`/`_` 按字面转义，不作为通配符。
- `ops.personal.overview/downloads/feed` 及 `GET /me/overview`、`/me/downloads`、`/me/feed`：从既有业务事实聚合，不新增跟踪表。总览只统计本人事实；下载历史按授予时间降序游标分页，资料转私有、下架或发布新版本后，该行 `available=false` 并遮蔽资料 ID/标题/文件名/版本号，不泄露已失去访问权的内容；关注动态合并课程与创作者关注、按当前已发布版本去重，非发布态不出现。游标无效返回 400。
- `access.create_entitlement`：不得向 `banned`/`deleted` 账号授予；`expires_at` 必须晚于生效时间与当前时间；`scope_id` 必须已存在（资料、版本或课程之一），拒绝指向不存在对象的占位权益；`expires_at`/`revoked_at` 以 ISO 字符串写入审计，不存裸对象。
- `jobs.retry_job`：行锁读取并刷新后返回；仅 `failed`/`cancelled` 可重新入队，重置 attempts；已 `queued`/`running` 返回 409。`PROCESSOR_VERSIONS` 的 `file.scan`/`file.derive` 升至 `scan/2`、`derive/2`，与 `derivatives.PROCESSOR_VERSION` 一致。
- `core.pagination.seek_descending(db, stmt, timestamp, identity, cursor)`：模块共用的（时间戳, id）降序游标翻页；SQLite 用 `strftime` 对齐时间小数位，PostgreSQL 保持原表达式；jobs、moderation、access 与 ops 列表统一走它，不再各自实现元组比较。
- `content.scanning.scan_quarantined_object(..., verified_storage_key)`：扫描通过后把**本次实际扫描的本地字节**写入私有区目标键，不再复制可能被上传凭证覆盖的隔离对象；下载超限返回 `size_exceeded`，格式解析失败以 `malformed:` 前缀拒绝，扫描或存储失败不会留下私有区快照。OOXML 拒绝绝对路径、`..`、盘符与符号链接条目，限制压缩条目数与解包总量（`MAX_ARCHIVE_ENTRIES`/`MAX_ARCHIVE_UNPACKED_BYTES`）；宏文档大小写不敏感排除；PDF 页数与图片像素受 `MAX_DOCUMENT_PAGES`/`MAX_IMAGE_PIXELS` 约束。
- `content.service._download_verified_source`（内部）：生成预览前重新下载并校验 `size` 与 `sha256`，与扫描记录不一致即 `DerivativeError`，不渲染、不清空既有预览；普通派生成功后才替换旧记录，失败不清空；水印对象按处理器版本复用。
- `access.issue_preview_grant`：首次渲染完成后重新读取资源、版本、文件与用户事实并重新授权；渲染期间下架、关闭预览或权限变化都不会签发预览链接（`PREVIEW_DISABLED` 404）。
- `core.storage.ObjectSizeExceeded`：对象下载超过 `MAX_UPLOAD_SIZE_BYTES` 即停止读取并关闭响应体，不写满临时磁盘。

## beta11 增补

- `content.service.ensure_watermarked_preview(db, *, source_file, user)`：仅在 access 已授权后调用，为已扫描 PDF/PNG/JPEG 生成或复用当前用户第一页 WebP；完整 HMAC 区分用户对象，显示水印只用短码和生成日期。关闭、匿名、不支持格式或转换失败返回 `None`；存储故障由 access 回退已有受限派生文件，不改变原件与下载权益。
- `PreviewGrantResult.preview_type`：`image`（第一页水印图）、`pdf`（受限 PDF）、`thumbnail`（缩略图）。Office 与匿名预览沿用受限派生文件，本轮不代表所有格式均已纯图片化。
- `ratelimit.deps.rate_limit(action)`：按用户/有效会话/ASGI 客户端地址计数，独立事务；用于登录、搜索、课程列表/详情、资料详情、预览/下载授予、上传。角色限额通过 `RATE_LIMIT_*` 覆盖，超限响应 `429 RATE_LIMITED` 与 `Retry-After`。与下载业务硬配额分别生效。
- 代理地址由 ASGI 服务器仅对已配置的受信代理解析；应用不直接采信 `X-Forwarded-For`。部署须正确配置 `FORWARDED_ALLOW_IPS`，不能用任意来源信任代替真实入口验收。
- `POST /requests/{id}/reopen`：`expected_revision` 与 1—500 字非空 `reason`；已解决可由发起者或管理员重开，已关闭仍仅管理员。成功回到 `open`、清空解决资料、修订号递增，事务内审计并复用 `request.updated`；冲突返回 `409 STALE_REVISION`。
- 需求详情/列表增加 `resolved_resource_accessible`，并保留 `resolution_available`；按查看者权限解析，不可访问时遮蔽解决资源 ID 与标题，不自动重开。前端缓存按身份隔离。

## beta3 接续增补

- `interaction.service.list_corrections(db, *, status, cursor, limit)`：管理端纠错工单列表，与 `list_my_corrections` 的区别只是不限定提交人。
- `interaction` 新增 GET `/admin/corrections`（`status` 过滤、游标分页，权限 `correction.handle`）；处理仍走既有 POST `/admin/corrections/{id}/status`。
- 前端补齐：`/reset-password` 密码找回确认页、`/admin/reports` 投诉工单处理（事件时间线与状态流转）、`/admin/corrections` 纠错工单处理、`/requests` 求资料（列表/新建/关注）、课程页关注按钮与 `/me/follows`。
- 关注与求资料关注均为幂等设置语义：PUT 设置、DELETE 取消；求资料关注命中未解决需求时合并计数，不重复建单。

## beta3 增补

- `access.visibility.visible_resource_ids(user)` 返回 SQLAlchemy 查询，详情、列表和搜索按同一访问范围处理；列表和搜索在分页前过滤。
- `content.management.list_my_resources(db, *, user, cursor=None, limit=None)`：当前作者的分页列表。
- `content.management.list_versions(db, *, user, resource_id)`：作者或有对应审核范围的版本列表。
- `content.management.get_version_detail(db, *, user, resource_id, version_id)`：指定版本、文件、来源声明与审核意见；返回 `can_edit`。
- `access.service.issue_inspection_grant(db, *, user, resource_id, version_id, file_id)`：作者或授权审核人员检查安全原件，不产生公开下载权益。
- `moderation.service.latest_decision_reason(db, version_id)`：查询该快照最近的审核意见。
- `moderation.service.can_review`：普通审核员必须有对应审核记录，且符合指派范围；不能借审核权限读取未提交草稿。
- `content` 新增 GET `/me/resources`、GET `/resources/{id}/versions`、GET `/resources/{id}/versions/{vid}`、POST `/resources/{id}/versions/{vid}/files/{fid}/inspection-grants`。
- 下载幂等事实以 `DownloadGrant` 为准；每次重取链接检查授权后重新签名，不复用缓存签名响应。

只有本文件列出的函数允许被其他模块调用。签名变更必须同步修改本文件与所有调用点。
调用方式：函数体内局部导入，例如 `from app.modules.access.service import authorize`。

## identity

```python
async def get_user(db: AsyncSession, user_id: uuid.UUID) -> User            # 找不到抛 NotFound
async def get_users(db: AsyncSession, user_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, User]
def display_name_of(user: User) -> str                                      # 匿名化后返回"已注销用户"
async def revoke_all_sessions(db: AsyncSession, user_id: uuid.UUID, *, reason: str) -> int
async def is_school_verified(db: AsyncSession, user_id: uuid.UUID) -> bool
```

## catalog

```python
async def get_course(db: AsyncSession, course_id: uuid.UUID) -> Course       # 找不到抛 NotFound
async def get_courses(db: AsyncSession, ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, Course]
async def get_offering(db: AsyncSession, offering_id: uuid.UUID) -> CourseOffering
async def course_brief(db: AsyncSession, course_id: uuid.UUID) -> CourseBrief
# CourseBrief: course_id, code, name, college_name, aliases: list[str]
```

## content

```python
async def get_resource(db: AsyncSession, resource_id: uuid.UUID) -> Resource
async def get_version(db: AsyncSession, version_id: uuid.UUID) -> ResourceVersion
async def get_file(db: AsyncSession, file_id: uuid.UUID) -> ResourceFile
async def published_version(db: AsyncSession, resource: Resource) -> ResourceVersion | None
async def version_files(db: AsyncSession, version_id: uuid.UUID) -> list[tuple[VersionFile, ResourceFile]]
async def resource_course_id(db: AsyncSession, resource_id: uuid.UUID) -> uuid.UUID
async def assert_visible(db: AsyncSession, resource: Resource) -> None
# 可见性唯一入口：未发布（unpublished/withdrawn/archived）一律抛 NotFound。
```

`content` 拥有资源的 `publication_status`、`freshness_status`、`published_version_id`、`revision`。
其他模块只能通过以下函数改变这些列：

```python
async def mark_published(db: AsyncSession, *, resource_id, version_id, expected_revision, actor_id, request_id) -> None
async def mark_withdrawn(db: AsyncSession, *, resource_id, expected_revision, actor_id, reason, request_id) -> None
async def set_freshness(db: AsyncSession, *, resource_id, status, actor_id) -> None
async def set_version_review_status(db: AsyncSession, *, version_id, status, actor_id, request_id) -> None
# 审核结论投影到 resource_versions.review_status 的唯一入口（moderation 调用）。
async def reassign_resource_course(db: AsyncSession, *, resource_id, course_id, actor_id, reason, request_id) -> None
# 更正资源课程归属的唯一入口（moderation 调用）；改课程会同时清空 offering_id。
```

## access

```python
async def authorize(
    db: AsyncSession, *,
    user: User | None,
    resource_id: uuid.UUID,
    version_id: uuid.UUID,
    file_id: uuid.UUID | None = None,
    capability: Capability,
) -> None
# 按 §15.1 判定顺序执行；不通过时抛 Forbidden 或 NotFound，不返回布尔值。
# 这是唯一允许判定"能否读/预览/下载"的函数，模块不得自行实现权限判断。

async def issue_preview_grant(db: AsyncSession, *, user: User | None, resource_id, version_id, request_id) -> PreviewGrantResult
async def issue_download_grant(
    db: AsyncSession, *, user: User, resource_id, version_id, file_id,
    idempotency_key: str, request_id: str,
) -> DownloadGrantResult
# DownloadGrantResult: grant_id, download_url, url_expires_at, file_name, version_no
```

## moderation

```python
async def open_review(db: AsyncSession, *, version_id: uuid.UUID, submitter_id: uuid.UUID) -> Review
async def get_review(db: AsyncSession, review_id: uuid.UUID) -> Review
async def decide(
    db: AsyncSession, *, review_id: uuid.UUID, reviewer: User,
    decision: ModerationDecisionType, reason: str, snapshot_revision: int, request_id: str,
) -> ModerationDecision
# 决定不可原地覆盖；并发时过期快照抛 Conflict（§13.3、§29）。
async def can_review(db: AsyncSession, reviewer: User, version_id: uuid.UUID) -> bool
```

## interaction

```python
async def resource_rating_summary(db: AsyncSession, resource_id: uuid.UUID) -> RatingSummary
# RatingSummary: average: float, count: int, shrunk: float   （§20.1 小样本采用收缩评分）
async def has_access_history(db: AsyncSession, *, user_id: uuid.UUID, resource_id: uuid.UUID) -> bool
# 评价资格：至少获得过该内容访问权（§20.1）。
```

## notification

```python
async def notify(
    db: AsyncSession, *, user_id: uuid.UUID, type: NotificationType,
    title: str, body: str, data: dict | None = None,
) -> None
async def dispatch_event(db: AsyncSession, event_id: uuid.UUID) -> None
# 消费 domain_events 并转为通知；通知失败不回滚已成功的事务（§21）。
async def fanout_due_events(db: AsyncSession, limit: int = 200) -> int
```

## jobs

```python
async def enqueue(
    db: AsyncSession, *, job_type: JobType, target_id: uuid.UUID | str,
    input_version: int = 1, payload: dict | None = None, dedupe_key: str | None = None,
) -> Job
# 幂等约束：目标 + 输入版本 + 处理器版本 + 任务类型（§22.2）。
async def run_job(job_id: str) -> str          # Celery 任务入口，返回 JobStatus 值
async def dispatch_due_jobs() -> dict          # 扫描器：到期任务与超时租约
```

## creator

```python
async def record_contribution(
    db: AsyncSession, *, user_id: uuid.UUID, kind: ContributionKind,
    reference_type: str, reference_id: uuid.UUID, note: str | None = None,
) -> None
# 有效贡献 ≠ 授权链接次数（§24.1）。自下载、重复刷取不得计入。
async def contribution_summary(db: AsyncSession, user_id: uuid.UUID) -> ContributionSummary
async def get_creator_profile(db: AsyncSession, user_id: uuid.UUID) -> CreatorProfileOut
# 公开视角：未公开或无资料时只回退到账号昵称与贡献汇总，不编造资料。
async def get_own_creator_profile(db: AsyncSession, *, user) -> CreatorSelfProfileOut
# 本人视角：额外返回 is_public，且未公开的 headline/bio 也如实返回，便于回填表单。
async def update_creator_profile(db: AsyncSession, *, user, payload: dict, request_id: str | None) -> CreatorSelfProfileOut
# headline/bio 显式传 null 表示清空；is_public 缺席即不改。昵称/头像不在此维护。
```

`GET /me/creator-profile` 与 `PUT /me/creator-profile` 分别对应上述两个函数；贡献者公开资料另有 `GET /creators/{user_id}`。

## commerce

```python
async def entitlement_grants(db: AsyncSession, *, user_id: uuid.UUID, scope_type: ScopeType, scope_id: uuid.UUID) -> list[Entitlement]
# 供 access 模块在判定权益时调用；未启用时返回空列表，不伪造权益。
async def confirm_payment(db: AsyncSession, *, channel: str, payload: dict) -> PaymentAttempt
# 只接受验签通过的通知；重复回调不重复授予权益（§24.3）。
```

## beta5 分类与纠错扩展

- `catalog.service.classification_catalog(db) -> list[dict]`：有效课程 ID、名称、代码、别名；同名保留独立身份。
- `POST /admin/imports/classify`：`names`（1–50 个、文件名最多 300 字符），返回匹配依据、候选课程、建议类型和需确认标志；需要 `catalog.manage`。
- `POST /admin/imports/drafts`：沿用 `ResourceCreate` / `ResourceCreatedOut`，每项独立幂等，需要 `catalog.manage` 与 `resource.submit`。上传及提交仍走原接口。
- `POST /corrections` 增加可选 `suggested_course_id`、`suggested_resource_type`；仅允许当前公开版本且需有元数据权限。
- `POST /admin/corrections/{id}/classification`：`expected_revision`、`resolution_note`；需要 `catalog.manage` 与 `correction.handle`。事务内调用 `content.service.correct_classification` 校验公开版本与修订号，更正资源分类，随后标记工单已修复并通知。过期快照返回 409。
- `GET/PATCH /me` 增加可选 `gender`、`bio`。头像使用不带账号密码的 HTTPS 地址，现有 `avatar_url` 继续可清空；新增字段仅通过本人接口返回。
- `POST /me/avatar`：`multipart/form-data` 单文件字段 `file`，接受 PNG/JPEG/WebP/GIF 且不超过 `AVATAR_MAX_SIZE_BYTES`（默认 2 MiB）。`image/jpg`、`image/pjpeg`、`image/x-png` 等浏览器非标准 MIME 先归一再校验，避免 Windows 下 .jpg 被误拒。按真实字节用 Pillow 校验格式，写入公开桶 `S3_BUCKET_PUBLIC` 并返回更新后的 `MeResponse`；地址由 `S3_PUBLIC_BASE_URL`（留空时回退 `S3_PUBLIC_ENDPOINT_URL` + 桶名）拼装。头像不走隔离区扫描，也不能用它替代资料文件上传。

## beta6 共建与质量扩展

- `GET /resources` 增加 `owner_id` 过滤（贡献者主页用）；可见范围仍由 `visible_resource_ids` 决定，不扩大权限。
- `ResourceDetailOut` 增加 `owner_id` 与 `owner_display_name`（贡献者公开昵称；账号注销后回退匿名占位），用于跳转贡献者主页。
- `GET /creators/{user_id}`：公开资料 + 贡献汇总；`is_public=false` 时只返回账号昵称与贡献汇总。
- `GET/PUT /me/creator-profile`：本人维护 `headline`、`bio`、`is_public`；不改变账号权限，写入 `creator.profile_updated` 审计。
- 评论沿用既有 `GET/POST /resources/{id}/comments`；`parent_id` 表示一层回复，前端不做无限嵌套。

## beta7 课程攻略与规则推荐

- 课程攻略复用 `ResourceType.GUIDE`；读取使用 `GET /resources?course_id={id}&resource_type=guide`，保留游标分页。上传、来源声明、安全扫描、审核、修订、撤回与下载权限均沿用资料流程。
- 前端 `/courses/{id}/guides` 提供攻略列表、空状态、错误状态与下一页；`/upload?course_id={id}&type=guide` 预选课程和类型，允许提交前修改。
- `GET /recommendations?course_id={optional_uuid}&limit=6`：游客可用，`limit` 为 1–20；返回 `{items: RecommendationItem[]}`，固定前 N 条，不提供分页。`RecommendationItem` 在 `SearchItem` 上增加 `reasons: string[]`。
- 实现入口 `interaction.recommendations.recommend_resources`；只读已发布、公开指针指向本资源已审核版本、元数据可见且未标记为 `outdated` 的内容。权限过滤在排序截断前完成，不返回原件地址。
- 排序为：命中课程或贡献者关注 → 现行优先 → 收缩评分降序 → 收藏人数降序 → 更新时间降序 → 资源 ID 升序。评分复用既有先验 3.5、置信样本量 5；不引入下载计次或隐藏行为追踪。无关注记录时自然使用通用排序。
- 理由根据实际命中条件生成，包含关注来源、课程范围、时效、评价样本量和收藏人数；不宣称“精品”或已核实质量。关闭关注、下架与权限变更在下一次请求生效。
- 首页与课程详情分别加载推荐，失败显示提示；搜索、资料列表与上传入口保持可用。AI 与商业化开关不参与此流程。

## beta8 评论治理

- `GET /resources/{id}/comments` 增加当前会话的资料元数据权限检查；无权资料返回 404，保留原有升序游标和回复占位，不过滤掉已撤回/隐藏的记录。
- `CommentItem.body` 改为 `string | null`，增加 `status: visible | withdrawn | hidden` 和 `revision: int`。撤回或隐藏后普通接口一律返回 `body=null`，包括作者和管理员；原文保存在数据库中。
- `POST /resources/{rid}/comments/{cid}/withdraw`：`{expected_revision}`，仅 active 原作者可撤回；不可恢复。
- `POST /resources/{rid}/comments/{cid}/moderation`：`{expected_revision, hidden, reason}`，仅 active 且有 `comment.moderate` 权限者可设置；当前仅管理员有此权限。理由去首尾空白，长度 1–500 字。
- 同状态重试返回当前条目，不重复追加审计；改变状态时修订号不匹配返回 `409 STALE_REVISION`。作者撤回优先；隐藏后仍可撤回，撤回后管理员不能隐藏/恢复。
- 新增评论/回复仅允许 active 账号；只支持回复正常的主评论。主评论状态变化保留已有正常回复，禁止新增回复。创建回复与治理共用目标评论的数据库行锁，事务内写入审计，不复制正文。
- 实现位于 `interaction/comment_management.py`，状态字段由 `0003_beta8` 新增。升级需先迁移；结构降级会丢失治理状态，必须先停用公开评论读写并备份，不能直接回到忽略遮蔽字段的旧应用。
- 界面在资料讨论区；未新增全站评论队列、评论举报/申诉模型或回复通知。求资料解决流程仍为设计候选，未提供占位接口。

## beta9 P2 供需与运营闭环

- `GET /requests/{id}`：需求详情，包含 `requester_id / revision / handled_at`。`resolution_available` 与 `resolved_resource_title` 表示当前公开解决资料摘要；资料下架/变私有/改课程后返回不可用，ID 与标题均为 null，不自动重开需求。
- `POST /requests/{id}/status`：`status, expected_revision, resource_id?, reason?`。active 发起者或 `request.handle` 管理员可解决/关闭、重开已解决项；已关闭项仅管理员可重开。关闭/重开必填理由。同状态同资料重复提交不追加事件，其他过期快照 409。
- `GET/POST /requests/{id}/responses`：候选列表游标分页；提交只需 `resource_id`，active 用户可操作。必须同课程、已发布、当前版本已审核且游客元数据可读；`(request_id, resource_id)` 唯一，重复回应不重复通知。非 open 需求拒绝新回应。
- `GET /requests/{id}/resources`：按本课程列出公开资料供选择，支持 `keyword / cursor`；不绕过最终候选/解决校验。需求、本人需求和候选摘要采用批量公开性查询。
- `request.updated` 事件按状态新修订号或候选记录 ID 去重。状态结果通知发起者与需求关注者，新候选通知发起者；通知正文不保存解决资料标题或敏感处理理由，详情读取时再判断可用性。
- 资源发布通知合并课程/创作者关注并去重，跳过作者本人，仍校验收件人当前元数据权限。
- `GET /admin/events`：`job.retry` 权限读取失败事件游标列表；只返回 ID、类型、状态、尝试次数、创建时间，不返回载荷或原始错误。`POST /admin/events/{id}/retry` 接收 `expected_attempts`，仅将失败项重置 pending，保留次数；后台随后消费，重复 pending 重试不新增通知。
- `GET /admin/comments`：`comment.moderate` 权限，`hidden_only / cursor / limit`，仅已发布资料的评论；隐藏/撤回正文仍为 null，具体操作复用资料页。
- 通知客户端按真实 `is_read` 字段读取；既有 `POST /notifications/read-all` 与单条已读接口补齐界面。需求、候选、通知、关注、本人需求补分页，新增 `/requests/{id}`、`/admin/comments`、`/admin/events` 页面。
- `0004_beta9` 增加需求处理字段、候选表和事件类型约束。升级前备份；回退不静默删除新事件，旧事件约束不接受新类型时拒绝回退。AI、商业化与解决贡献奖励未启用。

## beta10 账号注销、目录运营与互动治理

- `POST /me/deletion`：`{password, confirm}`。`confirm` 必须等于固定确认词「注销账号」；校验当前密码后**立即注销**：`users.status=deleted`、写入 `deleted_at`、匿名化个人资料（昵称改为「已注销用户」，头像/简介/性别/学院/专业/入学年份/偏好清空）、撤销全部会话。上传资源、评论、评分、审计与事件记录一律保留；评论不做匿名化，作者显示名随资料匿名化变为「已注销用户」。密码错误返回 403 并记审计（不记密码）；重复注销返回 409 `ACCOUNT_ALREADY_DELETED`。已注销账号被 `get_current_user` 拒绝（403），因此不可再登录或调用本人接口。
- `GET /me/export`：返回本人数据 JSON 附件（`Content-Disposition`，文件名 `njupt-kb-export-<date>.json`）。含账号、资料、关注、收藏、评分、本人评论（带撤回/隐藏标记）、本人上传清单（标题/类型/状态/时间，**不含文件字节与签名 URL**）、通知、本人需求与候选回应、本人会话。不含他人数据。注销后不可导出。
- 保留策略：`identity/service.py` 的 `ACCOUNT_RETENTION_DAYS = 30`。注销立即生效，邮箱与审计/业务事实按保留期保留供申诉与对账，期满由运维清理；**本轮不实现自动清理任务**。迁移 `0005_beta10_account` 仅新增 `users.deleted_at`。
- 目录维护（`catalog.manage`）：`GET/POST /admin/catalog/{entity_type}`、`PATCH /admin/catalog/{entity_type}/{item_id}`（改名）、`POST /admin/catalog/{entity_type}/{item_id}/deactivate`（软停用）、`GET /admin/catalog/{entity_type}/merge-impact?source_id&target_id`、`POST /admin/catalog/{entity_type}/merge`。`entity_type ∈ university | college | major | course | teacher | semester`。停用项不再进入前台选择器与检索，已关联资料仍可正常读取；合并先返回影响面再执行。变更写审计，不物理删除。
- `GET /admin/workbench`：新增权限 `ops.view`（仅管理员，不自动授予资料审核员）。只读聚合待审资料版本、未处理纠错、未处理投诉/举报、开放中求资料需求、失败事件与任务的数量与跳转地址；每条指标一条 COUNT，无逐条查询、无缓存、无定时任务。
- `0006_beta10_ops` 新增 `teachers.status`、`semesters.status`（`active/inactive/merged`），并扩展 `courses.status` 的 CHECK 增加 `inactive`。**不新增 domain event 类型**，不改 `ck_domain_events_event_type`。
- 规则推荐保留**固定探索槽位**（常量集中在 `interaction/recommendations.py` 顶部，均为待确认的默认值）：`limit>=4` 时启用、占 1 个槽位、插在第 3 条、候选为 `created_at` 30 天内且评价数 <3 的新内容、理由「新内容，供探索」；无合格候选时不占位。`RecommendationItem` 增加 `explore: bool`。探索项仍走同一套可见性/发布/审核/时效过滤，只改变排序位置。
- `POST /reports/comments`：`{resource_id, comment_id, reason}`，登录 + active 账号即可（不需新权限），理由 1–500 字；不能举报自己的评论；同一用户对同一评论至多一条未处理举报（`0007_beta10_interaction` 建局部唯一索引）。**复用 `report.created` / `report.resolved`，不新增 event_type。**
- `GET /admin/comment-reports`（游标分页）与 `POST /admin/comment-reports/{report_id}/decision`：`{action: accept|dismiss|resolve, reason, expected_revision, comment_revision?}`，需 `report.handle`。`resolve` 复用 beta8 的评论隐藏能力，隐藏与工单流转在同一事务内完成，不重复实现一套隐藏逻辑。
- `POST /comment-appeals`：`{resource_id, comment_id, reason}`，被隐藏评论的作者提交**一次**申诉（`uq_comment_appeals_comment`）；已撤回评论不可申诉。`GET /admin/comment-appeals` 与 `POST /admin/comment-appeals/{appeal_id}/decision`：`{decision: accept|reject, reason, expected_revision, comment_revision?}`，需 `report.handle`，采纳即恢复评论。
- 评论列表在作者本人与具备评论管理权限者视角额外返回 `moderation_reason`（管理员隐藏时给出的处理理由，只读自审计，不复制正文）；理由不对普通读者公开。

## ai

```python
async def request_process(
    db: AsyncSession, *, resource_id: uuid.UUID, version_id: uuid.UUID,
    kind: AIProcessKind, requested_by: uuid.UUID | None,
) -> AIProcess
# AI_ENABLED=false 时抛 NotEnabled，不返回假结果（§23、§25.2）。
async def process_result(db: AsyncSession, process_id: uuid.UUID) -> AIProcess
```
