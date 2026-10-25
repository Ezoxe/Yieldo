"""Every route under `/api`, as `(method, path) -> APIRoute`.

FastAPI 0.141 keeps an included router as a branch rather than copying its
routes onto the parent, so `app.routes` alone does not list them: the walk
goes down `original_router` wherever a branch has one.
"""

from collections.abc import Iterator
from functools import cache

from fastapi.routing import APIRoute
from starlette.routing import BaseRoute


def _walk(routes: list[BaseRoute]) -> Iterator[APIRoute]:
    for route in routes:
        branch = getattr(route, "original_router", None)
        if branch is not None:
            yield from _walk(branch.routes)
        elif isinstance(route, APIRoute):
            yield route


def _full_path(route: APIRoute) -> str:
    return route.path if route.path.startswith("/api") else f"/api{route.path}"


@cache
def api_routes() -> dict[tuple[str, str], APIRoute]:
    """Keyed by (METHOD, path relative to /api), e.g. ("GET", "/budgets")."""
    from app.main import api  # the router that owns every /api route

    index: dict[tuple[str, str], APIRoute] = {}
    for route in _walk(api.routes):
        relative = _full_path(route).removeprefix("/api")
        for method in route.methods or ():
            if method != "HEAD":
                index[(method, relative)] = route
    return index


def dependencies_of(route: APIRoute) -> set[object]:
    """Every callable this route depends on, however deep."""
    seen: set[object] = set()
    stack = list(route.dependant.dependencies)
    while stack:
        dependant = stack.pop()
        seen.add(dependant.call)
        stack.extend(dependant.dependencies)
    return seen
