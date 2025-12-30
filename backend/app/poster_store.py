from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from .settings import Settings


@dataclass(frozen=True)
class SamplePoster:
    poster_id: str
    label: str
    page_url: str


SAMPLE_POSTERS: list[SamplePoster] = [
    SamplePoster("movie", "Sample Movie", "https://theposterdb.com/poster/9797"),
    SamplePoster("show", "Sample Series", "https://theposterdb.com/poster/357913"),
]


def _poster_dir(settings: Settings) -> Path:
    return settings.data_dir / "posters"


def _fetch_page(url: str) -> str:
    req = Request(url, headers={"User-Agent": "KometaUI/1.0"})
    with urlopen(req) as resp:  # noqa: S310 - URL is fixed
        return resp.read().decode("utf-8", errors="replace")


def _extract_image_url(html: str) -> str | None:
    match = re.search(r'property="og:image" content="([^"]+)"', html)
    if match:
        return match.group(1)
    match = re.search(r'name="twitter:image" content="([^"]+)"', html)
    if match:
        return match.group(1)
    return None


def _download_image(url: str, dest: Path) -> None:
    req = Request(url, headers={"User-Agent": "KometaUI/1.0"})
    with urlopen(req) as resp:  # noqa: S310 - URL is fixed
        dest.write_bytes(resp.read())


def _ensure_poster(settings: Settings, poster: SamplePoster) -> Path:
    poster_dir = _poster_dir(settings)
    poster_dir.mkdir(parents=True, exist_ok=True)

    html = _fetch_page(poster.page_url)
    image_url = _extract_image_url(html)
    if not image_url:
        raise RuntimeError("PosterDB image not found")

    extension = Path(urlparse(image_url).path).suffix or ".jpg"
    filename = f"posterdb-{poster.poster_id}{extension}"
    dest = poster_dir / filename
    if not dest.exists():
        _download_image(image_url, dest)
    return dest


def list_sample_posters(settings: Settings) -> list[dict]:
    posters = []
    for poster in SAMPLE_POSTERS:
        path = _ensure_poster(settings, poster)
        posters.append(
            {
                "id": poster.poster_id,
                "label": poster.label,
                "filename": path.name,
            }
        )
    return posters


def get_sample_poster_path(settings: Settings, poster_id: str) -> Path | None:
    poster_map = {poster.poster_id: poster for poster in SAMPLE_POSTERS}
    poster = poster_map.get(poster_id)
    if not poster:
        return None
    path = _ensure_poster(settings, poster)
    return path
