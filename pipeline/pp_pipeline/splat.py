"""Spread each H3 cell's population over the z7 Mercator pixels its footprint covers.

A cell is modelled as an axis-aligned square with the cell's true area, centred on
the cell centre. Each pixel receives the exact share of that square it overlaps,
so population (mass) is conserved and no pixel between neighbouring cells is left
empty, even at high latitudes where pixels are smaller than cells.

The world at z7 is 32768 px wide, so it is processed in shards: one z3 tile
(4096 x 4096 px at z7) at a time. A cell whose footprint crosses a shard edge is
routed to every shard it touches and each shard keeps only its own pixels.
"""

import numpy as np

from . import mercator as m

MAX_ZOOM = m.MAX_ZOOM
SHARD_ZOOM = 3
SHARD_PX = m.TILE_SIZE << (MAX_ZOOM - SHARD_ZOOM)
SHARDS = 1 << SHARD_ZOOM
WORLD_PX = m.world_px(MAX_ZOOM)
RECORD = np.dtype([("x", "<f8"), ("y", "<f8"), ("s", "<f4"), ("pop", "<f4"), ("cell", "<u8")])
_CHUNK = 1_000_000


def cell_records(lat, lng, area_km2, pop, cell=None) -> np.ndarray:
    """Global z7 pixel position, footprint side (px), population and H3 id for each cell."""
    lat = np.asarray(lat, dtype=np.float64)
    rec = np.empty(lat.shape[0], dtype=RECORD)
    rec["x"] = m.lng_to_x(lng, MAX_ZOOM)
    rec["y"] = m.lat_to_y(lat, MAX_ZOOM)
    rec["s"] = np.sqrt(np.asarray(area_km2, dtype=np.float64)) / m.pixel_size_km(lat, MAX_ZOOM)
    rec["pop"] = pop
    rec["cell"] = 0 if cell is None else cell
    return rec


def dedupe(rec: np.ndarray) -> np.ndarray:
    """Keep one record per H3 cell. Kontur's per-country files repeat border cells."""
    _, first = np.unique(rec["cell"], return_index=True)
    return rec[np.sort(first)]


def route_to_shards(rec: np.ndarray) -> dict[tuple[int, int], np.ndarray]:
    """Group records by every shard their footprint touches, wrapping across the antimeridian."""
    half = rec["s"].astype(np.float64) / 2
    x0, x1 = rec["x"] - half, rec["x"] + half
    y0, y1 = rec["y"] - half, rec["y"] + half
    sx0 = np.floor(x0 / SHARD_PX).astype(np.int64)
    sx1 = np.floor(np.nextafter(x1, -np.inf) / SHARD_PX).astype(np.int64)
    sy0 = np.clip(np.floor(y0 / SHARD_PX), 0, SHARDS - 1).astype(np.int64)
    sy1 = np.clip(np.floor(np.nextafter(y1, -np.inf) / SHARD_PX), 0, SHARDS - 1).astype(np.int64)

    out: dict[tuple[int, int], list[np.ndarray]] = {}
    for dsx in (0, 1):
        for dsy in (0, 1):
            sx, sy = sx0 + dsx, sy0 + dsy
            sel = (sx <= sx1) & (sy <= sy1)
            if not sel.any():
                continue
            part = rec[sel].copy()
            wrap = np.floor_divide(sx[sel], SHARDS)
            part["x"] -= wrap * WORLD_PX
            keys = np.stack([sx[sel] - wrap * SHARDS, sy[sel]], axis=1)
            for key in np.unique(keys, axis=0):
                hit = (keys[:, 0] == key[0]) & (keys[:, 1] == key[1])
                out.setdefault((int(key[0]), int(key[1])), []).append(part[hit])
    return {k: np.concatenate(v) for k, v in out.items()}


def splat_shard(rec: np.ndarray, sx: int, sy: int) -> np.ndarray:
    """Population per pixel (float64, SHARD_PX x SHARD_PX) for the records of one shard."""
    acc = np.zeros(SHARD_PX * SHARD_PX, dtype=np.float64)
    for start in range(0, rec.shape[0], _CHUNK):
        _splat_chunk(rec[start : start + _CHUNK], sx, sy, acc)
    return acc.reshape(SHARD_PX, SHARD_PX)


def _splat_chunk(rec: np.ndarray, sx: int, sy: int, acc: np.ndarray) -> None:
    s = np.maximum(rec["s"].astype(np.float64), 1e-6)
    x = rec["x"] - sx * SHARD_PX
    y = rec["y"] - sy * SHARD_PX
    x0, x1, y0, y1 = x - s / 2, x + s / 2, y - s / 2, y + s / 2
    bx, by = np.floor(x0).astype(np.int64), np.floor(y0).astype(np.int64)
    span = np.maximum(np.ceil(x1) - bx, np.ceil(y1) - by).astype(np.int64)
    weight = rec["pop"].astype(np.float64) / (s * s)

    for k in np.unique(span):
        g = span == k
        gx0, gx1, gy0, gy1 = x0[g], x1[g], y0[g], y1[g]
        gbx, gby, gw = bx[g], by[g], weight[g]
        idx, val = [], []
        for dx in range(k):
            px = gbx + dx
            wx = np.clip(np.minimum(gx1, px + 1) - np.maximum(gx0, px), 0, None)
            for dy in range(k):
                py = gby + dy
                wy = np.clip(np.minimum(gy1, py + 1) - np.maximum(gy0, py), 0, None)
                w = wx * wy * gw
                ok = (w > 0) & (px >= 0) & (px < SHARD_PX) & (py >= 0) & (py < SHARD_PX)
                idx.append(py[ok] * SHARD_PX + px[ok])
                val.append(w[ok])
        if idx:
            acc += np.bincount(np.concatenate(idx), weights=np.concatenate(val), minlength=acc.size)
