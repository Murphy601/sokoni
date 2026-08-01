"""
Sokoni rembg sidecar (Phase 1+).

Endpoints:
  GET  /health      → liveness (bot must keep running if this is down)
  POST /api/remove  → multipart file → PNG with background removed

Not used on the WhatsApp hot path — only seller listing studio via Node.
"""
from __future__ import annotations

import os
from io import BytesIO

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image
from rembg import new_session, remove

MAX_BYTES = int(os.environ.get("REMBG_MAX_BYTES", str(12 * 1024 * 1024)))
MAX_SIDE = int(os.environ.get("REMBG_MAX_SIDE", "1600"))
MODEL = os.environ.get("REMBG_MODEL", "u2net")

app = FastAPI(title="Sokoni rembg", version="1.0.0")
_session = None


def get_session():
    global _session
    if _session is None:
        _session = new_session(MODEL)
    return _session


@app.on_event("startup")
def warmup():
    # Load model once so first seller request is not a cold 30s stall.
    try:
        get_session()
    except Exception as exc:  # pragma: no cover
        print(f"[rembg] warmup warning: {exc}")


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "sokoni-rembg",
        "model": MODEL,
        "maxBytes": MAX_BYTES,
        "maxSide": MAX_SIDE,
    }


def _downscale(raw: bytes) -> bytes:
    img = Image.open(BytesIO(raw))
    img.load()
    w, h = img.size
    longest = max(w, h)
    if longest <= MAX_SIDE:
        return raw
    scale = MAX_SIDE / float(longest)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    img = img.convert("RGBA") if img.mode in ("P", "LA") else img
    img = img.resize((nw, nh), Image.Resampling.LANCZOS)
    buf = BytesIO()
    # JPEG for opaque, PNG if alpha
    if img.mode in ("RGBA", "LA"):
        img.save(buf, format="PNG", optimize=True)
    else:
        img.convert("RGB").save(buf, format="JPEG", quality=90)
    return buf.getvalue()


@app.post("/api/remove")
async def api_remove(file: UploadFile = File(...)):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty_file")
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="file_too_large")

    try:
        prepared = _downscale(raw)
        out = remove(prepared, session=get_session())
    except Exception as exc:
        print(f"[rembg] remove failed: {exc}")
        raise HTTPException(status_code=422, detail="remove_failed") from exc

    if not out:
        raise HTTPException(status_code=422, detail="empty_result")

    return Response(content=out, media_type="image/png")


@app.get("/")
def root():
    return JSONResponse({"service": "sokoni-rembg", "health": "/health", "remove": "POST /api/remove"})
