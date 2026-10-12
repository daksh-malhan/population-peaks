import base64

import numpy as np
import pytest

from pp_pipeline import mercator as m
from pp_pipeline import tiles as t


def test_encode_decode_error_is_bounded_by_half_a_log_step():
    # v = round(ln(1+d) * 256)  =>  |d' - d| <= (1 + d) * (e^(1/512) - 1)
    d = np.zeros((256, 256))
    d[0, :7] = [0.003, 0.01, 1.0, 37.0, 900.0, 25_000.0, 150_000.0]
    back = t.decode_tile(t.encode_density(d))
    assert back[1:, :].max() == 0.0
    bound = (1 + d[0, :7]) * np.expm1(1 / 512) + 1e-12
    assert np.all(np.abs(back[0, :7] - d[0, :7]) <= bound)


def test_encoded_tiles_are_zlib_uint16_little_endian():
    import zlib
    raw = zlib.decompress(t.encode_density(np.full((256, 256), np.e - 1)))
    assert len(raw) == 256 * 256 * 2
    assert np.frombuffer(raw, "<u2")[0] == 256  # ln(1 + (e - 1)) * 256


def test_downsample_conserves_mass():
    rng = np.random.default_rng(3)
    a = rng.uniform(0, 10, (512, 512))
    assert t.downsample_mass(a).shape == (256, 256)
    assert t.downsample_mass(a).sum() == pytest.approx(a.sum())


def test_tile_index_uses_lsb_first_bits_at_y_times_width_plus_x():
    idx = t.TileIndex(max_zoom=1)
    idx.set(1, 1, 0)
    idx.set(1, 0, 1)
    assert idx.has(1, 1, 0) and idx.has(1, 0, 1) and not idx.has(1, 0, 0)
    assert idx.to_base64()[1] == base64.b64encode(bytes([0b00000110])).decode()


def _mass_from_tiles(out, z):
    total = 0.0
    for p in (out / "tiles" / str(z)).rglob("*.bin"):
        y = int(p.stem)
        d = t.decode_tile(p.read_bytes())
        rows = m.row_area_km2(np.arange(y * 256, y * 256 + 256), z)
        total += (d * rows[:, None]).sum()
    return total


def test_shard_pyramid_writes_tiles_that_conserve_mass(tmp_path):
    mass = np.zeros((4096, 4096))
    mass[1000:1010, 2000:2010] = 50.0   # a dense block
    mass[3000, 100] = 3.0               # a lone village
    idx = t.TileIndex()
    z3 = t.write_shard_pyramid(mass, sx=4, sy=2, out=tmp_path, index=idx)
    assert z3.shape == (256, 256)
    assert z3.sum() == pytest.approx(mass.sum())
    for z in (7, 6, 5, 4, 3):
        assert _mass_from_tiles(tmp_path, z) == pytest.approx(mass.sum(), rel=3e-3)
    assert idx.has(7, 4 * 16 + 2000 // 256, 2 * 16 + 1000 // 256)
    assert not idx.has(7, 4 * 16, 2 * 16)  # empty tile is not written


def test_low_zoom_pyramid_conserves_mass(tmp_path):
    z3 = {(4, 2): np.zeros((256, 256)), (0, 7): np.zeros((256, 256))}
    z3[(4, 2)][10, 10] = 4.0e7   # ~a dense region: tens of people per km2 even at z0
    z3[(0, 7)][200, 5] = 1.0e6
    idx = t.TileIndex()
    t.write_low_zooms(z3, out=tmp_path, index=idx)
    for z in (2, 1, 0):
        assert _mass_from_tiles(tmp_path, z) == pytest.approx(4.1e7, rel=3e-3)
    assert idx.has(0, 0, 0)
