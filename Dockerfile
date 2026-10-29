# Stadiul 1: build-ul SPA-ului Admin (Node există doar aici, nu în imaginea finală).
FROM node:22-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npx vite build

# Stadiul 2: imaginea finală, doar Python; servește build-ul la /admin/.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev
COPY --from=frontend /frontend/dist ./frontend-dist
ENV PATH="/app/.venv/bin:$PATH" GYM_DATABASE=/data/gym_control.db GYM_FRONTEND_DIST=/app/frontend-dist
EXPOSE 8000
CMD ["uvicorn", "gym_control.app:app_from_env", "--factory", "--host", "0.0.0.0", "--port", "8000"]
