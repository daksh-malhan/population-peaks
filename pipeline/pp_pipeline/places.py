"""Natural Earth + GeoNames → per-country place files, search index and border views.

Outputs (the contract with the web client, see docs/data-format.md):
  places/{cid}.json            country outline, its states, its cities (≥15k people, for labels)
  places/pov/{POV}/{cid}.json  outline of a country as drawn in another country's official view
  search.json                  countries, states and cities ≥100k people
"""

import json
import re
import unicodedata
import zipfile
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Iterator

import numpy as np
import shapely
from shapely.geometry import Point, Polygon, shape
from shapely.strtree import STRtree

from . import geom as g

# Natural Earth "point of view" files (lower-case NE code) and the ISO country whose official view each is.
POV_ISO2 = {
    "arg": "AR", "bdg": "BD", "bra": "BR", "chn": "CN", "deu": "DE", "egy": "EG", "esp": "ES", "fra": "FR",
    "gbr": "GB", "grc": "GR", "idn": "ID", "ind": "IN", "isr": "IL", "ita": "IT", "jpn": "JP", "kor": "KR",
    "mar": "MA", "nep": "NP", "nld": "NL", "pak": "PK", "pol": "PL", "prt": "PT", "pse": "PS", "rus": "RU",
    "sau": "SA", "swe": "SE", "tur": "TR", "twn": "TW", "ukr": "UA", "usa": "US", "vnm": "VN",
}
# Browsers sometimes report pre-rename IANA ids (Chrome long reported "Asia/Calcutta").
TZ_ALIASES = {
    "Asia/Calcutta": "Asia/Kolkata", "Europe/Kiev": "Europe/Kyiv", "Asia/Katmandu": "Asia/Kathmandu",
    "Asia/Saigon": "Asia/Ho_Chi_Minh", "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
    "US/Eastern": "America/New_York", "US/Central": "America/Chicago", "US/Mountain": "America/Denver",
    "US/Pacific": "America/Los_Angeles", "US/Alaska": "America/Anchorage", "US/Hawaii": "Pacific/Honolulu",
    "US/Arizona": "America/Phoenix", "PRC": "Asia/Shanghai", "Asia/Chongqing": "Asia/Shanghai",
    "Asia/Chungking": "Asia/Shanghai", "Asia/Harbin": "Asia/Shanghai", "ROC": "Asia/Taipei", "ROK": "Asia/Seoul",
    "Japan": "Asia/Tokyo", "Israel": "Asia/Jerusalem", "Asia/Tel_Aviv": "Asia/Jerusalem", "Turkey": "Europe/Istanbul",
    "Asia/Istanbul": "Europe/Istanbul", "W-SU": "Europe/Moscow", "Poland": "Europe/Warsaw", "Portugal": "Europe/Lisbon",
    "GB": "Europe/London", "GB-Eire": "Europe/London", "Egypt": "Africa/Cairo", "Brazil/East": "America/Sao_Paulo",
    "Asia/Ujung_Pandang": "Asia/Makassar", "Asia/Dacca": "Asia/Dhaka",
}
CITY_CODES = {"PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLA5", "PPLC", "PPLG", "PPLL", "PPLS", "PPLF"}
LABEL_MIN_POP = 15_000
SEARCH_MIN_POP = 100_000
_LATIN = re.compile(r"^[A-Za-zÀ-ɏḀ-ỿ][A-Za-zÀ-ɏḀ-ỿ '’.\-()]*$")
_ISO2 = re.compile(r"^[A-Z]{2}$")
_ADM1 = re.compile(r"^[A-Z]{3}-\d{1,6}$")


def country_id(props: dict) -> str:
    iso = props.get("ISO_A2_EH") or ""
    return iso if _ISO2.match(iso) else props["ADM0_A3"]


def display_name(props: dict) -> str:
    names = [props.get(k) for k in ("NAME_EN", "NAME_LONG", "NAME") if props.get(k)]
    clean = [n for n in names if "." not in n] or names
    return min(clean, key=len)


