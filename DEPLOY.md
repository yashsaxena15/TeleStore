# TeleStore Deployment & Operations Guide

This guide covers deployment workflows for TeleStore in production and development environments.

---

## 1. Production Deployment

In production, the application runs from built Docker images (`docker-compose.yml` is image-only, mounting only persistent volumes for `./cache` and `./src/frontend/dist`).

### Deploying Updates

When code changes are pushed or pulled:

```bash
# 1. Build the updated image (builds React frontend and packages Python backend)
docker compose build app

# 2. Recreate and start the app container seamlessly
docker compose up -d app

# 3. Verify health status
curl -f http://127.0.0.1:9000/api/health
```

### Viewing Logs

```bash
docker compose logs -f --tail=100 app
```

---

## 2. Local Development with Live Code Mounts

For active local development where backend and frontend code edits should reflect without rebuilding images, use the development compose override file (`docker-compose.dev.yml`).

### Starting Development Environment

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### Stopping Development Containers

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

---

## 3. Environment Secrets Checklist

Ensure the `.env` file contains strong, non-default values for:

| Variable | Description | Minimum Length |
|---|---|---|
| `SESSION_SECRET_KEY` | Secret for Starlette session cookie encryption | 32 characters |
| `WORKER_SECRET_KEY` | Header key for distributed worker authentication | 24 characters |
| `DEFAULT_ADMIN_PASSWORD` | Fallback administrator password | 12 characters |
| `DATABASE_URL` | MongoDB connection URI (`mongodb://mongo:27017/TeleStore`) | Required |
| `API_ID` & `API_HASH` | Telegram API credentials from my.telegram.org | Required |
| `TOKEN0` ... `TOKEN19` | Telegram Bot tokens for the bot pool | At least 1 token |
| `GITHUB_WEBHOOK_SECRET` | Secret for auto-update webhook (optional) | Strong secret if enabled |
