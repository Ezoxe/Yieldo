"""/api/connector -- the three endpoints EZLink's Yieldo agent calls.

`GET /tools` publishes the catalogue, `POST /describe` turns a call into the
sentence an approval shows (writing nothing), `POST /call` runs it.

Only a `ycn_` key opens this router (`get_connector_user`). The tier of each
tool is EZLink's to enforce -- it asks the household on Discord before an
`approve` call -- and Yieldo holds its own side of it: an `approve` call that
arrives without the approval's id is refused here, and every route the
catalogue leaves out stays out whatever EZLink sends.
"""

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.connector.catalog import CUSTOM, catalog_payload, fingerprint
from app.connector.describe import arguments_text
from app.connector.dispatch import CUSTOM_TOOLS, check_arguments, replay, tool_named
from app.db import get_db
from app.models import ConnectorAction, User
from app.security.deps import get_connector_user

router = APIRouter(prefix="/connector", tags=["connector"])

# Past this, an answer is too long for a model to read whole; the tool is
# asked to narrow it. Only reads are capped: a write has already happened.
MAX_RESPONSE_CHARS = 100_000


class DescribeIn(BaseModel):
    tool: str = Field(max_length=64)
    args: dict[str, Any] = Field(default_factory=dict)


class CallIn(DescribeIn):
    approval_id: str | None = Field(default=None, max_length=64)


@router.get("/tools")
def list_tools(_user: User = Depends(get_connector_user)) -> dict[str, Any]:
    return catalog_payload()


@router.post("/describe")
def describe_call(
    payload: DescribeIn,
    user: User = Depends(get_connector_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    tool = tool_named(payload.tool)
    check_arguments(tool, payload.args)
    if tool.describer is not None:
        summary = tool.describer(db, user, payload.args)
    else:
        details = arguments_text(payload.args)
        summary = f"{tool.title} {details}".strip() if details else tool.title
    return {"tool": tool.name, "tier": tool.tier, "summary": summary}


@router.post("/call")
async def call_tool(
    payload: CallIn,
    request: Request,
    user: User = Depends(get_connector_user),
    db: Session = Depends(get_db),
) -> JSONResponse:
    tool = tool_named(payload.tool)
    check_arguments(tool, payload.args)
    if tool.tier == "approve" and not payload.approval_id:
        raise HTTPException(
            status_code=403,
            detail="Cette action demande votre validation sur Discord : elle passe par EZLink.",
        )

    if tool.path == CUSTOM:
        status_code, body = await CUSTOM_TOOLS[tool.name].run(db, user, payload.args)
    else:
        status_code, body = await replay(tool, payload.args, request.headers["Authorization"])

    if tool.tier != "read":
        db.add(ConnectorAction(
            user_id=user.id, tool=tool.name, args=payload.args,
            approval_id=payload.approval_id, status_code=status_code,
        ))
        db.commit()
    elif len(json.dumps(body, ensure_ascii=False, default=str)) > MAX_RESPONSE_CHARS:
        raise HTTPException(
            status_code=413,
            detail="Réponse trop longue : resserrez avec limit et offset, ou une période plus "
                   "courte.",
        )

    content: dict[str, Any] = {"status": status_code, "body": body, "fingerprint": fingerprint()}
    if status_code >= 400 and isinstance(body, dict) and "detail" in body:
        content["detail"] = body["detail"]
    return JSONResponse(status_code=status_code, content=content)
