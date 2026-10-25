"""From a tool call to the route it names, and back.

`replay` sends the call through the application itself (`httpx.ASGITransport`,
in process), with the caller's own `Authorization` header. The route then
does everything it does for the screen -- validation, the French errors, the
`user_id` filter, the ledger mode -- and the connector adds nothing to it
but the mapping of arguments.

`CUSTOM_TOOLS` holds the tools that have no route of their own.
"""

from functools import cache
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import HTTPException

from app.connector.catalog import CATALOG, CUSTOM, ToolDef
from app.connector.custom import CustomTool
from app.connector.prepared_import import PREPARE_IMPORT
from app.connector.schema import WHOLE_BODY, ArgumentPlan, plan_for

CUSTOM_TOOLS: dict[str, CustomTool] = {"yieldo_import_preparer": PREPARE_IMPORT}


def tool_named(name: str) -> ToolDef:
    tool = CATALOG.get(name)
    if tool is None:
        raise HTTPException(
            status_code=404,
            detail=f"Outil inconnu : {name}. La liste est sur GET /api/connector/tools.",
        )
    return tool


@cache
def _plan(name: str) -> ArgumentPlan:
    tool = CATALOG[name]
    return plan_for(tool.method, tool.path)


def check_arguments(tool: ToolDef, args: dict[str, Any]) -> None:
    """Refuse an argument the tool does not take, or a required one missing,
    before anything is read or written -- and before EZLink asks anyone to
    approve a call that could only fail."""
    if tool.path == CUSTOM:
        custom = CUSTOM_TOOLS[tool.name]
        allowed = set(custom.schema.get("properties", {}))
        required: tuple[str, ...] = custom.required
    else:
        plan = _plan(tool.name)
        allowed = plan.names
        required = plan.required
    unknown = sorted(set(args) - allowed)
    if unknown:
        raise HTTPException(
            status_code=422, detail=f"Argument inconnu pour {tool.name} : {', '.join(unknown)}."
        )
    missing = [name for name in required if name not in args]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Argument requis manquant pour {tool.name} : {', '.join(missing)}.",
        )


def build_request(
    tool: ToolDef, args: dict[str, Any]
) -> tuple[str, dict[str, Any], Any]:
    """`(path, query, json_body)` for this call. `json_body` is None when the
    route takes no body."""
    plan = _plan(tool.name)
    path = tool.path
    for name in plan.path:
        path = path.replace("{" + name + "}", quote(str(args[name]), safe=""))
    query = {name: args[name] for name in plan.query if name in args}
    body: Any = None
    if plan.whole_body:
        body = args.get(WHOLE_BODY)
    elif plan.has_body:
        body = {name: args[name] for name in plan.body_fields if name in args}
    return path, query, body


async def replay(tool: ToolDef, args: dict[str, Any], authorization: str) -> tuple[int, Any]:
    from app.main import app

    path, query, body = build_request(tool, args)
    transport = httpx.ASGITransport(app=app)
    base_url = "http://connector.internal"
    async with httpx.AsyncClient(transport=transport, base_url=base_url) as client:
        response = await client.request(
            tool.method,
            f"/api{path}",
            params=query,
            json=body,
            headers={"Authorization": authorization},
        )
    if response.status_code == 204 or not response.content:
        return response.status_code, None
    try:
        return response.status_code, response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"{tool.name} : la route a répondu autre chose que du JSON.",
        ) from exc
