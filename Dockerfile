# Stage 1: Build frontend
FROM node:20-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && \
    apt-get install -y gcc libffi-dev build-essential ffmpeg p7zip-full aria2 && \
    rm -rf /var/lib/apt/lists/*
# Deno: the JavaScript runtime yt-dlp needs for YouTube
COPY --from=denoland/deno:bin-2.5.6 /deno /usr/local/bin/deno
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
COPY --from=frontend-build /frontend/dist ./frontend/dist
# Not root: a bug in the app can then only touch the app's own files. uid 1001 owns the mounted
# cache/ and tg_files/ folders on the server (TELESTORE_UID changes it at build time).
ARG TELESTORE_UID=1001
RUN useradd --uid ${TELESTORE_UID} --create-home telestore && \
    mkdir -p /app/temp_archives /app/cache /app/tg_files && \
    chown -R telestore:telestore /app
USER telestore
CMD ["python", "-m", "telestore"]
