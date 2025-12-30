FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY backend/pyproject.toml /app/backend/pyproject.toml
COPY backend/app /app/backend/app
RUN pip install --no-cache-dir /app/backend

COPY --from=frontend-build /frontend/dist /app/backend/app/static
COPY docker/entrypoint.sh /entrypoint.sh

ENV PORT=6161 \
    DATA_DIR=/data \
    CONFIG_FILE=/config/config.yml \
    LOG_DIR=/logs

EXPOSE 6161
ENTRYPOINT ["/entrypoint.sh"]
