# 跨模块接口声明

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
```

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
- `POST /me/avatar`：`multipart/form-data` 单文件字段 `file`，仅接受 PNG/JPEG/WebP 且不超过 `AVATAR_MAX_SIZE_BYTES`（默认 2 MiB）。按真实字节用 Pillow 校验格式，写入公开桶 `S3_BUCKET_PUBLIC` 并返回更新后的 `MeResponse`；地址由 `S3_PUBLIC_BASE_URL`（留空时回退 `S3_PUBLIC_ENDPOINT_URL` + 桶名）拼装。头像不走隔离区扫描，也不能用它替代资料文件上传。

## ai

```python
async def request_process(
    db: AsyncSession, *, resource_id: uuid.UUID, version_id: uuid.UUID,
    kind: AIProcessKind, requested_by: uuid.UUID | None,
) -> AIProcess
# AI_ENABLED=false 时抛 NotEnabled，不返回假结果（§23、§25.2）。
async def process_result(db: AsyncSession, process_id: uuid.UUID) -> AIProcess
```
