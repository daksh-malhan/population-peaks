"""Deterministic synthetic dataset for the web client's unit and e2e tests.

It is produced by the same writers as the real data (tiles, places, manifest), so the
client is tested against the real formats without downloading anything:

  Testland  (ZZ)  ~145 x 111 km in the Atlantic, two states, Gaussian city peaks
  Dateland  (ZX)  straddles the antimeridian (179.3°E to 179.4°W)
  Microland (ZY)  ~0.5 km², exercises the tiny-place path

expected.json holds the exact generated populations the client must reproduce.

  python -m pp_pipeline.fixture --out ../fixtures/data
"""

import argparse
import json
import math
import sqlite3
import tempfile
import zipfile
from pathlib import Path

import h3
import numpy as np
from shapely.geometry import MultiPolygon, Point, box, mapping

from . import build, places, sources

TESTLAND = box(-41.0, 29.5, -39.5, 30.5)
NORTH, SOUTH = box(-41.0, 30.0, -39.5, 30.5), box(-41.0, 29.5, -39.5, 30.0)
DATELAND_PARTS = [box(179.3, -17.6, 180.0, -16.9), box(-180.0, -17.6, -179.4, -16.9)]
MICRO_CENTER = h3.cell_to_latlng(h3.latlng_to_cell(29.003, -38.0, 8))
MICROLAND = box(MICRO_CENTER[1] - 0.004, MICRO_CENTER[0] - 0.003, MICRO_CENTER[1] + 0.004, MICRO_CENTER[0] + 0.003)

# name, lat, lng, population, peak people per cell, sigma km, country
CITIES = [
    ("Capital City", 30.10, -40.40, 1_200_000, 9000, 6.0, "ZZ"),
    ("Second City", 29.75, -39.90, 400_000, 3500, 4.0, "ZZ"),
    ("Port Town", 30.40, -39.60, 150_000, 1200, 3.0, "ZZ"),
    ("Riverside", 29.60, -40.80, 60_000, 500, 2.5, "ZZ"),
    ("East End", 30.20, -39.70, 90_000, 700, 2.5, "ZZ"),
    ("Hill Village", 29.95, -40.70, 30_000, 250, 2.0, "ZZ"),
    ("Date City", -17.30, 179.80, 200_000, 2500, 4.0, "ZX"),
    ("Meridian", -17.20, -179.70, 110_000, 1500, 3.0, "ZX"),
    ("Micro Town", MICRO_CENTER[0], MICRO_CENTER[1], 20_000, 0, 1.0, "ZY"),
]


def _km(lat1, lng1, lat2, lng2):
    dlng = (lng2 - lng1 + 540) % 360 - 180
    x = math.radians(dlng) * math.cos(math.radians((lat1 + lat2) / 2))
    return 6371.0 * math.hypot(x, math.radians(lat2 - lat1))


def _cells_in(poly) -> set[str]:
    ring = [(y, x) for x, y in poly.exterior.coords]
    return set(h3.polygon_to_cells(h3.LatLngPoly(ring), 8))


def _population(cells: set[str], country: str, rng: np.random.Generator) -> dict[str, float]:
    out = {}
    for c in sorted(cells):
        lat, lng = h3.cell_to_latlng(c)
        v = 12.0 * (0.5 + rng.random())
        for name, clat, clng, _pop, peak, sigma, cc in CITIES:
            if cc == country and peak:
                d = _km(lat, lng, clat, clng)
                v += peak * math.exp(-d * d / (2 * sigma * sigma))
        out[c] = float(round(v))
    return out


def _gpkg(path: Path, pops: dict[str, float]) -> None:
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE population (fid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, geom GEOMETRY, h3 TEXT, population REAL)")
    con.executemany("INSERT INTO population (h3, population) VALUES (?, ?)", sorted(pops.items()))
    con.commit()
    con.close()


def _feature(props, geometry):
    return {"type": "Feature", "properties": props, "geometry": mapping(geometry)}


def _country(a2, a3, name, geometry, pop):
    return _feature({"ISO_A2_EH": a2, "ADM0_A3": a3, "NAME": name, "NAME_EN": name, "NAME_LONG": name,
                     "POP_EST": pop, "CONTINENT": "Fixture Ocean", "NAME_DE": name + " (de)"}, geometry)


