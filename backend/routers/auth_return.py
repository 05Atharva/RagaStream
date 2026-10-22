"""
GET /auth/return: the page Google sign-in lands on before going back into the app.

Android's browser won't open another app (exp:// in Expo Go, ragastream:// in a
build) from a server redirect with no tap in between, so going straight from
Supabase to the app leaves the sign-in tab stuck loading. Supabase sends the
browser here instead. This page tries to open the app at once and shows a "Back
to RagaStream" button, which always works because it is a tap.

Public on purpose (the browser has no token here). It only forwards the sign-in
result to the app's own schemes, so it can't be used to send people elsewhere.
The PKCE `code` is useless without the verifier that never leaves the phone.
"""
from __future__ import annotations

import html
import re
from typing import Optional
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

router = APIRouter()

# Expo Go (exp://, exps://) and the native build's scheme. Nothing else.
_APP_URL = re.compile(r"^(exp|exps|ragastream)://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{1,400}$")

_PAGE = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>{title}</title>
<style>
*{{box-sizing:border-box}}
body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 20px;
background:#0B0F1A;color:#EEF1F8;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.5}}
main{{width:100%;max-width:420px}}
.brand{{font-weight:800;letter-spacing:.02em;color:#FF7A1A;margin:0 0 28px}}
h1{{font-size:30px;line-height:1.15;margin:0 0 12px;letter-spacing:-.5px}}
p{{margin:0 0 28px;color:#A3ACC2}}
a.btn{{display:flex;align-items:center;justify-content:center;min-height:52px;border-radius:999px;
background:#FF7A1A;color:#1A0B00;font-weight:700;font-size:17px;text-decoration:none}}
a.btn:focus-visible{{outline:2px solid #EEF1F8;outline-offset:3px}}
</style></head>
<body><main>
<p class="brand">RagaStream</p>
<h1>{heading}</h1>
<p>{body}</p>
{action}
</main>
{script}
</body></html>"""


def _page(title: str, heading: str, body: str, target: Optional[str], status: int = 200) -> HTMLResponse:
    action = f'<a class="btn" href="{html.escape(target, quote=True)}">Back to RagaStream</a>' if target else ""
    # json-style string literal for the script, escaped for an inline <script>.
    script = ""
    if target:
        js_target = target.replace("\\", "\\\\").replace('"', '\\"').replace("<", "\\u003c")
        script = f'<script>window.location.replace("{js_target}");</script>'
    content = _PAGE.format(title=html.escape(title), heading=html.escape(heading), body=html.escape(body),
                           action=action, script=script)
    return HTMLResponse(content, status_code=status, headers={
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; "
                                   "frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    })


def app_target(app: str, code: Optional[str], error: Optional[str], error_description: Optional[str]) -> Optional[str]:
    """The app URL with the sign-in result appended, or None if `app` isn't one of ours."""
    if not app or not _APP_URL.match(app):
        return None
    parts = urlsplit(app)
    if parts.scheme not in ("exp", "exps", "ragastream"):
        return None
    params = {k: v for k, v in (("code", code), ("error", error), ("error_description", error_description)) if v}
    if not params:
        return app
    return f"{app}{'&' if '?' in app else '?'}{urlencode(params)}"


@router.get("/auth/return", response_class=HTMLResponse, include_in_schema=False)
async def auth_return(
    app: str = Query("", max_length=400),
    code: Optional[str] = Query(None, max_length=512),
    error: Optional[str] = Query(None, max_length=200),
    error_description: Optional[str] = Query(None, max_length=500),
):
    target = app_target(app, code, error, error_description)
    if not target:
        return _page("Sign-in link problem", "This sign-in link isn't valid",
                     "Close this tab and sign in again from the app.", None, status=400)
    if error:
        return _page("Sign-in didn't finish", "Google sign-in didn't finish",
                     "Go back to the app and try again, or sign in with email.", target)
    return _page("Signed in", "You're signed in",
                 "Taking you back to RagaStream. If nothing happens, tap the button.", target)
