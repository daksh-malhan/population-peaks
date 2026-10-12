"""Web Mercator (XYZ tile scheme) on H3's authalic sphere.

Using H3's sphere means pixel areas and H3 cell areas agree, so densities
(people per km²) computed here match Kontur's per-cell numbers.
"""

import numpy as np

EARTH_RADIUS_KM = 6371.007180918475
CIRCUMFERENCE_KM = 2 * np.pi * EARTH_RADIUS_KM
TILE_SIZE = 256
MAX_ZOOM = 7
MAX_LAT = 85.0511287798066


def world_px(z: int) -> int:
    return TILE_SIZE << z


def lng_to_x(lng, z: int):
    return (np.asarray(lng, dtype=np.float64) + 180.0) / 360.0 * world_px(z)


def lat_to_y(lat, z: int):
    phi = np.radians(np.clip(np.asarray(lat, dtype=np.float64), -MAX_LAT, MAX_LAT))
    return (1.0 - np.arcsinh(np.tan(phi)) / np.pi) / 2.0 * world_px(z)


def x_to_lng(x, z: int):
    return np.asarray(x, dtype=np.float64) / world_px(z) * 360.0 - 180.0


def y_to_lat(y, z: int):
    return np.degrees(np.arctan(np.sinh(np.pi * (1.0 - 2.0 * np.asarray(y, dtype=np.float64) / world_px(z)))))


def pixel_size_km(lat, z: int):
    return CIRCUMFERENCE_KM * np.cos(np.radians(lat)) / world_px(z)


def pixel_area_km2(lat, z: int):
    return pixel_size_km(lat, z) ** 2


def row_area_km2(rows, z: int):
    """Area of one pixel in each global pixel row, measured at the row's centre latitude."""
    return pixel_area_km2(y_to_lat(np.asarray(rows, dtype=np.float64) + 0.5, z), z)
