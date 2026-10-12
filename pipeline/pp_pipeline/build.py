"""Command line entry point: python -m pp_pipeline.build <command> ...

  sources       refresh sources/kontur_files.json from HDX + S3 ETags
  tiles         download Kontur files, build the density tile pyramid
  fetch-places  download Natural Earth (pinned blobs) and GeoNames
  places        build place files, search index, border views and manifest.json
"""

import argparse
import json
import shutil
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import numpy as np

from . import kontur, places, sources, splat, tiles

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "sources" / "kontur_files.json"


@dataclass
class BuildStats:
    population: float = 0.0
    cells: int = 0
    duplicates: int = 0
    skipped: int = 0
    tiles: dict[int, int] = field(default_factory=dict)


def build_tiles(gpkgs: Iterable[Path], work: Path, out: Path, cleanup: bool = False, log=print) -> BuildStats:
    """Ingest GeoPackages one at a time into shard files, then rasterise each shard into tiles."""
    shard_dir = work / "shards"
    shutil.rmtree(shard_dir, ignore_errors=True)
    shard_dir.mkdir(parents=True)
    shutil.rmtree(out / "tiles", ignore_errors=True)
    read_stats = kontur.ReadStats()
    stats = BuildStats()

    for gpkg in gpkgs:
        t0 = time.time()
        before = read_stats.cells
        for chunk in kontur.read_cells(gpkg, read_stats):
            rec = splat.cell_records(chunk.lat, chunk.lng, chunk.area, chunk.pop, chunk.cell)
            for (sx, sy), part in splat.route_to_shards(rec).items():
                with open(shard_dir / f"{sx}_{sy}.bin", "ab") as f:
                    part.tofile(f)
        log(f"  ingested {gpkg.name}: {read_stats.cells - before:,} cells in {time.time() - t0:.1f}s")
        if cleanup:
            gpkg.unlink()

    index = tiles.TileIndex()
    shard_mass: dict[tuple[int, int], np.ndarray] = {}
    for shard_file in sorted(shard_dir.glob("*.bin")):
        sx, sy = (int(v) for v in shard_file.stem.split("_"))
        rec = np.fromfile(shard_file, dtype=splat.RECORD)
        unique = splat.dedupe(rec)
        stats.duplicates += len(rec) - len(unique)
        mass = splat.splat_shard(unique, sx, sy)
        shard_mass[(sx, sy)] = tiles.write_shard_pyramid(mass, sx, sy, out, index)
        shard_file.unlink()
        log(f"  shard {sx},{sy}: {len(unique):,} cells")
    tiles.write_low_zooms(shard_mass, out, index)

    (out / "tiles").mkdir(parents=True, exist_ok=True)
    (out / "tiles" / "index.json").write_text(json.dumps({"maxZoom": len(index.bits) - 1, "bits": index.to_base64()}))
    stats.population = float(sum(a.sum() for a in shard_mass.values()))
    stats.cells = read_stats.cells
    stats.skipped = read_stats.skipped
    stats.tiles = {z: index.count(z) for z in range(len(index.bits))}
    return stats


def _selected(countries: str) -> list[dict]:
    entries = json.loads(SOURCES.read_text())
    if countries == "all":
        return entries
    wanted = {c.strip().upper() for c in countries.split(",") if c.strip()}
    chosen = [e for e in entries if e["iso2"] in wanted]
    missing = wanted - {e["iso2"] for e in chosen}
    if missing:
        raise SystemExit(f"unknown country codes: {', '.join(sorted(missing))}")
    return chosen


def _fetch_and_unpack(entries: list[dict], cache: Path, work: Path, used: dict, keep: bool) -> Iterable[Path]:
    for e in entries:
        gz = kontur.download(e, cache)
        used[e["iso2"]] = {"url": e["url"], "sha256": kontur.sha256_file(gz), "etag": e["etag"]}
        yield kontur.gunzip(gz, work / "gpkg" / f"{e['iso2']}.gpkg")
        if not keep:
            gz.unlink()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="pp_pipeline.build")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sources", help="refresh the Kontur file list")
    s.add_argument("--version", default="20231101")
    t = sub.add_parser("tiles", help="download Kontur and build density tiles")
    t.add_argument("--countries", default="all", help="comma-separated ISO2 codes, or 'all'")
    t.add_argument("--cache", type=Path, default=ROOT / "work" / "cache")
    t.add_argument("--work", type=Path, default=ROOT / "work")
    t.add_argument("--out", type=Path, required=True)
    t.add_argument("--keep-downloads", action="store_true")
    f = sub.add_parser("fetch-places", help="download Natural Earth + GeoNames")
    f.add_argument("--src", type=Path, default=ROOT / "work" / "src")
    f.add_argument("--povs", default="all", help="comma-separated Natural Earth view codes, or 'all'")
    p = sub.add_parser("places", help="build places, search index and manifest")
    p.add_argument("--src", type=Path, default=ROOT / "work" / "src")
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--version", default="2023-11-01-dev")
    p.add_argument("--zone-tab", type=Path, default=Path("/usr/share/zoneinfo/zone.tab"))
    args = ap.parse_args(argv)

    if args.cmd == "fetch-places":
        wanted = None if args.povs == "all" else {v.strip().lower() for v in args.povs.split(",")}
        hashes = sources.fetch_place_sources(args.src, wanted)
        (args.src / "hashes.json").write_text(json.dumps(hashes, indent=1, sort_keys=True))
        print(f"{len(hashes)} place sources ready in {args.src}")
        return 0

    if args.cmd == "places":
        t0 = time.time()
        summary = places.build_places(args.src, args.out, zone_tab=args.zone_tab)
        hashes = json.loads((args.src / "hashes.json").read_text()) if (args.src / "hashes.json").exists() else {}
        sources.build_manifest(args.out, args.version, summary.countries, summary.povs, summary.tz_pov, hashes)
        print(f"places {summary.counts} | views {sum(len(v) for v in summary.povs.values())} outlines in "
              f"{len(summary.povs)} views | {time.time() - t0:.0f}s")
        return 0

    if args.cmd == "sources":
        entries = kontur.refresh_sources(args.version)
        SOURCES.parent.mkdir(parents=True, exist_ok=True)
        SOURCES.write_text(json.dumps(entries, indent=1) + "\n")
        print(f"wrote {len(entries)} entries to {SOURCES}")
        return 0

    entries = _selected(args.countries)
    used: dict = {}
    t0 = time.time()
    stats = build_tiles(_fetch_and_unpack(entries, args.cache, args.work, used, args.keep_downloads),
                        work=args.work, out=args.out, cleanup=True)
    (args.out / "tiles" / "sources.json").write_text(json.dumps(used, indent=1, sort_keys=True))
    print(f"population {stats.population:,.0f} | cells {stats.cells:,} | duplicates {stats.duplicates:,} | "
          f"skipped {stats.skipped:,} | tiles {stats.tiles} | {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