def fold(s: str) -> str:
    """Case- and accent-insensitive form used for de-duplicating names."""
    return "".join(c for c in unicodedata.normalize("NFKD", s.casefold()) if not unicodedata.combining(c))


def latin_aliases(name: str, alts: Iterable[str], limit: int) -> list[str]:
    """Distinct Latin-script alternative names in the caller's priority order (first spelling wins)."""
    seen = {fold(name)}
    out: list[str] = []
    for a in alts:
        a = (a or "").strip()
        if len(a) < 3 or len(a) > 40 or not _LATIN.match(a) or (a.isupper() and len(a) <= 3):
            continue
        f = fold(a)
        if f in seen:
            continue
        seen.add(f)
        out.append(a)
        if len(out) == limit:
            break
    return out


def _all_aliases(name: str, values: Iterable[str | None], limit: int = 40) -> list[str]:
    """Every distinct alternative name (any script), splitting Natural Earth's '|' lists."""
    seen = {fold(name)}
    out = []
    for v in values:
        for a in (v or "").split("|"):
            a = a.strip()
            if not a or len(a) > 60 or fold(a) in seen:
                continue
            seen.add(fold(a))
            out.append(a)
    return out[:limit]


# Natural Earth translates city names into these languages; a city's own-language name leads.
_LANG_OF = {
    "DE": ["DE", "AT", "CH", "LI"], "FR": ["FR", "MC", "LU", "HT", "SN", "CI", "CM", "ML", "NE", "BF", "TD", "GA", "CG", "CD", "MG"],
    "ES": ["ES", "MX", "AR", "CO", "PE", "VE", "CL", "EC", "GT", "CU", "BO", "DO", "HN", "PY", "SV", "NI", "CR", "PA", "UY", "GQ"],
    "IT": ["IT", "SM", "VA"], "PT": ["PT", "BR", "AO", "MZ", "GW", "CV", "ST"], "NL": ["NL", "SR"], "PL": ["PL"], "SV": ["SE"],
    "TR": ["TR"], "VI": ["VN"], "HU": ["HU"], "ID": ["ID"], "RU": ["RU", "BY"],
}
LANG_FIELD = {cc: f"NAME_{lang}" for lang, ccs in _LANG_OF.items() for cc in ccs}
OTHER_NAME_FIELDS = ["NAME_DE", "NAME_ES", "NAME_FR", "NAME_IT", "NAME_PT", "NAME_NL", "NAME_PL", "NAME_SV", "NAME_TR",
                     "NAME_VI", "NAME_HU", "NAME_ID"]


def ordered_city_names(fields: dict, cc: str) -> list[str]:
    """Own-language name, then Natural Earth's local/former names, English, then other languages."""
    keys = [LANG_FIELD.get(cc), "NAMEPAR", "NAMEALT", "NAME_EN", *OTHER_NAME_FIELDS]
    out = []
    for key in keys:
        if not key:
            continue
        for v in re.split(r"[|,]", fields.get(key) or ""):
            if v.strip():
                out.append(v.strip())
    return out


class NeCityIndex:
    """Natural Earth populated places, found by GeoNames id, or by name within ~15 km when ids differ."""

    def __init__(self, features: list[dict]):
        self.by_id: dict[str, dict] = {}
        self.by_name: dict[str, list[tuple[float, float, dict]]] = defaultdict(list)
        for f in features:
            p = f["properties"]
            gid = p.get("GEONAMESID") or 0
            if isinstance(gid, (int, float)) and gid > 0:
                self.by_id[str(int(gid))] = p
            g = f.get("geometry") or {}
            if g.get("type") == "Point" and p.get("NAME"):
                lng, lat = g["coordinates"][:2]
                for key in ("NAME", "NAMEASCII", "NAME_EN"):
                    if p.get(key):
                        self.by_name[fold(p[key])].append((lat, lng, p))

    def lookup(self, gid: str, name: str, lat: float, lng: float) -> dict | None:
        if gid in self.by_id:
            return self.by_id[gid]
        for plat, plng, p in self.by_name.get(fold(name), []):
            if abs(plat - lat) < 0.15 and abs(plng - lng) < 0.15 / max(0.2, np.cos(np.radians(lat))):
                return p
        return None


