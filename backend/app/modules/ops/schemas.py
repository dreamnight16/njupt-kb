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
