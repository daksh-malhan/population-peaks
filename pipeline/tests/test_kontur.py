import hashlib
import sqlite3

import h3
import numpy as np
import pytest

from pp_pipeline import kontur as k
from pp_pipeline import splat as sp


def test_single_part_etag_is_the_md5_of_the_file(tmp_path):
    p = tmp_path / "a.gpkg.gz"
    p.write_bytes(b"hello kontur")
    assert k.verify_etag(p, '"%s"' % hashlib.md5(b"hello kontur").hexdigest())
    assert not k.verify_etag(p, '"%s"' % hashlib.md5(b"tampered").hexdigest())


def test_multipart_etag_uses_8_mib_parts(tmp_path):
    blob = np.random.default_rng(1).bytes(20 * 1024 * 1024)
    p = tmp_path / "b.gpkg.gz"
    p.write_bytes(blob)
    part = 8 * 1024 * 1024
    digests = b"".join(hashlib.md5(blob[i : i + part]).digest() for i in range(0, len(blob), part))
    etag = '"%s-3"' % hashlib.md5(digests).hexdigest()
    assert k.verify_etag(p, etag)
    assert not k.verify_etag(p, etag.replace("-3", "-4"))


@pytest.mark.parametrize(
    "url",
    [
        "http://geodata-eu-central-1-kontur-public.s3.amazonaws.com/kontur_datasets/kontur_population_HU_20231101.gpkg.gz",
        "https://evil.example/kontur_datasets/kontur_population_HU_20231101.gpkg.gz",
        "https://geodata-eu-central-1-kontur-public.s3.amazonaws.com.evil.example/x.gpkg.gz",
        "https://geodata-eu-central-1-kontur-public.s3.amazonaws.com/kontur_datasets/../../etc/passwd",
    ],
)
def test_source_urls_outside_the_kontur_bucket_are_rejected(url):
    with pytest.raises(ValueError):
        k.check_source_url(url)


def test_kontur_bucket_urls_are_accepted():
    k.check_source_url(
        "https://geodata-eu-central-1-kontur-public.s3.amazonaws.com/kontur_datasets/kontur_population_HU_20231101.gpkg.gz"
    )


def test_parse_hdx_keeps_only_2023_11_01_country_files():
    payload = {"result": {"results": [
        {"name": "kontur-population-hungary", "resources": [
            {"url": "https://geodata-eu-central-1-kontur-public.s3.amazonaws.com/kontur_datasets/kontur_population_HU_20220630.gpkg.gz", "size": 1},
            {"url": "https://geodata-eu-central-1-kontur-public.s3.amazonaws.com/kontur_datasets/kontur_population_HU_20231101.gpkg.gz", "size": 4487351},
        ]},
        {"name": "kontur-boundaries-hungary", "resources": [
            {"url": "https://geodata-eu-central-1-kontur-public.s3.amazonaws.com/kontur_datasets/kontur_boundaries_HU_20230628.gpkg.gz", "size": 9},
        ]},
    ]}}
    assert k.parse_hdx(payload, "20231101") == [{
        "iso2": "HU",
        "url": "https://geodata-eu-central-1-kontur-public.s3.amazonaws.com/kontur_datasets/kontur_population_HU_20231101.gpkg.gz",
        "bytes": 4487351,
    }]


def make_gpkg(path, rows):
    con = sqlite3.connect(path)
    con.execute('CREATE TABLE population (fid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, geom GEOMETRY, h3 TEXT, population REAL)')
    con.executemany("INSERT INTO population (h3, population) VALUES (?, ?)", rows)
    con.commit()
    con.close()


def test_read_cells_skips_invalid_rows_and_returns_true_cell_areas(tmp_path):
    good = [h3.latlng_to_cell(47.5, 19.04, 8), h3.latlng_to_cell(47.6, 19.1, 8), h3.latlng_to_cell(-33.9, 151.2, 8)]
    rows = [(good[0], 120.0), (good[1], 3.0), (good[2], 55.0),
            ("not-a-cell", 10.0), (h3.latlng_to_cell(47.5, 19.04, 7), 10.0), (good[0][:-1] + "0", 1.0),
            (h3.latlng_to_cell(10.0, 10.0, 8), -5.0), (h3.latlng_to_cell(11.0, 10.0, 8), float("nan"))]
    p = tmp_path / "XX.gpkg"
    make_gpkg(p, rows)
    stats = k.ReadStats()
    chunks = list(k.read_cells(p, stats, chunk=2))
    cells = np.concatenate([c.cell for c in chunks])
    assert sorted(cells.tolist()) == sorted(h3.str_to_int(c) for c in good)
    assert stats.skipped == 5
    first = next(c for c in chunks if h3.str_to_int(good[0]) in c.cell.tolist())
    i = first.cell.tolist().index(h3.str_to_int(good[0]))
    assert (first.lat[i], first.lng[i]) == pytest.approx(h3.cell_to_latlng(good[0]))
    assert first.area[i] == pytest.approx(h3.cell_area(good[0], "km^2"))
    assert first.pop[i] == 120.0


def test_dedupe_keeps_one_copy_of_border_cells_shared_by_two_country_files():
    r = np.zeros(4, dtype=sp.RECORD)
    r["cell"] = [11, 22, 11, 33]
    r["pop"] = [5, 6, 5, 7]
    out = sp.dedupe(r)
    assert sorted(out["cell"].tolist()) == [11, 22, 33]
    assert out["pop"].sum() == 18


def test_antimeridian_neighbours_land_in_the_first_and_last_z7_tile_columns():
    r = sp.cell_records(np.array([-17.0, -17.0]), np.array([179.9, -179.9]), np.array([0.7, 0.7]), np.array([1.0, 1.0]),
                        np.array([1, 2], dtype=np.uint64))
    assert (r["x"] // 256).astype(int).tolist() == [127, 0]
