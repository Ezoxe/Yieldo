"""A tool's input schema, read from the route it points at.

The route already declares exactly what it accepts -- path parameters, query
parameters and a JSON body -- in the OpenAPI document FastAPI builds. Reading
the schema from there rather than writing it a second time means a field
added to a route reaches the tool by itself, and a tool can never accept what
its route would refuse.

A tool's arguments are one flat object: the path parameters, the query
parameters, then the body's own fields. A body that is not an object (a list,
for `PUT /portfolio/targets`) is the single argument `corps`.
"""

import copy
from dataclasses import dataclass, field
from functools import cache
from typing import Any

WHOLE_BODY = "corps"
_MAX_DEPTH = 12


@dataclass(frozen=True)
class ArgumentPlan:
    """Where each argument of a tool goes on the route."""

    path: tuple[str, ...] = ()
    query: tuple[str, ...] = ()
    body_fields: tuple[str, ...] = ()
    whole_body: bool = False
    has_body: bool = False
    required: tuple[str, ...] = ()
    schema: dict[str, Any] = field(default_factory=dict)

    @property
    def names(self) -> set[str]:
        names = set(self.path) | set(self.query) | set(self.body_fields)
        if self.whole_body:
            names.add(WHOLE_BODY)
        return names


@cache
def _openapi() -> dict[str, Any]:
    from app.main import app

    return app.openapi()


def _inline(node: Any, components: dict[str, Any], depth: int = 0) -> Any:
    """Replace every `$ref` by the schema it names. A self-referencing schema
    stops at `_MAX_DEPTH` as an open object rather than recursing forever."""
    if depth > _MAX_DEPTH:
        return {"type": "object"}
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            target = components[ref.rsplit("/", 1)[1]]
            merged = {**copy.deepcopy(target), **{k: v for k, v in node.items() if k != "$ref"}}
            return _inline(merged, components, depth + 1)
        return {key: _inline(value, components, depth + 1) for key, value in node.items()}
    if isinstance(node, list):
        return [_inline(item, components, depth + 1) for item in node]
    return node


def plan_for(method: str, path: str) -> ArgumentPlan:
    """The argument plan for `method path` (path relative to /api)."""
    document = _openapi()
    components = document.get("components", {}).get("schemas", {})
    operation = document["paths"][f"/api{path}"][method.lower()]

    properties: dict[str, Any] = {}
    required: list[str] = []
    path_names: list[str] = []
    query_names: list[str] = []
    for parameter in operation.get("parameters", []):
        location = parameter.get("in")
        if location not in ("path", "query"):
            continue
        name = parameter["name"]
        schema = _inline(parameter.get("schema", {}), components)
        if parameter.get("description"):
            schema.setdefault("description", parameter["description"])
        properties[name] = schema
        (path_names if location == "path" else query_names).append(name)
        if parameter.get("required"):
            required.append(name)

    body_fields: list[str] = []
    whole_body = False
    has_body = False
    content = operation.get("requestBody", {}).get("content", {})
    if "application/json" in content:
        has_body = True
        body = _inline(content["application/json"].get("schema", {}), components)
        body_required = operation["requestBody"].get("required", False)
        if body.get("type") == "object" and isinstance(body.get("properties"), dict):
            for name, schema in body["properties"].items():
                if name in properties:
                    raise ValueError(
                        f"{method} {path} : « {name} » est à la fois paramètre et champ")
                properties[name] = schema
                body_fields.append(name)
            required.extend(body.get("required", []))
        else:
            properties[WHOLE_BODY] = body
            whole_body = True
            if body_required:
                required.append(WHOLE_BODY)

    schema = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        schema["required"] = required
    return ArgumentPlan(
        path=tuple(path_names), query=tuple(query_names), body_fields=tuple(body_fields),
        whole_body=whole_body, has_body=has_body, required=tuple(required), schema=schema,
    )
