import json
import sqlite3

import h3
import numpy as np
import pytest

from pp_pipeline import build, mercator as m, tiles as t


def make_gpkg(path, rows):
    con = sqlite3.connect(path)
    con.execute('CREATE TABLE population (fid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, geom GEOMETRY, h3 TEXT, population REAL)')
    con.executemany("INSERT INTO population (h3, population) VALUES (?, ?)", rows)
    con.commit()
    con.close()


def mass_at(out, z):
    total = 0.0
    for p in (out / "tiles" / str(z)).rglob("*.bin"):
        y = int(p.stem)
        area = m.row_area_km2(np.arange(y * 256, y * 256 + 256), z)
        total += (t.decode_tile(p.read_bytes()) * area[:, None]).sum()
    return total


def test_build_tiles_dedupes_border_cells_and_conserves_population(tmp_path):
    shared = h3.latlng_to_cell(49.6, 6.1, 8)
    a_cells = [h3.latlng_to_cell(49.6 + i * 0.01, 6.0, 8) for i in range(20)] + [shared]
    b_cells = [h3.latlng_to_cell(50.8 + i * 0.01, 4.3, 8) for i in range(30)] + [shared]
    make_gpkg(tmp_path / "AA.gpkg", [(c, 100.0) for c in a_cells])
    make_gpkg(tmp_path / "BB.gpkg", [(c, 10.0) if c != shared else (c, 100.0) for c in b_cells])
    out = tmp_path / "out"
    stats = build.build_tiles([tmp_path / "AA.gpkg", tmp_path / "BB.gpkg"], work=tmp_path / "work", out=out)
    expected = 21 * 100.0 + 30 * 10.0
    assert stats.population == pytest.approx(expected)
    assert stats.duplicates == 1
    for z in (7, 5, 3, 0):
        assert mass_at(out, z) == pytest.approx(expected, rel=3e-3)
    index = json.loads((out / "tiles" / "index.json").read_text())
    assert index["maxZoom"] == 7 and len(index["bits"]) == 8
    assert stats.tiles[7] >= 1
