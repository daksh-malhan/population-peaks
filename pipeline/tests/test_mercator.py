import math

import numpy as np
import pytest

from pp_pipeline import mercator as m


def test_origin_is_the_centre_of_the_world_at_every_zoom():
    for z in range(8):
        assert m.lng_to_x(0.0, z) == pytest.approx(m.world_px(z) / 2)
        assert m.lat_to_y(0.0, z) == pytest.approx(m.world_px(z) / 2)


def test_lng_lat_round_trip():
    lng = np.array([-179.99, -73.98, 0.0, 19.04, 151.21, 179.99])
    lat = np.array([-84.0, -33.87, 0.0, 47.5, 64.1, 84.0])
    for z in (0, 3, 7):
        assert np.allclose(m.x_to_lng(m.lng_to_x(lng, z), z), lng, atol=1e-9)
        assert np.allclose(m.y_to_lat(m.lat_to_y(lat, z), z), lat, atol=1e-9)


def test_north_is_up():
    assert m.lat_to_y(60.0, 7) < m.lat_to_y(0.0, 7) < m.lat_to_y(-60.0, 7)


@pytest.mark.parametrize("lat", [0.0, 45.0, 70.0])
def test_pixel_area_matches_the_exact_spherical_area_of_a_z7_pixel(lat):
    z = 7
    n = m.world_px(z)
    y = math.floor(m.lat_to_y(lat, z))
    lat_top, lat_bottom = m.y_to_lat(y, z), m.y_to_lat(y + 1, z)
    r = m.EARTH_RADIUS_KM
    exact = r * r * (2 * math.pi / n) * (math.sin(math.radians(lat_top)) - math.sin(math.radians(lat_bottom)))
    approx = m.pixel_area_km2(m.y_to_lat(y + 0.5, z), z)
    assert approx == pytest.approx(exact, rel=1e-3)


def test_row_area_is_vectorised_over_global_rows():
    rows = np.array([0, 100, 16383])
    areas = m.row_area_km2(rows, 7)
    assert areas.shape == (3,)
    assert areas[1] == pytest.approx(m.pixel_area_km2(m.y_to_lat(100.5, 7), 7))
