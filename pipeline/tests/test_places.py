import pytest
from shapely.geometry import box

from pp_pipeline import places as pl


def test_country_id_prefers_iso_a2_eh_then_adm0_a3():
    assert pl.country_id({"ISO_A2_EH": "FR", "ADM0_A3": "FRA"}) == "FR"
    assert pl.country_id({"ISO_A2_EH": "-99", "ADM0_A3": "SOL"}) == "SOL"


def test_display_name_is_the_shortest_unabbreviated_name():
    props = {"NAME": "United States of America", "NAME_EN": "United States of America", "NAME_LONG": "United States"}
    assert pl.display_name(props) == "United States"
    assert pl.display_name({"NAME": "N. Cyprus", "NAME_EN": "Turkish Republic of Northern Cyprus", "NAME_LONG": "Northern Cyprus"}) == "Northern Cyprus"
    assert pl.display_name({"NAME": "Russia", "NAME_EN": "Russia", "NAME_LONG": "Russian Federation"}) == "Russia"


def test_latin_aliases_keep_distinct_latin_spellings_only():
    alts = pl.latin_aliases("Munich", ["München", "Muenchen", "MUC", "Мюнхен", "慕尼黑", "Munich", "munich", "Monaco di Baviera", "Múnich"], limit=4)
    assert "München" in alts and "Muenchen" in alts
    assert "MUC" not in alts and "Мюнхен" not in alts and "慕尼黑" not in alts
    assert "Munich" not in alts and len(alts) <= 4


def test_parse_geonames_filters_feature_codes_and_population():
    header = "\t".join
    rows = [
        header(["3054643", "Budapest", "Budapest", "Budapeste,Budapesht", "47.49801", "19.03991", "P", "PPLC", "HU", "", "05", "", "", "", "1741041", "", "", "Europe/Budapest", "2024-01-01"]),
        header(["9999999", "Pest District", "Pest District", "", "47.5", "19.05", "P", "PPLX", "HU", "", "05", "", "", "", "200000", "", "", "Europe/Budapest", "2024-01-01"]),
        header(["1111111", "Smallville", "Smallville", "", "47.0", "19.0", "P", "PPL", "HU", "", "05", "", "", "", "9000", "", "", "Europe/Budapest", "2024-01-01"]),
        header(["2222222", "Bad", "Bad", "", "not-a-number", "19.0", "P", "PPL", "HU", "", "05", "", "", "", "50000", "", "", "Europe/Budapest", "2024-01-01"]),
    ]
    cities = list(pl.parse_geonames(rows))
    assert [c.id for c in cities] == ["3054643"]
    assert cities[0].pop == 1741041 and cities[0].lng == pytest.approx(19.03991)
    assert "Budapeste" in cities[0].alts


def test_assign_points_uses_containment_then_nearest_within_5_km():
    polys = {"AA": box(0, 0, 10, 10), "BB": box(20, 0, 30, 10)}
    out = pl.assign_points({"AA": [polys["AA"]], "BB": [polys["BB"]]}, [(5, 5), (10.03, 5), (15, 5)])
    assert out == ["AA", "AA", None]


def test_pov_diff_ignores_identical_outlines_and_reports_changed_ones():
    base = {"IN": [box(68, 6, 97, 35)], "PK": [box(60, 23, 77, 37)]}
    view = {"IN": [box(68, 6, 97, 37)], "PK": [box(60, 23, 77, 37)]}
    assert pl.pov_changes(base, view) == ["IN"]


def test_pov_diff_keeps_the_usual_outline_when_a_view_erases_or_balloons_a_country():
    base = {"IL": [box(34, 29, 36, 33)], "TW": [box(120, 22, 122, 25)], "PK": [box(60, 23, 77, 37)]}
    view = {"IL": [box(35, 31, 35.01, 31.01)], "TW": [box(73, 18, 135, 53)], "PK": [box(60, 23, 77, 37.5)]}
    ignored: list[str] = []
    assert pl.pov_changes(base, view, ignored) == ["PK"]
    assert ignored == ["IL", "TW"]


def test_tz_to_pov_covers_canonical_zones_and_legacy_aliases():
    tz = pl.tz_to_pov("/usr/share/zoneinfo/zone.tab")
    assert tz["Asia/Kolkata"] == "IND"
    assert tz["Asia/Calcutta"] == "IND"
    assert tz["America/New_York"] == "USA"
    assert tz["Europe/Kyiv"] == "UKR" and tz["Europe/Kiev"] == "UKR"
    assert "Europe/Copenhagen" not in tz  # Denmark has no Natural Earth point of view


def test_latin_aliases_keep_the_first_spelling_when_two_fold_together():
    assert pl.latin_aliases("Munich", ["München", "Munchen", "Minga"], limit=3) == ["München", "Minga"]


def test_city_names_lead_with_the_local_language_then_local_and_former_names():
    munich = {"NAMEPAR": "Munchen", "NAME_DE": "München", "NAME_IT": "Monaco di Baviera", "NAME_EN": "Munich"}
    assert pl.latin_aliases("Munich", pl.ordered_city_names(munich, "DE"), limit=4) == ["München", "Monaco di Baviera"]
    milan = {"NAMEPAR": "Milano", "NAME_IT": "Milano", "NAME_HU": "Milánó", "NAME_DE": "Mailand"}
    assert pl.latin_aliases("Milan", pl.ordered_city_names(milan, "IT"), limit=4) == ["Milano", "Mailand"]
    cologne = {"NAMEPAR": "Koln", "NAME_DE": "Köln", "NAME_EN": "Cologne", "NAME_IT": "Colonia"}
    assert pl.latin_aliases("Köln", pl.ordered_city_names(cologne, "DE"), limit=4)[0] == "Cologne"


def test_ne_city_index_matches_by_geonames_id_or_by_name_and_place(tmp_path):
    import json
    feats = [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [16.37, 48.21]},
         "properties": {"GEONAMESID": 2761369, "NAME": "Vienna", "NAMEPAR": "Wien", "NAME_DE": "Wien"}},
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [14.42, 50.09]},
         "properties": {"GEONAMESID": 4548393, "NAME": "Prague", "NAMEPAR": "Praha"}},
    ]
    (tmp_path / "ne_10m_populated_places.geojson").write_text(json.dumps({"features": feats}))
    index = pl.ne_city_index(tmp_path)
    assert index.lookup("2761369", "Vienna", 48.2, 16.37)["NAMEPAR"] == "Wien"
    assert index.lookup("3067696", "Prague", 50.08, 14.43)["NAMEPAR"] == "Praha"
    assert index.lookup("3067696", "Prague", 40.0, 14.43) is None   # same name, far away
    assert index.lookup("1", "Elsewhere", 50.08, 14.43) is None
