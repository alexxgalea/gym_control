FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:$PATH" GYM_DATABASE=/data/gym_control.db
EXPOSE 8000
CMD ["uvicorn", "gym_control.app:app_from_env", "--factory", "--host", "0.0.0.0", "--port", "8000"]
