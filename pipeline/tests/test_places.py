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


def test_tz_to_pov_covers_canonical_zones_and_legacy_aliases():
    tz = pl.tz_to_pov("/usr/share/zoneinfo/zone.tab")
    assert tz["Asia/Kolkata"] == "IND"
    assert tz["Asia/Calcutta"] == "IND"
    assert tz["America/New_York"] == "USA"
    assert tz["Europe/Kyiv"] == "UKR" and tz["Europe/Kiev"] == "UKR"
    assert "Europe/Copenhagen" not in tz  # Denmark has no Natural Earth point of view
