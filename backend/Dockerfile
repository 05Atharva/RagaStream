# RagaStream API: FastAPI + yt-dlp. Used by Render (render.yaml) and any Docker host.

# yt-dlp solves YouTube's signature challenges with a JavaScript runtime
# (routers/youtube.py sets js_runtimes={"node": {}}). Without Node, streams fail.
FROM node:22-bookworm-slim AS node

FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN node --version

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Render provides $PORT. One worker on purpose: caches, signed-link secrets fallback
# and import jobs live in memory and must be shared by every request.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --workers 1"]
