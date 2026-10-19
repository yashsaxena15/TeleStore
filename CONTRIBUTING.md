# Contributing to TeleStore

Thank you for contributing to TeleStore. This document outlines development practices, testing standards, code style, and deployment instructions.

---

## 1. Local Development Setup

### Prerequisites

- **Python**: 3.12+
- **Node.js**: 20+ and npm
- **Docker & Docker Compose**: For containerized database and app services
- **MongoDB**: 7.0+ (or run via Docker)

### Backend Setup

1. Create and activate a Python virtual environment:
   ```bash
   python3.12 -m venv .venv
   source .venv/bin/activate
   ```

2. Install backend dependencies and development tools:
   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   pip install pytest httpx ruff
   ```

3. Configure environment:
   Copy `.env.example` to `.env` and fill in the required values:
   - `SESSION_SECRET_KEY` (min 32 characters)
   - `WORKER_SECRET_KEY` (min 24 characters)
   - `DEFAULT_ADMIN_PASSWORD` (min 12 characters)
   - `DATABASE_URL` (e.g., `mongodb://127.0.0.1:27017/TeleStore`)
   - `API_ID`, `API_HASH`, and `TOKEN0` (Telegram credentials)

4. Run backend locally:
   ```bash
   python __main__.py
   ```

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run Vite development server:
   ```bash
   npm run dev
   ```

### Docker Compose (Local Dev)

To run the full stack locally with hot-reloading volume mounts:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

---

## 2. Testing

All tests must pass before submitting code.

### Backend Tests (Pytest)

Run backend tests using Pytest:
```bash
pytest
```

Backend tests use mocks for MongoDB and Telegram, running completely isolated without requiring a live database, Telegram connection, or `.env` file.

### Frontend Tests (Vitest)

Run frontend unit tests using Vitest:
```bash
cd frontend
npm test
```

---

## 3. Linting and Code Quality

### Backend Linting (Ruff)

Check Python code with Ruff:
```bash
ruff check .
```

Configuration is defined in `pyproject.toml`. Current active rules:
- `E9`: Syntax and fatal runtime errors
- `F821`: Undefined names
- `F811`: Redefinitions of unused imports / names
- `B006`: Mutable data structures for argument defaults

### Frontend Linting (ESLint)

Check JavaScript and JSX code with ESLint:
```bash
cd frontend
npm run lint
```

### Frontend Build Verification

Verify that Vite can build the production frontend bundle without errors:
```bash
cd frontend
npm run build
```

---

## 4. Architecture and Constraints

- **Frontend Technology**: The frontend is pure JavaScript (`.js` and `.jsx`). Do **not** introduce TypeScript (`.ts`/`.tsx`), `@types/*`, or `tsconfig.json`.
- **Security**: Never commit `.env` files, actual API keys, or credentials. All secrets must be loaded via environment variables and checked against minimum strength constraints.
- **Git Commits**: Use explicit file paths in `git add`. Never use `git add -A` or `git add .`. Do not commit scratch files, logs, or cache folders.

---

## 5. Deployment

Production deployment is container-based:
```bash
docker compose build app && docker compose up -d app
```

See [DEPLOY.md](file:///home/ubuntu/projects/TelegramFileServer/DEPLOY.md) for full operational instructions.
