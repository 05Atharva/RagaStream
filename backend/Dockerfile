# ── Stage: builder ────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /app

# Install system deps needed by yt-dlp and some Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies into /install for clean copy
COPY requirements.txt .
RUN pip install --prefix=/install --no-cache-dir -r requirements.txt


# ── Stage: runtime ────────────────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# ffmpeg required at runtime by yt-dlp for audio post-processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages and app source
COPY --from=builder /install /usr/local
COPY . .

# Non-root user for security
RUN useradd -m appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