def generate(out: Path) -> dict:
    rng = np.random.default_rng(20231101)
    pops: dict[str, dict[str, float]] = {
        "ZZ": _population(_cells_in(TESTLAND), "ZZ", rng),
        "ZX": _population(set().union(*(_cells_in(p) for p in DATELAND_PARTS)), "ZX", rng),
    }
    micro_cell = h3.latlng_to_cell(*MICRO_CENTER, 8)
    pops["ZY"] = {c: (900.0 if c == micro_cell else 300.0) for c in h3.grid_disk(micro_cell, 1)}

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for cc, p in pops.items():
            _gpkg(tmp / f"{cc}.gpkg", p)
        build.build_tiles([tmp / f"{cc}.gpkg" for cc in pops], work=tmp / "work", out=out, log=lambda *_: None)

        src = tmp / "src"
        src.mkdir()
        dateland = MultiPolygon(DATELAND_PARTS)
        a0 = [_country("ZZ", "ZZZ", "Testland", TESTLAND, 2_500_000),
              _country("ZX", "ZXX", "Dateland", dateland, 400_000),
              _country("ZY", "ZYY", "Microland", MICROLAND, 1_500)]
        (src / "ne_10m_admin_0_countries.geojson").write_text(json.dumps({"features": a0}))
        wider = box(-41.0, 29.5, -39.2, 30.5)
        (src / "ne_10m_admin_0_countries_ind.geojson").write_text(json.dumps({"features": [
            _country("ZZ", "ZZZ", "Testland", wider, 2_500_000), a0[1], a0[2]]}))
        a1 = [_feature({"adm1_code": "ZZZ-1", "name": "North Testland", "name_en": "North Testland", "type_en": "Province",
                        "adm0_a3": "ZZZ", "name_alt": "Nordland"}, NORTH),
              _feature({"adm1_code": "ZZZ-2", "name": "South Testland", "name_en": "South Testland", "type_en": "Province",
                        "adm0_a3": "ZZZ"}, SOUTH)]
        (src / "ne_10m_admin_1_states_provinces.geojson").write_text(json.dumps({"features": a1}))
        rows = []
        for i, (name, lat, lng, pop, *_rest, cc) in enumerate(CITIES, start=9_000_001):
            rows.append("\t".join([str(i), name, name, name.replace(" ", ""), f"{lat:.5f}", f"{lng:.5f}", "P", "PPL", cc,
                                   "", "", "", "", "", str(pop), "", "", "UTC", "2026-01-01"]))
        with zipfile.ZipFile(src / "cities15000.zip", "w") as zf:
            zf.writestr("cities15000.txt", "\n".join(rows) + "\n")
        zone_tab = tmp / "zone.tab"
        zone_tab.write_text("IN\t+2232+08822\tAsia/Kolkata\nUS\t+404251-0740023\tAmerica/New_York\n")
        summary = places.build_places(src, out, zone_tab=zone_tab, log=lambda *_: None)
        sources.build_manifest(out, "fixture", summary.countries, summary.povs, summary.tz_pov,
                               {"cities15000.zip": "fixture"}, built_at="2026-01-01T00:00:00Z")

    def inside(poly, cells):
        total = 0.0
        for c, v in cells.items():
            lat, lng = h3.cell_to_latlng(c)
            if poly.contains(Point(lng, lat)) or poly.contains(Point(lng + 360, lat)) or poly.contains(Point(lng - 360, lat)):
                total += v
        return total

    expected = {
        "total": sum(sum(p.values()) for p in pops.values()),
        "population": {
            "ZZ": sum(pops["ZZ"].values()),
            "ZX": sum(pops["ZX"].values()),
            "ZY": inside(MICROLAND, pops["ZY"]),
            "ZY_context": sum(pops["ZY"].values()),
            "ZZZ-1": inside(NORTH, pops["ZZ"]),
            "ZZZ-2": inside(SOUTH, pops["ZZ"]),
        },
        "peak": {
            "ZZ": {"city": "Capital City", "lat": CITIES[0][1], "lng": CITIES[0][2]},
            "ZX": {"city": "Date City", "lat": CITIES[6][1], "lng": CITIES[6][2]},
        },
    }
    expected["total"] = expected["population"]["ZZ"] + expected["population"]["ZX"] + expected["population"]["ZY_context"]
    expected["population"]["ZY"] = expected["population"]["ZY"] or 0.0
    (out / "expected.json").write_text(json.dumps(expected, indent=1))
    return expected


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="pp_pipeline.fixture")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    import shutil
    shutil.rmtree(args.out, ignore_errors=True)
    args.out.mkdir(parents=True)
    expected = generate(args.out)
    print(f"fixture written to {args.out}: {expected['total']:,.0f} people")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
