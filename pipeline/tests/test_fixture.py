import json

import numpy as np
import pytest

from pp_pipeline import fixture, mercator as m, tiles as t


def mass_at(out, z):
    total = 0.0
    for p in (out / "tiles" / str(z)).rglob("*.bin"):
        y = int(p.stem)
        area = m.row_area_km2(np.arange(y * 256, y * 256 + 256), z)
        total += (t.decode_tile(p.read_bytes()) * area[:, None]).sum()
    return total


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp("fixture")
    fixture.generate(out)
    return out


def test_fixture_writes_a_complete_dataset(built):
    for rel in ["manifest.json", "search.json", "places/ZZ.json", "places/ZX.json", "places/ZY.json",
                "places/pov/IND/ZZ.json", "tiles/index.json", "expected.json"]:
        assert (built / rel).exists(), rel


def test_fixture_tiles_hold_exactly_the_generated_population(built):
    expected = json.loads((built / "expected.json").read_text())
    world = sum(expected["population"][k] for k in ("ZZ", "ZX", "ZY_context"))  # Microland ring cells spill past its outline
    assert world == pytest.approx(expected["total"])
    for z in (7, 4):
        assert mass_at(built, z) == pytest.approx(expected["total"], rel=3e-3)


def test_fixture_regions_have_the_properties_the_client_tests_rely_on(built):
    zz = json.loads((built / "places" / "ZZ.json").read_text())
    zx = json.loads((built / "places" / "ZX.json").read_text())
    zy = json.loads((built / "places" / "ZY.json").read_text())
    assert [s["id"] for s in zz["states"]] == ["ZZZ-1", "ZZZ-2"]
    assert zx["bbox"][0] < 180 < zx["bbox"][2]          # Dateland crosses the antimeridian
    assert zy["tiny"] is True                            # Microland is under 100 km²
    expected = json.loads((built / "expected.json").read_text())
    assert expected["population"]["ZZZ-1"] + expected["population"]["ZZZ-2"] == pytest.approx(expected["population"]["ZZ"], rel=1e-6)
    assert expected["peak"]["ZZ"]["city"] == "Capital City"
