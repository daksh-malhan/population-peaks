"""Fetching and pinning the place sources (Natural Earth, GeoNames) and writing the manifest."""

import hashlib
import json
import re
import shutil
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "sources" / "places_sources.json"
_NE_PATH = re.compile(r"^/nvkelso/natural-earth-vector/[0-9a-f]{40}/geojson/[a-z0-9_]+\.geojson$")
_GN_PATH = re.compile(r"^/export/dump/cities15000\.zip$")
USER_AGENT = "population-peaks-pipeline/1.0 (+https://github.com/daksh-malhan/population-peaks)"


def check_place_url(url: str) -> None:
    parts = urlsplit(url)
    ok = parts.scheme == "https" and not parts.query and not parts.fragment and (
        (parts.hostname == "raw.githubusercontent.com" and _NE_PATH.match(parts.path))
        or (parts.hostname == "download.geonames.org" and _GN_PATH.match(parts.path)))
    if not ok:
        raise ValueError(f"not an allowed place source URL: {url!r}")


def git_blob_sha(path: Path) -> str:
    data = path.read_bytes()
    return hashlib.sha1(b"blob %d\x00" % len(data) + data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(1 << 20):
            h.update(block)
    return h.hexdigest()


def _download(url: str, dest: Path) -> None:
    check_place_url(url)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=300) as resp, open(tmp, "wb") as f:  # noqa: S310 (allowlisted)
        shutil.copyfileobj(resp, f, 1 << 20)
    tmp.replace(dest)


def fetch_place_sources(src: Path, povs: set[str] | None = None, log=print) -> dict[str, str]:
    """Download Natural Earth (verified against pinned git blob hashes) and GeoNames into src."""
    conf = json.loads(CONFIG.read_text())
    ne = conf["natural_earth"]
    src.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for name, meta in ne["files"].items():
        pov = re.match(r"ne_10m_admin_0_countries_([a-z]{3})\.geojson$", name)
        if pov and povs is not None and pov.group(1) not in povs:
            continue
        dest = src / name
        if not (dest.exists() and git_blob_sha(dest) == meta["git_sha"]):
            log(f"  fetching {name}")
            _download(f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{ne['commit']}/geojson/{name}", dest)
            if git_blob_sha(dest) != meta["git_sha"]:
                dest.unlink()
                raise OSError(f"{name} does not match the pinned Natural Earth blob")
        hashes[name] = meta["git_sha"]
    gn = src / "cities15000.zip"
    if not gn.exists():
        log("  fetching cities15000.zip")
        _download(conf["geonames"]["url"], gn)
    hashes["cities15000.zip"] = sha256_file(gn)
    return hashes


def build_manifest(out: Path, version: str, countries: list[dict], povs: dict, tz_pov: dict,
                   place_hashes: dict, built_at: str | None = None) -> dict:
    index = json.loads((out / "tiles" / "index.json").read_text())
    kontur_used = {}
    if (out / "tiles" / "sources.json").exists():
        kontur_used = json.loads((out / "tiles" / "sources.json").read_text())
    conf = json.loads(CONFIG.read_text())
    manifest = {
        "v": 1,
        "dataVersion": version,
        "builtAt": built_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tiles": {"minZoom": 0, "maxZoom": index["maxZoom"], "size": 256, "scale": 256, "encoding": "zlib-u16le-log1p"},
        "tileIndex": index["bits"],
        "countries": [{**c, "preview": False} for c in countries],
        "povs": povs,
        "tzPov": tz_pov,
        "sources": [
            {"name": "Kontur Population", "version": "2023-11-01", "license": "CC BY 4.0",
             "url": "https://data.humdata.org/dataset/kontur-population-dataset",
             "files": {k: v["sha256"] for k, v in sorted(kontur_used.items())}},
            {"name": "Natural Earth", "version": conf["natural_earth"]["version"], "license": "Public domain",
             "url": "https://www.naturalearthdata.com/",
             "files": {k: v for k, v in sorted(place_hashes.items()) if k.endswith(".geojson")}},
            {"name": "GeoNames", "version": "cities15000", "license": "CC BY 4.0", "url": "https://www.geonames.org/",
             "files": {k: v for k, v in place_hashes.items() if k.endswith(".zip")}},
        ],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")))
    return manifest
