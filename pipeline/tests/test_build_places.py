import json
import zipfile

import pytest
from shapely.geometry import box, mapping

from pp_pipeline import geom as g
from pp_pipeline import places as pl


def feature(props, geometry):
    return {"type": "Feature", "properties": props, "geometry": mapping(geometry)}


def country(a2, a3, name, geometry, pop=1_000_000):
    return feature({"ISO_A2_EH": a2, "ADM0_A3": a3, "NAME": name, "NAME_EN": name, "NAME_LONG": name,
                    "POP_EST": pop, "CONTINENT": "Testia", "NAME_DE": name + "land"}, geometry)


def city_row(gid, name, lat, lng, pop, cc, alts=""):
    return "\t".join([str(gid), name, name, alts, str(lat), str(lng), "P", "PPL", cc, "", "", "", "", "", str(pop), "", "", "UTC", "2024-01-01"])


@pytest.fixture()
def world(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    mainland = box(-120, 30, -80, 48)
    far_island = box(-160, 18, -154, 22)
    dateland = box(-180, -19, -178, -16).union(box(177, -19, 180, -16))
    a0 = [country("AA", "AAA", "Aland", mainland.union(far_island)),
          country("DD", "DDD", "Dateland", dateland),
          country("-99", "EMP", "Empty Rock", box(50, 50, 50.1, 50.1), pop=0),
          country("KK", "KKK", "Atollia", box(-158, 1.6, -157, 2.2).union(box(172.9, 1.3, 173.2, 1.6).difference(box(172.92, 1.32, 173.18, 1.58))))]
    (src / "ne_10m_admin_0_countries.geojson").write_text(json.dumps({"features": a0}))
    a0_pov = [country("AA", "AAA", "Aland", box(-120, 30, -78, 48).union(far_island)), a0[1]]
    (src / "ne_10m_admin_0_countries_ind.geojson").write_text(json.dumps({"features": a0_pov}))
    a1 = [feature({"adm1_code": "AAA-1", "name": "Westy", "name_en": "Westy", "type_en": "State", "adm0_a3": "AAA",
                   "name_alt": "W|Westerly"}, box(-120, 30, -100, 48)),
          feature({"adm1_code": "AAA-2", "name": "Easty", "name_en": None, "type_en": None, "adm0_a3": "AAA"}, box(-100, 30, -80, 48)),
          feature({"adm1_code": "bad code", "name": "Nope", "adm0_a3": "AAA"}, box(-90, 30, -85, 35))]
    (src / "ne_10m_admin_1_states_provinces.geojson").write_text(json.dumps({"features": a1}))
    rows = [city_row(1, "Big City", 40, -110, 2_000_000, "AA", "Grande Ville,BC"),
            city_row(2, "Small Town", 35, -90, 20_000, "AA"),
            city_row(3, "Island Town", 20, -157, 300_000, "AA"),
            city_row(4, "Date City", -18, -179.5, 150_000, "DD"),
            city_row(5, "Main Date", -17.5, 178, 400_000, "DD"),
            city_row(6, "Lagoon Town", 1.335, 173.05, 60_000, "KK")]
    with zipfile.ZipFile(src / "cities15000.zip", "w") as zf:
        zf.writestr("cities15000.txt", "\n".join(rows) + "\n")
    (src / "ne_10m_populated_places.geojson").write_text(json.dumps({"features": [
        {"type": "Feature", "geometry": None, "properties": {"GEONAMESID": 1, "NAME": "Big City", "NAMEPAR": "Grosse Stadt", "NAME_DE": "Große Stadt"}}]}))
    zone_tab = tmp_path / "zone.tab"
    zone_tab.write_text("# comment\nIN\t+2232+08822\tAsia/Kolkata\nDK\t+5540+01235\tEurope/Copenhagen\n")
    return src, zone_tab


def test_build_places_writes_country_files_search_index_and_views(world, tmp_path):
    src, zone_tab = world
    out = tmp_path / "out"
    summary = pl.build_places(src, out, zone_tab=zone_tab, log=lambda *_: None)

    aa = json.loads((out / "places" / "AA.json").read_text())
    assert aa["bbox"] == pytest.approx([-120, 30, -80, 48], abs=0.01)  # far island dropped
    assert [s["id"] for s in aa["states"]] == ["AAA-1", "AAA-2"]
    assert aa["states"][1]["name"] == "Easty" and aa["states"][1]["type"] == "Region"
    assert [c[0] for c in aa["cities"]] == ["1", "3", "2"]  # all ≥15k, by population

    dd = json.loads((out / "places" / "DD.json").read_text())
    assert dd["bbox"][0] == pytest.approx(177) and dd["bbox"][2] == pytest.approx(182)  # continuous across 180°
    date_city = next(c for c in dd["cities"] if c[0] == "4")
    assert date_city[2] == pytest.approx(180.5)

    items = json.loads((out / "search.json").read_text())["items"]
    kinds = {(r[0], r[1]) for r in items}
    assert {(0, "AA"), (0, "DD"), (0, "KK"), (1, "AAA-1"), (1, "AAA-2"), (2, "1"), (2, "3"), (2, "4"), (2, "5")} == kinds
    big = next(r for r in items if r[1] == "1")
    assert big[4] == "Westy, Aland" and big[6] == "AA" and "Grande Ville" in big[3]
    assert big[3][0] == "Grosse Stadt"  # Natural Earth's local name leads (no language known for AA)
    assert "Alandland" in next(r for r in items if r[1] == "AA")[3]

    assert summary.povs == {"IND": ["AA"]}
    assert (out / "places" / "pov" / "IND" / "AA.json").exists()
    assert not (out / "places" / "pov" / "IND" / "DD.json").exists()
    assert summary.tz_pov == {"Asia/Calcutta": "IND", "Asia/Kolkata": "IND"}
    assert {c["id"] for c in summary.countries} == {"AA", "DD", "KK"}
    kk = json.loads((out / "places" / "KK.json").read_text())
    assert kk["bbox"][0] == pytest.approx(172.9)  # the populated atoll, not the bigger empty island


def test_geometry_in_place_files_decodes_to_the_outline(world, tmp_path):
    src, zone_tab = world
    out = tmp_path / "out"
    pl.build_places(src, out, zone_tab=zone_tab, log=lambda *_: None)
    aa = json.loads((out / "places" / "AA.json").read_text())
    poly = g.decode(aa["geom"])[0]
    assert poly.bounds == pytest.approx((-120, 30, -80, 48), abs=0.01)


def test_views_merge_every_feature_of_a_country_and_ignore_degenerate_outlines(world, tmp_path):
    src, zone_tab = world
    base = json.loads((src / "ne_10m_admin_0_countries.geojson").read_text())["features"]
    territory = country("AA", "AAT", "Aland Territories", box(-100, 10, -99, 11), pop=5_000)
    (src / "ne_10m_admin_0_countries.geojson").write_text(json.dumps({"features": base + [territory]}))
    view = [
        country("AA", "AAA", "Aland", box(-120, 30, -78, 48)),  # drawn a little bigger in this view
        country("AA", "AAB", "Aland Breakaway", box(-80, 30, -76, 34)),  # a split-off area this view counts as Aland
        country("AA", "AAX", "Aland Rock", box(-60, 10, -59.99, 10.01), pop=0),  # an uninhabited speck, listed last
        territory,  # its own country in the base, so it stays apart
        country("DD", "DDD", "Dateland", box(179, -17, 179.01, -16.99)),  # a view that leaves Dateland a speck
        country("KK", "KKK", "Atollia", box(-170, -30, 170, 30)),  # a claim to vastly more land, not a border
    ]
    (src / "ne_10m_admin_0_countries_usa.geojson").write_text(json.dumps({"features": view}))
    out = tmp_path / "out"
    summary = pl.build_places(src, out, zone_tab=zone_tab, log=lambda *_: None)

    assert summary.povs["USA"] == ["AA"]
    aa = json.loads((out / "places" / "pov" / "USA" / "AA.json").read_text())
    assert aa["bbox"] == pytest.approx([-120, 30, -76, 48], abs=0.01)
    assert not aa["tiny"]


def test_views_skip_known_natural_earth_slips(world, tmp_path, monkeypatch):
    src, zone_tab = world
    # A view that drops part of Aland without giving it to anyone, listed as a known slip.
    monkeypatch.setattr(pl, "VIEW_ERRATA", {("USA", "AA")})
    view = [country("AA", "AAA", "Aland", box(-120, 30, -90, 48)), country("DD", "DDD", "Dateland", box(-180, -19, -178, -16).union(box(177, -19, 180, -16)))]
    (src / "ne_10m_admin_0_countries_usa.geojson").write_text(json.dumps({"features": view}))
    out = tmp_path / "out"
    logs: list[str] = []
    summary = pl.build_places(src, out, zone_tab=zone_tab, log=logs.append)
    assert "USA" not in summary.povs
    assert any("view USA" in line and "AA" in line for line in logs)
