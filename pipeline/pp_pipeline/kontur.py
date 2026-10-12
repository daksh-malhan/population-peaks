"""Kontur Population source files: listing, download with integrity checks, reading.

Kontur publishes one GeoPackage per country on HDX, gzipped on S3. Every URL is
checked against the bucket allowlist, every download against its S3 ETag (an MD5,
or a multipart MD5 with 8 MiB parts), and every row is validated before use.
"""

import gzip
import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator
from urllib.parse import urlsplit

import h3
import numpy as np

BUCKET_HOST = "geodata-eu-central-1-kontur-public.s3.amazonaws.com"
_PATH_RE = re.compile(r"^/kontur_datasets/kontur_population_([A-Z]{2})_(\d{8})\.gpkg\.gz$")
HDX_SEARCH = "https://data.humdata.org/api/3/action/package_search?fq=organization:kontur&q=title:population&rows=1000"
MULTIPART_CHUNK = 8 * 1024 * 1024
H3_RESOLUTION = 8
USER_AGENT = "population-peaks-pipeline/1.0 (+https://github.com/daksh-malhan/population-peaks)"


def check_source_url(url: str) -> re.Match:
    parts = urlsplit(url)
    match = _PATH_RE.match(parts.path)
    if parts.scheme != "https" or parts.hostname != BUCKET_HOST or parts.query or parts.fragment or not match:
        raise ValueError(f"not a Kontur population file URL: {url!r}")
    return match


def parse_hdx(payload: dict, version: str) -> list[dict]:
    """Per-country population files of one release from an HDX package_search response."""
    entries = {}
    for package in payload["result"]["results"]:
        for res in package.get("resources", []):
            url = res.get("url", "")
            try:
                match = check_source_url(url)
            except ValueError:
                continue
            if match.group(2) == version:
                entries[match.group(1)] = {"iso2": match.group(1), "url": url, "bytes": int(res.get("size") or 0)}
    return [entries[k] for k in sorted(entries)]


def _request(url: str, method: str = "GET"):
    req = urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT})
    return urllib.request.urlopen(req, timeout=120)  # noqa: S310 (https only, host allowlisted by callers)


def refresh_sources(version: str = "20231101") -> list[dict]:
    """Query HDX for the file list and record each file's size and ETag from S3."""
    with _request(HDX_SEARCH) as resp:
        entries = parse_hdx(json.load(resp), version)
    for e in entries:
        with _request(e["url"], method="HEAD") as resp:
            e["bytes"] = int(resp.headers["Content-Length"])
            e["etag"] = resp.headers["ETag"].strip('"')
    return entries


def verify_etag(path: Path, etag: str) -> bool:
    etag = etag.strip('"')
    if "-" in etag:
        digest, parts = etag.split("-", 1)
        md5s = []
        with open(path, "rb") as f:
            while block := f.read(MULTIPART_CHUNK):
                md5s.append(hashlib.md5(block).digest())
        return str(len(md5s)) == parts and hashlib.md5(b"".join(md5s)).hexdigest() == digest
    md5 = hashlib.md5()
    with open(path, "rb") as f:
        while block := f.read(1 << 20):
            md5.update(block)
    return md5.hexdigest() == etag


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(1 << 20):
            h.update(block)
    return h.hexdigest()


def download(entry: dict, cache: Path, retries: int = 3) -> Path:
    """Download one country's .gpkg.gz into cache (reusing a verified copy) and return its path."""
    check_source_url(entry["url"])
    cache.mkdir(parents=True, exist_ok=True)
    dest = cache / f"{entry['iso2']}.gpkg.gz"
    if dest.exists() and dest.stat().st_size == entry["bytes"] and verify_etag(dest, entry["etag"]):
        return dest
    tmp = dest.with_suffix(".part")
    for attempt in range(1, retries + 1):
        try:
            with _request(entry["url"]) as resp, open(tmp, "wb") as f:
                shutil.copyfileobj(resp, f, 1 << 20)
            if tmp.stat().st_size != entry["bytes"] or not verify_etag(tmp, entry["etag"]):
                raise OSError(f"integrity check failed for {entry['iso2']}")
            os.replace(tmp, dest)
            return dest
        except OSError:
            tmp.unlink(missing_ok=True)
            if attempt == retries:
                raise
            time.sleep(5 * attempt)
    raise AssertionError("unreachable")


def gunzip(src: Path, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(src, "rb") as fin, open(dest, "wb") as fout:
        shutil.copyfileobj(fin, fout, 1 << 20)
    return dest


@dataclass
class ReadStats:
    cells: int = 0
    skipped: int = 0


@dataclass
class CellChunk:
    cell: np.ndarray
    lat: np.ndarray
    lng: np.ndarray
    area: np.ndarray
    pop: np.ndarray


def read_cells(gpkg: Path, stats: ReadStats, chunk: int = 200_000) -> Iterator[CellChunk]:
    """Yield validated res-8 cells (id, centre, true area km², population) from a Kontur GeoPackage."""
    con = sqlite3.connect(f"{gpkg.resolve().as_uri()}?mode=ro", uri=True)
    try:
        cur = con.execute("SELECT h3, population FROM population")
        while rows := cur.fetchmany(chunk):
            ids, lats, lngs, areas, pops = [], [], [], [], []
            for text, pop in rows:
                try:
                    ok = (isinstance(text, str) and h3.is_valid_cell(text)
                          and h3.get_resolution(text) == H3_RESOLUTION
                          and isinstance(pop, (int, float)) and math.isfinite(pop) and pop >= 0)
                except (ValueError, TypeError, h3.H3BaseException):
                    ok = False
                if not ok:
                    stats.skipped += 1
                    continue
                lat, lng = h3.cell_to_latlng(text)
                ids.append(h3.str_to_int(text))
                lats.append(lat)
                lngs.append(lng)
                areas.append(h3.cell_area(text, "km^2"))
                pops.append(pop)
            stats.cells += len(ids)
            if ids:
                yield CellChunk(np.array(ids, dtype=np.uint64), np.array(lats), np.array(lngs),
                                np.array(areas), np.array(pops, dtype=np.float64))
    finally:
        con.close()
