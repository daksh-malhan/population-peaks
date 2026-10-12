import numpy as np
import pytest

from pp_pipeline import splat as sp

SH = sp.SHARD_PX  # 4096 px per shard side at z7
WORLD = SH * 8


def recs(x, y, s, pop):
    r = np.zeros(len(x), dtype=sp.RECORD)
    r["x"], r["y"], r["s"], r["pop"] = x, y, s, pop
    return r


def test_splat_conserves_mass_for_cells_inside_a_shard():
    rng = np.random.default_rng(7)
    n = 5000
    r = recs(rng.uniform(20, SH - 20, n) + 2 * SH, rng.uniform(20, SH - 20, n) + 3 * SH,
             rng.uniform(0.3, 4.0, n), rng.uniform(1, 500, n))
    mass = sp.splat_shard(r, 2, 3)
    assert mass.shape == (SH, SH)
    assert mass.sum() == pytest.approx(r["pop"].astype(np.float64).sum(), rel=1e-9)


def test_a_cell_smaller_than_a_pixel_lands_in_that_pixel_only():
    r = recs([10.5 + SH], [20.5], [0.5], [42.0])
    mass = sp.splat_shard(r, 1, 0)
    assert mass[20, 10] == pytest.approx(42.0)
    assert mass.sum() == pytest.approx(42.0)


def test_footprint_is_spread_by_area_overlap():
    # 2 px wide box centred on a pixel corner: four pixels get a quarter each
    r = recs([100.0], [200.0], [2.0], [8.0])
    mass = sp.splat_shard(r, 0, 0)
    assert mass[199:201, 99:101].sum() == pytest.approx(8.0)
    assert mass[199, 99] == pytest.approx(2.0)


def test_cells_crossing_a_shard_edge_are_routed_to_both_shards_and_mass_is_conserved():
    r = recs([SH - 0.5], [100.0], [3.0], [90.0])
    routed = sp.route_to_shards(r)
    assert set(routed) == {(0, 0), (1, 0)}
    total = sum(sp.splat_shard(part, sx, sy).sum() for (sx, sy), part in routed.items())
    assert total == pytest.approx(90.0)


def test_cells_crossing_the_antimeridian_wrap_to_the_last_shard():
    r = recs([0.4], [5000.0], [2.0], [10.0])
    routed = sp.route_to_shards(r)
    assert set(routed) == {(0, 1), (7, 1)}
    total = sum(sp.splat_shard(part, sx, sy).sum() for (sx, sy), part in routed.items())
    assert total == pytest.approx(10.0)


def test_cell_records_put_known_cities_in_the_right_place():
    # Budapest: 47.4979 N, 19.0402 E, a 0.737 km2 H3 res-8 cell
    r = sp.cell_records(np.array([47.4979]), np.array([19.0402]), np.array([0.737]), np.array([1000.0]))
    assert r["x"][0] == pytest.approx((19.0402 + 180) / 360 * WORLD)
    assert 0.95 < r["s"][0] < 1.15  # ~0.86 km wide cell on ~0.83 km z7 pixels at 47.5 N
    assert r["pop"][0] == pytest.approx(1000.0)
