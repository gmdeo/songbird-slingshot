"""Bake real Peak District terrain + OpenStreetMap features into compact game data.

Heights: AWS Terrain Tiles (terrarium). UK data (c) Environment Agency 2015; EU-DEM (Copernicus).
Features: (c) OpenStreetMap contributors, ODbL.

Output (public/data/):
  height.bin  - Uint16 grid N x N, metres * 10, row-major north->south, west->east
  meta.json   - grid size/extent, origin, labelled landmarks, OSM features in local metres
Local coords: x = east metres, z = south metres (three.js), origin = Hollins Cross.
"""
import io, json, math, os, sys, urllib.request
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "data")
SCRATCH = os.environ.get("TMPDIR", "/tmp")
os.makedirs(OUT, exist_ok=True)

LAT0, LON0 = 53.3573637, -1.7972656   # Hollins Cross saddle (OSM)
HALF = 7200.0                          # metres each side
N = 513                                # grid resolution (~28 m spacing)
ZOOM = 13

M_LAT = 111320.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))

def to_local(lat, lon):
    return ((lon - LON0) * M_LON, -(lat - LAT0) * M_LAT)

def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y

def fetch(url, cache):
    p = os.path.join(SCRATCH, cache)
    if not os.path.exists(p):
        req = urllib.request.Request(url, headers={"User-Agent": "gmdeo-songbird-slingshot-build/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r, open(p, "wb") as f:
            f.write(r.read())
    return open(p, "rb").read()

def bake_heights():
    lat_n = LAT0 + HALF / M_LAT; lat_s = LAT0 - HALF / M_LAT
    lon_w = LON0 - HALF / M_LON; lon_e = LON0 + HALF / M_LON
    x0, y0 = tile_xy(lat_n, lon_w, ZOOM); x1, y1 = tile_xy(lat_s, lon_e, ZOOM)
    tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
    w = (tx1 - tx0 + 1) * 256; h = (ty1 - ty0 + 1) * 256
    mosaic = np.zeros((h, w), dtype=np.float32)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            raw = fetch(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{ZOOM}/{tx}/{ty}.png",
                        f"terr_{ZOOM}_{tx}_{ty}.png")
            a = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"), dtype=np.float32)
            elev = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
            mosaic[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = elev
    grid = np.zeros((N, N), dtype=np.float32)
    for j in range(N):
        z = -HALF + 2 * HALF * j / (N - 1)
        lat = LAT0 - z / M_LAT
        for i in range(N):
            x = -HALF + 2 * HALF * i / (N - 1)
            lon = LON0 + x / M_LON
            fx, fy = tile_xy(lat, lon, ZOOM)
            px = (fx - tx0) * 256 - 0.5; py = (fy - ty0) * 256 - 0.5
            ix, iy = int(math.floor(px)), int(math.floor(py)); ax, ay = px - ix, py - iy
            v = (mosaic[iy, ix] * (1 - ax) * (1 - ay) + mosaic[iy, ix + 1] * ax * (1 - ay)
                 + mosaic[iy + 1, ix] * (1 - ax) * ay + mosaic[iy + 1, ix + 1] * ax * ay)
            grid[j, i] = v
    return grid


# ---------------------------------------------------------------- OSM features
LANDMARKS = [
    ("Mam Tor", 53.3492577, -1.8096423, "peak"),
    ("Kinder Scout", 53.3848179, -1.8739001, "plateau"),
    ("Lose Hill", 53.3648903, -1.7714182, "peak"),
    ("Back Tor", 53.3617310, -1.7826410, "peak"),
    ("Win Hill", 53.3623857, -1.7208522, "peak"),
    ("Castleton", 53.3406983, -1.7867905, "village"),
    ("Edale", 53.3687339, -1.8223272, "village"),
    ("Hope", 53.3637439, -1.7534784, "village"),
    ("Barber Booth", 53.3595739, -1.8311532, "hamlet"),
    ("Peveril Castle", 53.3408400, -1.7768155, "castle"),
    ("Winnats Pass", 53.3415044, -1.8010105, "pass"),
    ("Mam Farm", 53.3528456, -1.8011739, "farm"),
    ("Odin Mine", 53.3480486, -1.8007258, "mine"),
    ("Mam Nick", 53.3459118, -1.8153039, "pass"),
]

def ring_local(geom, step=1):
    pts = [to_local(p["lat"], p["lon"]) for p in geom[::step]]
    return [[round(x, 1), round(z, 1)] for x, z in pts]

def inside(x, z, lim=HALF):
    return -lim < x < lim and -lim < z < lim

def area(poly):
    s = 0
    for i in range(len(poly)):
        x1, z1 = poly[i]; x2, z2 = poly[(i + 1) % len(poly)]
        s += x1 * z2 - x2 * z1
    return abs(s) / 2

def bake_osm():
    raw = json.load(open(os.path.join(SCRATCH, "osm_raw.json")))
    woods, water, streams, walls, buildings, roads, trees, rock = [], [], [], [], [], [], [], []
    fields, scrub = [], []
    for e in raw["elements"]:
        t = e.get("tags", {})
        if e["type"] == "node":
            x, z = to_local(e["lat"], e["lon"])
            if t.get("natural") == "tree" and inside(x, z):
                trees.append([round(x, 1), round(z, 1)])
            continue
        geoms = []
        if e["type"] == "way" and "geometry" in e:
            geoms = [e["geometry"]]
        elif e["type"] == "relation":
            geoms = [m["geometry"] for m in e.get("members", []) if m.get("role") == "outer" and "geometry" in m]
        for g in geoms:
            if len(g) < 2:
                continue
            if "building" in t:
                p = ring_local(g)
                if len(p) >= 4 and area(p) > 12:
                    lv = t.get("building:levels")
                    try: lv = int(float(lv))
                    except (TypeError, ValueError): lv = 1 if area(p) < 60 else 2
                    buildings.append({"p": p[:-1] if p[0] == p[-1] else p, "lv": max(1, min(lv, 4)),
                                      "k": "church" if t.get("building") in ("church", "chapel") or t.get("amenity") == "place_of_worship" else "house"})
            elif t.get("natural") == "wood" or t.get("landuse") == "forest":
                p = ring_local(g, 2 if len(g) > 60 else 1)
                if len(p) >= 4: woods.append(p)
            elif t.get("natural") == "water":
                p = ring_local(g)
                if len(p) >= 4: water.append(p)
            elif t.get("waterway") in ("river", "stream"):
                streams.append({"p": ring_local(g, 2 if len(g) > 40 else 1), "w": 6 if t["waterway"] == "river" else 2})
            elif t.get("barrier") in ("wall", "fence"):
                p = ring_local(g)
                if len(p) >= 2: walls.append(p)
            elif t.get("landuse") in ("meadow", "farmland", "grass", "quarry"):
                p = ring_local(g, 2 if len(g) > 60 else 1)
                if len(p) >= 4: fields.append({"p": p, "k": "meadow" if t["landuse"] == "grass" else t["landuse"]})
            elif t.get("natural") in ("scrub", "heath"):
                p = ring_local(g, 2 if len(g) > 60 else 1)
                if len(p) >= 4: scrub.append({"p": p, "k": t["natural"]})
            elif t.get("natural") in ("bare_rock", "scree", "cliff"):
                p = ring_local(g)
                if len(p) >= 2: rock.append({"p": p, "k": t["natural"]})
            elif "highway" in t:
                hw = t["highway"]
                if hw in ("primary", "secondary", "tertiary", "unclassified", "residential", "trunk"):
                    roads.append({"p": ring_local(g), "w": 7 if hw in ("primary", "trunk", "secondary") else 5})
                elif hw in ("footway", "path", "bridleway", "track"):
                    roads.append({"p": ring_local(g, 2 if len(g) > 30 else 1), "w": 1.6})
    marks = []
    for name, la, lo, kind in LANDMARKS:
        x, z = to_local(la, lo)
        marks.append({"n": name, "x": round(x, 1), "z": round(z, 1), "k": kind})
    return {"woods": woods, "water": water, "streams": streams, "walls": walls, "buildings": buildings,
            "roads": roads, "trees": trees, "rock": rock, "landmarks": marks, "fields": fields, "scrub": scrub}

# ------------------------------------------------ near terrain + landcover bake
NEAR_HALF = 450.0
NEAR_N = 257
NEAR_ZOOM = 15

def sample_tiles(zoom, xs, zs):
    """Bilinear-sample terrarium tiles at local coords (arrays). Returns heights."""
    lats = LAT0 - zs / M_LAT; lons = LON0 + xs / M_LON
    n = 2 ** zoom
    fx = (lons + 180) / 360 * n
    fy = (1 - np.arcsinh(np.tan(np.radians(lats))) / np.pi) / 2 * n
    tx0, ty0 = int(fx.min()), int(fy.min()); tx1, ty1 = int(fx.max()), int(fy.max())
    w = (tx1 - tx0 + 1) * 256; h = (ty1 - ty0 + 1) * 256
    mos = np.zeros((h + 1, w + 1), dtype=np.float32)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            raw = fetch(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{zoom}/{tx}/{ty}.png",
                        f"terr_{zoom}_{tx}_{ty}.png")
            a = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"), dtype=np.float32)
            mos[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = \
                a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    mos[-1, :] = mos[-2, :]; mos[:, -1] = mos[:, -2]
    px = (fx - tx0) * 256 - 0.5; py = (fy - ty0) * 256 - 0.5
    px = np.clip(px, 0, w - 1.001); py = np.clip(py, 0, h - 1.001)
    ix = px.astype(int); iy = py.astype(int); ax = px - ix; ay = py - iy
    return (mos[iy, ix] * (1 - ax) * (1 - ay) + mos[iy, ix + 1] * ax * (1 - ay)
            + mos[iy + 1, ix] * (1 - ax) * ay + mos[iy + 1, ix + 1] * ax * ay)

def bake_near():
    lin = np.linspace(-NEAR_HALF, NEAR_HALF, NEAR_N)
    xs, zs = np.meshgrid(lin, lin)
    g = sample_tiles(NEAR_ZOOM, xs, zs).astype(np.float32)
    np.clip(np.round(g * 10), 0, 65535).astype("<u2").tofile(os.path.join(OUT, "near.bin"))
    return g

# landcover palette (albedo, sRGB)
C = {
    "moor": (122, 104, 78), "grass": (104, 138, 66), "rough": (132, 128, 74), "bracken": (140, 110, 58),
    "wood": (46, 74, 38), "scrub": (84, 104, 52), "heath": (110, 84, 92), "meadow": (122, 156, 72),
    "farmland": (138, 162, 84), "rock": (150, 146, 134), "scree": (160, 154, 140), "cliff": (120, 116, 106),
    "water": (58, 92, 112), "road": (96, 94, 90), "path": (170, 150, 118), "wall": (78, 76, 70),
    "building": (90, 82, 76), "quarry": (176, 170, 156),
}

def paint(size, half, heights_fn, feats_raw, px_per_m, draw_walls):
    from PIL import ImageDraw
    img = Image.new("RGB", (size, size))
    # base colour from elevation + slope
    lin = np.linspace(-half, half, size)
    xs, zs = np.meshgrid(lin, lin)
    hgt = heights_fn(xs, zs)
    gy, gx = np.gradient(hgt, lin[1] - lin[0])
    slope = np.hypot(gx, gy)
    rs = np.random.default_rng(7)
    noise = rs.normal(0, 1, (size // 8 + 1, size // 8 + 1))
    noise = np.kron(noise, np.ones((8, 8)))[:size, :size]
    t_moor = np.clip((hgt - 420) / 80, 0, 1)[..., None]
    t_rough = np.clip((hgt - 300) / 120, 0, 1)[..., None]
    base = (np.array(C["grass"]) * (1 - t_rough) + np.array(C["rough"]) * t_rough)
    base = base * (1 - t_moor) + np.array(C["moor"]) * t_moor
    t_br = np.clip((slope - 0.35) / 0.25, 0, 1)[..., None] * 0.6
    base = base * (1 - t_br) + np.array(C["bracken"]) * t_br
    t_rk = np.clip((slope - 0.8) / 0.4, 0, 1)[..., None]
    base = base * (1 - t_rk) + np.array(C["rock"]) * t_rk
    base = base * (1 + noise[..., None] * 0.045)
    img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    def P(poly):
        return [((x + half) * px_per_m, (z + half) * px_per_m) for x, z in poly]
    rng = np.random.default_rng(3)
    for e in feats_raw["fields"]:
        c = np.array(C[e["k"]]) * (0.9 + 0.2 * rng.random())
        d.polygon(P(e["p"]), fill=tuple(int(v) for v in c))
    for e in feats_raw["rock"]:
        if len(e["p"]) >= 3 and e["k"] != "cliff":
            d.polygon(P(e["p"]), fill=C[e["k"] if e["k"] in C else "rock"])
        else:
            d.line(P(e["p"]), fill=C["cliff"], width=max(1, int(4 * px_per_m)))
    for e in feats_raw["scrub"]:
        d.polygon(P(e["p"]), fill=C[e["k"]])
    for p in feats_raw["woods"]:
        d.polygon(P(p), fill=C["wood"])
    for p in feats_raw["water"]:
        d.polygon(P(p), fill=C["water"])
    for s in feats_raw["streams"]:
        d.line(P(s["p"]), fill=C["water"], width=max(1, int(s["w"] * px_per_m)))
    for r in feats_raw["roads"]:
        col = C["road"] if r["w"] > 3 else C["path"]
        d.line(P(r["p"]), fill=col, width=max(1, int(r["w"] * px_per_m)))
    if draw_walls:
        for w in feats_raw["walls"]:
            d.line(P(w), fill=C["wall"], width=max(1, int(0.9 * px_per_m)))
    for b in feats_raw["buildings"]:
        d.polygon(P(b["p"]), fill=C["building"])
    # grain over everything so vector fills blend with the procedural base
    arr = np.asarray(img, dtype=np.float32)
    fine = rs.normal(0, 1, (size // 4 + 1, size // 4 + 1))
    fine = np.kron(fine, np.ones((4, 4)))[:size, :size]
    arr = arr * (1 + fine[..., None] * 0.035 + noise[..., None] * 0.03)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

def clip_near(feats, lim):
    """Keep only features touching the near box; used for the game-ready meta."""
    def near(pts): return any(abs(x) < lim and abs(z) < lim for x, z in pts)
    out = {}
    out["walls"] = [w for w in feats["walls"] if near(w)]
    out["buildings"] = [b for b in feats["buildings"] if near(b["p"])]
    out["trees"] = [t for t in feats["trees"] if abs(t[0]) < 7000 and abs(t[1]) < 7000]
    out["woods"] = feats["woods"]
    return out

def main():
    grid = bake_heights()
    lo, hi = float(grid.min()), float(grid.max())
    print(f"far height range {lo:.1f} .. {hi:.1f} m")
    np.clip(np.round(grid * 10), 0, 65535).astype("<u2").tofile(os.path.join(OUT, "height.bin"))
    near = bake_near()
    print(f"near height range {near.min():.1f} .. {near.max():.1f} m, origin {near[NEAR_N//2, NEAR_N//2]:.1f}")
    feats = bake_osm()

    # far texture: 2048 px over 14.4 km (~7 m/px)
    lin = np.linspace(-HALF, HALF, N)
    def far_h(xs, zs):
        fi = np.clip((xs + HALF) / (2 * HALF) * (N - 1), 0, N - 1.001); fj = np.clip((zs + HALF) / (2 * HALF) * (N - 1), 0, N - 1.001)
        i = fi.astype(int); j = fj.astype(int); a = fi - i; b = fj - j
        return grid[j, i] * (1 - a) * (1 - b) + grid[j, i + 1] * a * (1 - b) + grid[j + 1, i] * (1 - a) * b + grid[j + 1, i + 1] * a * b
    far_img = paint(2048, HALF, far_h, feats, 2048 / (2 * HALF), False)
    far_img.save(os.path.join(OUT, "far.jpg"), quality=84)
    # near texture: 2048 px over 900 m (~0.44 m/px)
    def near_h(xs, zs):
        fi = np.clip((xs + NEAR_HALF) / (2 * NEAR_HALF) * (NEAR_N - 1), 0, NEAR_N - 1.001); fj = np.clip((zs + NEAR_HALF) / (2 * NEAR_HALF) * (NEAR_N - 1), 0, NEAR_N - 1.001)
        i = fi.astype(int); j = fj.astype(int); a = fi - i; b = fj - j
        return near[j, i] * (1 - a) * (1 - b) + near[j, i + 1] * a * (1 - b) + near[j + 1, i] * (1 - a) * b + near[j + 1, i + 1] * a * b
    near_img = paint(2048, NEAR_HALF, near_h, feats, 2048 / (2 * NEAR_HALF), True)
    near_img.save(os.path.join(OUT, "near.jpg"), quality=86)

    game = clip_near(feats, NEAR_HALF)
    meta = {"n": N, "half": HALF, "nearN": NEAR_N, "nearHalf": NEAR_HALF,
            "origin": {"lat": LAT0, "lon": LON0, "name": "Hollins Cross"},
            "minH": lo, "maxH": hi,
            "attribution": "Terrain \u00a9 Environment Agency copyright and/or database right 2015; EU-DEM, Copernicus. Map data \u00a9 OpenStreetMap contributors (ODbL).",
            "landmarks": feats["landmarks"], "walls": game["walls"], "buildings": game["buildings"],
            "trees": game["trees"], "woods": game["woods"]}
    with open(os.path.join(OUT, "meta.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    for k in ("walls", "buildings", "trees", "woods"): print(k, len(game[k]))
    for fn in os.listdir(OUT): print(fn, os.path.getsize(os.path.join(OUT, fn)))

if __name__ == "__main__":
    main()
