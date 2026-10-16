"""运营任务工作台 DTO（设计文档 §27）。

对外只返回计数与跳转路径，不返回工单内容、操作者或敏感载荷。
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class WorkbenchItem(BaseModel):
    """单个待办指标：名称、数量与可跳转的前台/后台路径。"""

    key: str
    label: str
    count: int
    href: str


class WorkbenchOut(BaseModel):
    """工作台一次请求返回全部待办计数，避免逐条 N+1 查询。"""

    items: list[WorkbenchItem]
    total: int
    generated_at: datetime


class OpsAlertOut(BaseModel):
    """单条运营告警：达到阈值的指标、当前计数与可跳转路径。"""

    key: str
    label: str
    count: int
    href: str
    level: str  # "warning" | "critical"
    threshold: int


class OpsAlertsOut(BaseModel):
    """运营告警列表：只读聚合，达到阈值的指标才出现，供管理员优先处置。"""

    alerts: list[OpsAlertOut]
    has_critical: bool
    generated_at: datetime
