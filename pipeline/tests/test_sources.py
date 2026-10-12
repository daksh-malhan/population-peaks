import hashlib

import pytest

from pp_pipeline import sources as s


def test_git_blob_sha_matches_git_hash_object(tmp_path):
    p = tmp_path / "x.geojson"
    p.write_bytes(b'{"features": []}\n')
    expected = hashlib.sha1(b"blob 17\x00" + b'{"features": []}\n').hexdigest()
    assert s.git_blob_sha(p) == expected


@pytest.mark.parametrize("url", [
    "http://download.geonames.org/export/dump/cities15000.zip",
    "https://download.geonames.org.evil.example/export/dump/cities15000.zip",
    "https://raw.githubusercontent.com/someone-else/natural-earth-vector/abc/geojson/x.geojson",
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/f1890d9f152c896d250a77557a5751a93d494776/../../x",
])
def test_place_source_urls_are_allowlisted(url):
    with pytest.raises(ValueError):
        s.check_place_url(url)


def test_allowed_place_urls_pass():
    s.check_place_url("https://download.geonames.org/export/dump/cities15000.zip")
    s.check_place_url("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/f1890d9f152c896d250a77557a5751a93d494776/geojson/ne_10m_admin_0_countries.geojson")


def test_manifest_lists_tiles_places_views_and_sources(tmp_path):
    (tmp_path / "tiles").mkdir()
    (tmp_path / "tiles" / "index.json").write_text('{"maxZoom": 7, "bits": ["AQ==", "", "", "", "", "", "", ""]}')
    (tmp_path / "tiles" / "sources.json").write_text('{"HU": {"sha256": "ab", "url": "u", "etag": "e"}}')
    m = s.build_manifest(tmp_path, version="2023-11-01-r1",
                         countries=[{"id": "HU", "name": "Hungary", "bbox": [16, 45.7, 22.9, 48.6]}],
                         povs={"IND": ["CN"]}, tz_pov={"Asia/Kolkata": "IND"}, place_hashes={"cities15000.zip": "cd"},
                         built_at="2026-10-12T00:00:00Z")
    assert m["v"] == 1 and m["dataVersion"] == "2023-11-01-r1"
    assert m["tiles"] == {"minZoom": 0, "maxZoom": 7, "size": 256, "scale": 256, "encoding": "zlib-u16le-log1p"}
    assert m["tileIndex"][0] == "AQ=="
    assert m["countries"][0] == {"id": "HU", "name": "Hungary", "bbox": [16, 45.7, 22.9, 48.6], "preview": False}
    assert {x["name"] for x in m["sources"]} == {"Kontur Population", "Natural Earth", "GeoNames"}
    assert (tmp_path / "manifest.json").exists()
