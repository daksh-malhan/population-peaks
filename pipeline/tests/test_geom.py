import pytest
from shapely.geometry import MultiPolygon, Point, Polygon, box

from pp_pipeline import geom as g


def test_unwrap_joins_parts_split_at_the_antimeridian():
    west = box(170, 64, 180, 70)
    east = box(-180, 64, -170, 70)
    parts = g.unwrap([west, east], ref_lng=175)
    merged = g.merge(parts)
    assert len(merged) == 1
    assert merged[0].bounds == pytest.approx((170, 64, 190, 70))


def test_unwrap_shifts_toward_the_reference_longitude():
    parts = g.unwrap([box(-179, -18, -178, -17)], ref_lng=178)
    assert parts[0].bounds[0] == pytest.approx(181)


USA = box(-124.7, 24.5, -66.9, 49.4)
ALASKA = box(-168, 54.5, -141, 71.4)
HAWAII = box(-160.3, 18.9, -154.8, 22.2)
FRANCE = box(-4.8, 42.3, 8.2, 51.1)
CORSICA = box(8.5, 41.4, 9.6, 43.0)
GUIANA = box(-54.6, 2.1, -51.6, 5.8)


def test_main_extent_keeps_contiguous_us_and_drops_alaska_and_hawaii():
    keep, drop = g.main_extent([USA, ALASKA, HAWAII], weights=[300e6, 0.7e6, 1.4e6])
    assert keep == [USA]
    assert set(map(id, drop)) == {id(ALASKA), id(HAWAII)}


def test_main_extent_keeps_corsica_and_drops_french_guiana():
    keep, drop = g.main_extent([FRANCE, CORSICA, GUIANA], weights=[60e6, 0.3e6, 0.3e6])
    assert set(map(id, keep)) == {id(FRANCE), id(CORSICA)}
    assert drop == [GUIANA]


def test_main_extent_keeps_both_halves_of_malaysia_by_area():
    peninsula = box(100.1, 1.3, 104.3, 6.7)
    borneo = box(109.6, 0.9, 119.3, 7.4)
    keep, _ = g.main_extent([peninsula, borneo], weights=[20e6, 6e6])
    assert len(keep) == 2


def test_main_extent_picks_the_most_populous_part_not_the_biggest():
    tarawa = box(172.9, 1.3, 173.2, 1.5)          # Gilbert Islands, most people
    kiritimati = box(-157.6 + 360, 1.6, -157.1 + 360, 2.1)  # biggest atoll, few people
    keep, _ = g.main_extent([kiritimati, tarawa], weights=[7e3, 60e3])
    assert keep == [tarawa]


def test_tiny_places_are_flagged_below_100_km2():
    monaco = box(7.409, 43.724, 7.439, 43.752)
    assert g.area_km2(monaco) < 100
    assert g.is_tiny([monaco])
    assert not g.is_tiny([FRANCE])


def test_area_km2_is_close_to_the_true_area():
    one_degree_at_equator = box(0, 0, 1, 1)
    assert g.area_km2(one_degree_at_equator) == pytest.approx(12_309, rel=0.01)


def test_geometry_encoding_round_trips_to_1e4_degrees():
    poly = Polygon([(19.0, 47.0), (19.5, 47.0), (19.5, 47.5), (19.0, 47.5)], [[(19.1, 47.1), (19.2, 47.1), (19.2, 47.2)]])
    enc = g.encode([poly])
    assert all(isinstance(v, int) for ring in enc[0] for v in ring)
    back = g.decode(enc)
    assert back[0].equals_exact(poly, tolerance=1e-4)


def test_bbox_is_unwrapped():
    assert g.bbox([box(178, -19, 182, -16)]) == pytest.approx([178, -19, 182, -16])


def test_simplify_tolerance_scales_with_extent():
    assert g.tolerance_for([box(16, 45.7, 22.9, 48.6)]) == pytest.approx(0.0035, rel=0.05)
    assert g.tolerance_for([box(27, 41, 190, 82)]) == pytest.approx(0.05)
    assert g.tolerance_for([box(7.4, 43.72, 7.44, 43.75)]) == pytest.approx(0.0005)


def test_prepare_returns_kept_parts_bbox_area_and_flags():
    prepared = g.prepare(MultiPolygon([USA, ALASKA, HAWAII]), weight_of=lambda p: 300e6 if p.contains(Point(-98, 39)) else 1e6)
    assert prepared.bbox == pytest.approx([-124.7, 24.5, -66.9, 49.4], abs=0.01)
    assert not prepared.tiny
    assert len(prepared.parts) == 1


def test_main_extent_does_not_chain_through_tiny_far_islands():
    north = box(172.6, -41.6, 178.6, -34.4)
    south = box(166.4, -46.7, 174.4, -40.4)
    stewart = box(167.5, -47.3, 168.3, -46.7)
    snares = box(166.55, -48.05, 166.65, -47.98)      # ~3 km², ~80 km south of Stewart
    auckland_is = box(165.9, -50.9, 166.3, -50.5)     # ~280 km beyond the Snares
    keep, drop = g.main_extent([north, south, stewart, snares, auckland_is], weights=[3.9e6, 1.2e6, 400, 0, 0])
    assert auckland_is in drop
    assert {id(p) for p in keep} >= {id(north), id(south), id(stewart)}


def test_main_extent_still_follows_a_chain_of_close_small_islands():
    kyushu = box(129.5, 31.0, 132.0, 34.0)
    chain = [box(130.5 - i * 0.6, 30.3 - i * 0.6, 130.6 - i * 0.6, 30.4 - i * 0.6) for i in range(5)]  # ~90 km hops
    keep, _ = g.main_extent([kyushu, *chain], weights=[13e6, 0, 0, 0, 0, 0])
    assert len(keep) == 6


FRANCE_POLY = Polygon([(-4.8, 48.5), (-1.8, 43.4), (3.2, 42.4), (7.6, 43.8), (8.2, 48.9), (2.5, 51.1)])


def test_small_but_populated_islands_keep_the_full_reach():
    # Corsica is ~1.3% of France's area and ~140 km offshore, but people live there.
    corsica = Polygon([(9.0, 43.0), (9.56, 42.3), (9.2, 41.37), (8.6, 42.0)])
    assert g.area_km2(corsica) < 0.02 * g.area_km2(FRANCE_POLY)
    keep, _ = g.main_extent([FRANCE_POLY, corsica], weights=[60e6, 0.3e6])
    assert corsica in keep
    keep, _ = g.main_extent([FRANCE_POLY, corsica], weights=[60e6, 0.0])
    assert corsica not in keep  # an empty rock that far out does not stretch the frame


def test_prepare_centres_the_region_in_the_minus_180_to_180_range():
    tarawa = box(172.9, 1.3, 173.2, 1.6)
    kiritimati = box(-157.6, 1.6, -157.1, 2.1)
    prepared = g.prepare(MultiPolygon([tarawa, kiritimati]), weight_of=lambda p: 60e3 if p.area < 0.1 else 7e3, ref_lng=-157.3)
    assert prepared.bbox[0] == pytest.approx(172.9)
    assert prepared.bbox[2] == pytest.approx(173.2)