def ne_city_index(src: Path) -> NeCityIndex:
    path = src / "ne_10m_populated_places.geojson"
    return NeCityIndex(json.loads(path.read_text())["features"] if path.exists() else [])


@dataclass
class City:
    id: str
    name: str
    alts: list[str]
    lat: float
    lng: float
    pop: int
    cc: str
    cid: str | None = None
    state: str | None = None


def parse_geonames(lines: Iterable[str]) -> Iterator[City]:
    for line in lines:
        f = line.rstrip("\n").split("\t")
        if len(f) < 19 or f[7] not in CITY_CODES:
            continue
        try:
            lat, lng, pop = float(f[4]), float(f[5]), int(f[14])
        except ValueError:
            continue
        if pop < LABEL_MIN_POP or not (-90 <= lat <= 90 and -180 <= lng <= 180) or not f[0].isdigit():
            continue
        yield City(id=f[0], name=f[1].strip(), alts=[a for a in f[3].split(",") if a], lat=lat, lng=lng, pop=pop, cc=f[8])


def assign_points(polys_by_id: dict[str, list[Polygon]], points: list[tuple[float, float]], max_deg: float = 0.05) -> list[str | None]:
    """Id of the polygon containing each point, else the nearest within max_deg (~5 km), else None."""
    ids, geoms = [], []
    for pid, polys in polys_by_id.items():
        for p in polys:
            ids.append(pid)
            geoms.append(p)
    tree = STRtree(geoms)
    pts = [Point(x, y) for x, y in points]
    out: list[str | None] = [None] * len(pts)
    hits = tree.query(pts, predicate="intersects")
    for pi, gi in zip(*hits):
        if out[pi] is None:
            out[pi] = ids[gi]
    missing = [i for i, v in enumerate(out) if v is None]
    if missing:
        near = tree.query_nearest([pts[i] for i in missing], max_distance=max_deg)
        for mi, gi in zip(*near):
            out[missing[mi]] = ids[gi]
    return out


def pov_changes(base: dict[str, list[Polygon]], view: dict[str, list[Polygon]]) -> list[str]:
    changed = []
    for cid, polys in view.items():
        if cid not in base:
            continue
        a = shapely.make_valid(shapely.union_all(base[cid]))
        b = shapely.make_valid(shapely.union_all(polys))
        diff = g.area_km2(shapely.symmetric_difference(a, b))
        if diff > max(50.0, 0.002 * g.area_km2(a)):
            changed.append(cid)
    return sorted(changed)


def tz_to_pov(zone_tab: str | Path) -> dict[str, str]:
    pov_of_iso = {iso: code.upper() for code, iso in POV_ISO2.items()}
    out = {}
    for line in Path(zone_tab).read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        cc, _coords, tz, *_ = line.split("\t")
        if cc in pov_of_iso:
            out[tz] = pov_of_iso[cc]
    for alias, target in TZ_ALIASES.items():
        if target in out:
            out[alias] = out[target]
    return dict(sorted(out.items()))


def _shift_toward(lng: float, center: float) -> float:
    return lng + 360.0 * round((center - lng) / 360.0)


def _weight_fn(cities: list[City]):
    if not cities:
        return lambda part: 0.0
    xs = np.array([c.lng for c in cities])
    ys = np.array([c.lat for c in cities])
    pops = np.array([c.pop for c in cities], dtype=np.float64)

    def weight(part: Polygon) -> float:
        # Within ~5 km rather than strictly inside: GeoNames puts atoll towns in the lagoon.
        cx = part.centroid.x
        shifted = xs + 360.0 * np.round((cx - xs) / 360.0)
        return float(pops[shapely.dwithin(part, shapely.points(shifted, ys), 0.05)].sum())

    return weight


