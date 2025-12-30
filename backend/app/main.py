from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse

from .auth import AuthMiddleware
from .db import init_db
from .routes import config, files, health, logs, overlay_preview, posters, runs
from .settings import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    settings.validate()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.log_dir.mkdir(parents=True, exist_ok=True)
    init_db(settings)

    app = FastAPI(title="Kometa UI")
    app.add_middleware(AuthMiddleware, settings=settings)

    app.include_router(health.router, prefix="/api")
    app.include_router(config.router, prefix="/api")
    app.include_router(files.router, prefix="/api")
    app.include_router(posters.router, prefix="/api")
    app.include_router(overlay_preview.router, prefix="/api")
    app.include_router(runs.router, prefix="/api")
    app.include_router(logs.router, prefix="/api")

    static_dir = Path(__file__).parent / "static"
    if static_dir.exists():
        class SPAStaticFiles(StaticFiles):
            async def get_response(self, path: str, scope):  # type: ignore[override]
                response = await super().get_response(path, scope)
                if response.status_code == 404:
                    return await super().get_response("index.html", scope)
                return response

        app.mount("/", SPAStaticFiles(directory=static_dir, html=True), name="static")
    else:
        @app.get("/")
        def index() -> HTMLResponse:
            return HTMLResponse("Kometa UI backend is running.")

    return app


app = create_app()
