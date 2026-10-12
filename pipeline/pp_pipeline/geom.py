"""Geometry preparation for place outlines.

- unwrap: shift parts by ±360° toward a reference longitude so a region that
  crosses the antimeridian is continuous (longitudes may leave [-180, 180]).
- main_extent: frame a country on its main landmass. The most populous part
  anchors a cluster; parts join if they are big, populous, or close (≤ max(300 km,
  12% of the cluster's diagonal); near-empty specks under 2% of the anchor's area
  only within 100 km). Alaska, Hawaii and French Guiana fall away; Corsica, Sicily and Borneo stay.
- encode: polygons → rings of int deltas in 1e-4° (the client's geomCodec decodes).
"""

import math
from dataclasses import dataclass
from typing import Callable, Sequence

import shapely
from shapely import affinity
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry

R_KM = 6371.007180918475
TINY_KM2 = 100.0
Q = 10_000  # 1e-4 degree units


def parts_of(geom: BaseGeometry) -> list[Polygon]:
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)] + \
        [p for g in getattr(geom, "geoms", []) if isinstance(g, MultiPolygon) for p in g.geoms]


def unwrap(parts: Sequence[Polygon], ref_lng: float) -> list[Polygon]:
    out = []
    for p in parts:
        cx = p.centroid.x
        shift = 360.0 * round((ref_lng - cx) / 360.0)
        out.append(affinity.translate(p, xoff=shift) if shift else p)
    return out


def merge(parts: Sequence[Polygon]) -> list[Polygon]:
    """Union parts that touch (e.g. both halves of Chukotka after unwrapping)."""
    return parts_of(shapely.make_valid(shapely.union_all([shapely.make_valid(p) for p in parts])))


def area_km2(geom: BaseGeometry) -> float:
    """Spherical area (authalic sphere): R² Σ Δλ (sin φ1 + sin φ2) / 2 over every ring."""
    total = 0.0
    for p in parts_of(geom):
        rings = [p.exterior, *p.interiors]
        for k, ring in enumerate(rings):
            xs, ys = ring.coords.xy
            a = 0.0
            for i in range(len(xs) - 1):
                a += math.radians(xs[i + 1] - xs[i]) * (math.sin(math.radians(ys[i])) + math.sin(math.radians(ys[i + 1]))) / 2
            total += abs(a) * (1 if k == 0 else -1)
    return total * R_KM * R_KM


def _km_scaled(geom: BaseGeometry, lat0: float) -> BaseGeometry:
    return affinity.scale(geom, xfact=math.cos(math.radians(lat0)) * 111.32, yfact=110.57, origin=(0, 0))


def _bounds_union(a, b):
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def _diag_km(b) -> float:
    lat0 = (b[1] + b[3]) / 2
    return math.hypot((b[2] - b[0]) * 111.32 * math.cos(math.radians(lat0)), (b[3] - b[1]) * 110.57)


def main_extent(parts: Sequence[Polygon], weights: Sequence[float] | None = None):
    """Split parts into (kept, dropped) around the most populous (or largest) part."""
    if len(parts) <= 1:
        return list(parts), []
    areas = [area_km2(p) for p in parts]
    w = list(weights) if weights is not None and max(weights) > 0 else None
    anchor = max(range(len(parts)), key=lambda i: (w[i], areas[i]) if w else areas[i])
    kept = {anchor}
    bounds = parts[anchor].bounds
    changed = True
    while changed:
        changed = False
        lat0 = (bounds[1] + bounds[3]) / 2
        threshold = max(300.0, 0.12 * _diag_km(bounds))
        cluster = _km_scaled(shapely.union_all([parts[i] for i in kept]), lat0)
        for i, p in enumerate(parts):
            if i in kept:
                continue
            big = areas[i] >= 0.25 * areas[anchor] and (w is None or w[i] >= 0.2 * w[anchor])
            populous = w is not None and w[i] >= 0.25 * w[anchor]
            # Specks (<2% of the anchor's area and almost no people) may only hop 100 km,
            # so chains of empty rocks can't drag the frame out to sea.
            speck = areas[i] < 0.02 * areas[anchor] and (w is None or w[i] < 0.001 * w[anchor])
            reach = 100.0 if speck else threshold
            near = cluster.distance(_km_scaled(p, lat0)) <= reach
            if big or populous or near:
                kept.add(i)
                bounds = _bounds_union(bounds, p.bounds)
                changed = True
    return [parts[i] for i in sorted(kept)], [parts[i] for i in range(len(parts)) if i not in kept]


def is_tiny(parts: Sequence[Polygon]) -> bool:
    return sum(area_km2(p) for p in parts) < TINY_KM2


def bbox(parts: Sequence[Polygon]) -> list[float]:
    b = shapely.union_all(list(parts)).bounds
    return [round(v, 4) for v in b]


def tolerance_for(parts: Sequence[Polygon]) -> float:
    b = shapely.union_all(list(parts)).bounds
    return min(0.05, max(0.0005, max(b[2] - b[0], b[3] - b[1]) / 2000))


def encode(parts: Sequence[Polygon]) -> list[list[list[int]]]:
    out = []
    for p in parts:
        rings = []
        for ring in [p.exterior, *p.interiors]:
            pts = list(ring.coords)[:-1]
            flat, px, py = [], 0, 0
            for x, y in pts:
                qx, qy = round(x * Q), round(y * Q)
                flat += [qx - px, qy - py]
                px, py = qx, qy
            if len(pts) >= 3:
                rings.append(flat)
        if rings:
            out.append(rings)
    return out


def decode(enc: list[list[list[int]]]) -> list[Polygon]:
    polys = []
    for rings in enc:
        coords = []
        for flat in rings:
            x = y = 0
            pts = []
            for i in range(0, len(flat), 2):
                x += flat[i]
                y += flat[i + 1]
                pts.append((x / Q, y / Q))
            coords.append(pts)
        polys.append(Polygon(coords[0], coords[1:]))
    return polys


@dataclass
class Prepared:
    parts: list[Polygon]
    bbox: list[float]
    area: float
    tiny: bool
    dropped: int


def prepare(geom: BaseGeometry, weight_of: Callable[[Polygon], float] | None = None, ref_lng: float | None = None) -> Prepared:
    raw = parts_of(shapely.make_valid(geom))
    if ref_lng is None:
        biggest = max(raw, key=lambda p: p.area)
        ref_lng = biggest.centroid.x
    parts = merge(unwrap(raw, ref_lng))
    weights = [weight_of(p) for p in parts] if weight_of else None
    kept, dropped = main_extent(parts, weights)
    b = shapely.union_all(kept).bounds
    recentre = -360.0 * round(((b[0] + b[2]) / 2) / 360.0)
    if recentre:
        kept = [affinity.translate(p, xoff=recentre) for p in kept]
    tol = tolerance_for(kept)
    simple = [s for p in kept for s in parts_of(shapely.make_valid(p.simplify(tol, preserve_topology=True))) if not s.is_empty]
    simple = simple or kept
    return Prepared(parts=simple, bbox=bbox(simple), area=round(sum(area_km2(p) for p in simple), 1),
                    tiny=is_tiny(simple), dropped=len(dropped))