def _region(prepared: g.Prepared) -> dict:
    return {"bbox": prepared.bbox, "area": prepared.area, "tiny": prepared.tiny, "geom": g.encode(prepared.parts)}


@dataclass
class PlacesSummary:
    countries: list[dict] = field(default_factory=list)
    povs: dict[str, list[str]] = field(default_factory=dict)
    tz_pov: dict[str, str] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=dict)


def _load_features(path: Path) -> list[dict]:
    return json.loads(path.read_text())["features"]


def _write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def build_places(src: Path, out: Path, zone_tab: Path = Path("/usr/share/zoneinfo/zone.tab"), log=print) -> PlacesSummary:
    summary = PlacesSummary()
    admin0 = [f for f in _load_features(src / "ne_10m_admin_0_countries.geojson") if f["geometry"]]
    admin1 = [f for f in _load_features(src / "ne_10m_admin_1_states_provinces.geojson") if f["geometry"]]

    # Countries: ids, raw geometry, metadata. Uninhabited specks (no population estimate) are skipped.
    countries: dict[str, dict] = {}
    a3_to_cid: dict[str, str] = {}
    for f in admin0:
        p = f["properties"]
        if (p.get("POP_EST") or 0) < 100:
            continue
        cid = country_id(p)
        if cid in countries:
            cid = p["ADM0_A3"]
        countries[cid] = {"props": p, "raw": g.parts_of(shapely.make_valid(shape(f["geometry"])))}
        a3_to_cid[p["ADM0_A3"]] = cid
    raw_by_cid = {cid: c["raw"] for cid, c in countries.items()}

    # Cities ≥15k, assigned to a country and a state by containment.
    with zipfile.ZipFile(src / "cities15000.zip") as zf:
        lines = zf.read("cities15000.txt").decode("utf-8").splitlines()
    cities = list(parse_geonames(lines))
    for c, cid in zip(cities, assign_points(raw_by_cid, [(c.lng, c.lat) for c in cities])):
        c.cid = cid
    cities = [c for c in cities if c.cid]

    states_raw: dict[str, dict] = {}
    for f in admin1:
        p = f["properties"]
        sid = p.get("adm1_code") or ""
        if not _ADM1.match(sid):
            continue
        parts = g.parts_of(shapely.make_valid(shape(f["geometry"])))
        cid = a3_to_cid.get(p.get("adm0_a3"))
        if cid is None:
            rep = shapely.union_all(parts).representative_point()
            cid = assign_points(raw_by_cid, [(rep.x, rep.y)])[0]
        if cid is None:
            continue
        states_raw[sid] = {"props": p, "raw": parts, "cid": cid}
    for c, sid in zip(cities, assign_points({k: v["raw"] for k, v in states_raw.items()}, [(c.lng, c.lat) for c in cities])):
        c.state = sid

    cities_by_cid: dict[str, list[City]] = defaultdict(list)
    cities_by_state: dict[str, list[City]] = defaultdict(list)
    for c in cities:
        cities_by_cid[c.cid].append(c)
        if c.state:
            cities_by_state[c.state].append(c)

    search: list[list] = []
    ne_index = ne_city_index(src)
    shutil_rm(out / "places")
    prepared_country: dict[str, g.Prepared] = {}
    ref_lng: dict[str, float] = {}

    for cid, c in sorted(countries.items()):
        p = c["props"]
        biggest = max(c["raw"], key=lambda poly: poly.area)
        ref_lng[cid] = biggest.centroid.x
        prep = g.prepare(shapely.union_all(c["raw"]), weight_of=_weight_fn(cities_by_cid[cid]), ref_lng=ref_lng[cid])
        prepared_country[cid] = prep
        name = display_name(p)
        center = (prep.bbox[0] + prep.bbox[2]) / 2

        states_out = []
        for sid, s in sorted(states_raw.items()):
            if s["cid"] != cid:
                continue
            sp = s["props"]
            sprep = g.prepare(shapely.union_all(s["raw"]), weight_of=_weight_fn(cities_by_state[sid]))
            sname = sp.get("name_en") or sp.get("name") or sid
            stype = (sp.get("type_en") or "Region").split("|")[0]
            states_out.append({"id": sid, "name": sname, "type": stype, **_region(sprep)})
            alts = _all_aliases(sname, [sp.get("name"), sp.get("name_alt"), sp.get("name_local"), sp.get("woe_name"), sp.get("gn_name")], limit=5)
            rank = sum(x.pop for x in cities_by_state[sid])
            search.append([1, sid, sname, alts, f"{stype} in {name}", rank, cid])

        city_rows = []
        for x in sorted(cities_by_cid[cid], key=lambda x: -x.pop):
            lng = round(_shift_toward(x.lng, center), 4)
            city_rows.append([x.id, x.name, lng, round(x.lat, 4), x.pop])
            if x.pop >= SEARCH_MIN_POP:
                state_name = states_raw[x.state]["props"].get("name_en") or states_raw[x.state]["props"].get("name") if x.state else None
                ctx = f"{state_name}, {name}" if state_name and state_name != x.name else name
                fields = ne_index.lookup(x.id, x.name, x.lat, x.lng)
                local = ordered_city_names(fields, x.cc) if fields else []
                aliases = latin_aliases(x.name, local + x.alts, limit=4 if local else 3)
                search.append([2, x.id, x.name, aliases, ctx, x.pop, cid, round(lng, 3), round(x.lat, 3)])

        _write_json(out / "places" / f"{cid}.json", {"v": 1, "id": cid, "name": name, **_region(prep),
                                                       "states": states_out, "cities": city_rows})
        country_alts = _all_aliases(name, [p.get(k) for k in sorted(p) if k.startswith("NAME") and k not in ("NAME_LEN", "NAME_SORT")]
                                    + [p.get("ADMIN"), p.get("FORMAL_EN"), p.get("BRK_NAME"), p.get("NAME_ALT")])
        search.append([0, cid, name, country_alts, p.get("CONTINENT") or "", int(p.get("POP_EST") or 0), cid])
        summary.countries.append({"id": cid, "name": name, "bbox": prep.bbox})

    # Official views of other countries' outlines.
    for code, iso in sorted(POV_ISO2.items()):
        path = src / f"ne_10m_admin_0_countries_{code}.geojson"
        if not path.exists():
            continue
        view = {}
        for f in _load_features(path):
            if not f["geometry"]:
                continue
            cid = country_id(f["properties"])
            if cid in countries:
                view[cid] = g.parts_of(shapely.make_valid(shape(f["geometry"])))
        changed = pov_changes(raw_by_cid, view)
        for cid in changed:
            prep = g.prepare(shapely.union_all(view[cid]), weight_of=_weight_fn(cities_by_cid[cid]), ref_lng=ref_lng[cid])
            _write_json(out / "places" / "pov" / code.upper() / f"{cid}.json", {"v": 1, "id": cid, **_region(prep)})
        if changed:
            summary.povs[code.upper()] = changed
        log(f"  view {code.upper()} ({iso}): {len(changed)} outlines differ")

    search.sort(key=lambda r: (r[0], -r[5], r[2]))
    _write_json(out / "search.json", {"v": 1, "items": search})
    summary.tz_pov = tz_to_pov(zone_tab)
    summary.counts = {"countries": len(countries), "states": len(states_raw), "cities": len(cities),
                      "searchable": len(search)}
    return summary


def shutil_rm(path: Path) -> None:
    import shutil
    shutil.rmtree(path, ignore_errors=True)
