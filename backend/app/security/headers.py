"""Headers every response carries, and the policy the interface runs under.

Pure ASGI rather than Starlette's `BaseHTTPMiddleware`, which buffers
streaming responses and changes how exceptions propagate; this only adds
headers to the response-start message and touches nothing else.

The Content-Security-Policy goes on the INTERFACE only -- everything outside
`/api`, which `main.serve_spa` answers. The JSON routes have no document to
protect, and `/api/docs` loads Swagger from a CDN that the policy would block.

What the policy allows, and why each exception exists:

* `style-src 'unsafe-inline'` -- ECharts and the motion library set element
  styles at run time; a nonce cannot follow them there;
* `img-src data: blob:` and `worker-src blob:` -- chart exports and canvases;
* `font-src data:` -- a bundled font the build may inline.

Everything else is `'self'`: no script, style, frame or connection to any
other origin, and no page anywhere may frame Yieldo.
"""

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

BASE_HEADERS: dict[str, str] = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}

INTERFACE_POLICY = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])


def headers_for(path: str) -> dict[str, str]:
    headers = dict(BASE_HEADERS)
    if not (path == "/api" or path.startswith("/api/")):
        headers["Content-Security-Policy"] = INTERFACE_POLICY
    return headers


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        extra = headers_for(scope["path"])

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in extra.items():
                    headers.setdefault(name, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)
