"""Density tile encoding and the mass-conserving tile pyramid.

Tile format (the contract with the web client): 256 x 256 little-endian uint16,
row-major, v = round(ln(1 + d) * 256) with d in people/km², zlib-compressed.
The client decodes with DecompressionStream, never via canvas pixel readback.
"""

import base64
import zlib
from pathlib import Path

import numpy as np

from . import mercator as m

SCALE = 256.0
TILE = m.TILE_SIZE


def encode_density(d: np.ndarray) -> bytes:
    v = np.clip(np.rint(np.log1p(np.maximum(d, 0.0)) * SCALE), 0, 65535).astype("<u2")
    return zlib.compress(v.tobytes(), 9)


def decode_tile(blob: bytes) -> np.ndarray:
    v = np.frombuffer(zlib.decompress(blob), dtype="<u2").reshape(TILE, TILE)
    return np.expm1(v.astype(np.float64) / SCALE)


def downsample_mass(a: np.ndarray) -> np.ndarray:
    h, w = a.shape
    return a.reshape(h // 2, 2, w // 2, 2).sum(axis=(1, 3))


class TileIndex:
    """One bitset per zoom; tile (z, x, y) is bit y * 2^z + x, least significant bit first."""

    def __init__(self, max_zoom: int = m.MAX_ZOOM):
        self.bits = [bytearray(((1 << (2 * z)) + 7) // 8) for z in range(max_zoom + 1)]

    def set(self, z: int, x: int, y: int) -> None:
        i = y * (1 << z) + x
        self.bits[z][i >> 3] |= 1 << (i & 7)

    def has(self, z: int, x: int, y: int) -> bool:
        i = y * (1 << z) + x
        return bool((self.bits[z][i >> 3] >> (i & 7)) & 1)

    def count(self, z: int) -> int:
        return sum(bin(b).count("1") for b in self.bits[z])

    def to_base64(self) -> list[str]:
        return [base64.b64encode(bytes(b)).decode("ascii") for b in self.bits]


def _write_tile(out: Path, z: int, x: int, y: int, mass: np.ndarray, index: TileIndex) -> None:
    if not (mass > 0).any():
        return
    area = m.row_area_km2(np.arange(y * TILE, (y + 1) * TILE), z)
    path = out / "tiles" / str(z) / str(x) / f"{y}.bin"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encode_density(mass / area[:, None]))
    index.set(z, x, y)


def write_shard_pyramid(mass: np.ndarray, sx: int, sy: int, out: Path, index: TileIndex,
                        shard_zoom: int = 3, max_zoom: int = m.MAX_ZOOM) -> np.ndarray:
    """Write tiles for zooms max_zoom..shard_zoom of one shard; return its mass at shard_zoom."""
    level = mass
    for z in range(max_zoom, shard_zoom - 1, -1):
        n = level.shape[0] // TILE
        for ty in range(n):
            for tx in range(n):
                block = level[ty * TILE : (ty + 1) * TILE, tx * TILE : (tx + 1) * TILE]
                _write_tile(out, z, sx * n + tx, sy * n + ty, block, index)
        if z > shard_zoom:
            level = downsample_mass(level)
    return level


def write_low_zooms(shard_mass: dict[tuple[int, int], np.ndarray], out: Path, index: TileIndex,
                    shard_zoom: int = 3) -> None:
    """Assemble the shard_zoom masses into one world image and write zooms below shard_zoom."""
    n = 1 << shard_zoom
    level = np.zeros((n * TILE, n * TILE))
    for (sx, sy), a in shard_mass.items():
        level[sy * TILE : (sy + 1) * TILE, sx * TILE : (sx + 1) * TILE] = a
    for z in range(shard_zoom - 1, -1, -1):
        level = downsample_mass(level)
        k = level.shape[0] // TILE
        for ty in range(k):
            for tx in range(k):
                _write_tile(out, z, tx, ty, level[ty * TILE : (ty + 1) * TILE, tx * TILE : (tx + 1) * TILE], index)
