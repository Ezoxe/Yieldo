"""A tool with no route of its own: its schema and the coroutine that runs it."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.models import User

CustomRun = Callable[[Session, User, dict[str, Any]], Awaitable[tuple[int, Any]]]


@dataclass(frozen=True)
class CustomTool:
    schema: dict[str, Any]
    required: tuple[str, ...]
    run: CustomRun
