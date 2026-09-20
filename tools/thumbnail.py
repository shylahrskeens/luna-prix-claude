"""Draws the submission thumbnail: 1280x720, no fonts, no dependencies.

Everything is geometry, the same way the game draws itself. Letters are a
hand-cut 5x7 arcade face so the title needs no font file.
"""
import math, zlib, struct, pathlib

W, H = 1280, 720

GLYPHS = {
    'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'N': ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
    'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    'I': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
    'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    'C': ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
    'G': ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'],
    'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
}

px = bytearray(W * H * 3)

def put(x, y, r, g, b, a=1.0):
    if x < 0 or y < 0 or x >= W or y >= H:
        return
    i = (y * W + x) * 3
    if a >= 1:
        px[i] = r; px[i+1] = g; px[i+2] = b
    else:
        px[i] = int(px[i] * (1 - a) + r * a)
        px[i+1] = int(px[i+1] * (1 - a) + g * a)
        px[i+2] = int(px[i+2] * (1 - a) + b * a)

def rect(x0, y0, w, h, col, a=1.0):
    for y in range(int(y0), int(y0 + h)):
        for x in range(int(x0), int(x0 + w)):
            put(x, y, *col, a)

HORIZON = 430

# --- sky: deep space into a sunset -----------------------------------------
for y in range(H):
    if y < HORIZON:
        t = y / HORIZON
        r = int(18 + (255 - 18) * t ** 2.6)
        g = int(10 + (94 - 10) * t ** 2.2)
        b = int(45 + (150 - 45) * (1 - t) + 60 * t)
    else:
        t = (y - HORIZON) / (H - HORIZON)
        r = int(24 + 40 * (1 - t)); g = int(8 + 14 * (1 - t)); b = int(52 + 60 * (1 - t))
    for x in range(W):
        put(x, y, r, g, b)

# --- the sun, banded ---------------------------------------------------------
SUN_X, SUN_Y, SUN_R = W // 2, HORIZON - 40, 165
for y in range(SUN_Y - SUN_R, SUN_Y + SUN_R + 1):
    if y > HORIZON:
        continue
    band = ((y - (SUN_Y - SUN_R)) // 16) % 2 == 0
    gap = y > SUN_Y - 40 and not band
    if gap:
        continue
    dy = y - SUN_Y
    half = int(math.sqrt(max(0, SUN_R * SUN_R - dy * dy)))
    t = (y - (SUN_Y - SUN_R)) / (2 * SUN_R)
    r = int(255); g = int(200 - 120 * t); b = int(120 - 80 * t)
    for x in range(SUN_X - half, SUN_X + half + 1):
        put(x, y, r, g, b)

# --- the grid floor ----------------------------------------------------------
for y in range(HORIZON, H):
    t = (y - HORIZON) / (H - HORIZON)
    if abs(((t ** 1.9) * 26) % 1.0) < 0.09:
        for x in range(W):
            put(x, y, 120, 90, 200, 0.55)
for i in range(-26, 27):
    for y in range(HORIZON, H):
        t = (y - HORIZON) / (H - HORIZON)
        x = int(W / 2 + i * 26 * (0.06 + t * 2.4))
        put(x, y, 150, 110, 230, 0.45)
        put(x + 1, y, 150, 110, 230, 0.25)

# --- trophy ------------------------------------------------------------------
GOLD = (255, 205, 92); GOLD_D = (196, 140, 40); GOLD_L = (255, 236, 176)
CX, CY = W // 2, 300
for y in range(CY - 92, CY + 10):          # bowl
    t = (y - (CY - 92)) / 102
    half = int(86 * (1 - t * 0.72))
    for x in range(CX - half, CX + half):
        shade = (x - (CX - half)) / max(1, 2 * half)
        col = GOLD_L if shade < 0.26 else GOLD if shade < 0.74 else GOLD_D
        put(x, y, *col)
for side in (-1, 1):                        # handles
    for a in range(-90, 91):
        rad = math.radians(a)
        for rr in range(40, 52):
            x = int(CX + side * (74 + math.cos(rad) * rr * 0.62))
            y = int(CY - 58 + math.sin(rad) * rr)
            put(x, y, *GOLD)
rect(CX - 16, CY + 10, 32, 46, GOLD)        # stem
rect(CX - 62, CY + 56, 124, 18, GOLD)       # base
rect(CX - 80, CY + 74, 160, 22, GOLD_D)

def text(s, x, y, cell, col, glow=None):
    cx = x
    for ch in s.upper():
        g = GLYPHS.get(ch, GLYPHS[' '])
        for ry, row in enumerate(g):
            for rxi, c in enumerate(row):
                if c != '#':
                    continue
                if glow:
                    rect(cx + rxi * cell - 2, y + ry * cell - 2, cell + 4, cell + 4, glow, 0.30)
        for ry, row in enumerate(g):
            for rxi, c in enumerate(row):
                if c == '#':
                    shade = ry / 7
                    cc = (min(255, col[0]), min(255, int(col[1] * (1 - shade * 0.35))), min(255, int(col[2] * (1 - shade * 0.15))))
                    rect(cx + rxi * cell, y + ry * cell, cell, cell, cc)
        cx += 6 * cell
    return cx

title = 'LUNA PRIX'
CELL = 17
wide = len(title) * 6 * CELL - CELL
text(title, (W - wide) // 2, 452, CELL, (255, 255, 255), (199, 155, 255))
sub = 'AXIE KART RACING'
CELL2 = 6
wide2 = len(sub) * 6 * CELL2 - CELL2
text(sub, (W - wide2) // 2, 600, CELL2, (140, 220, 235))

def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

raw = bytearray()
for y in range(H):
    raw.append(0)
    raw += px[y * W * 3:(y + 1) * W * 3]
out = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0))
out += chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
p = pathlib.Path('docs/evidence/thumbnail.png')
p.parent.mkdir(parents=True, exist_ok=True)
p.write_bytes(out)
print(f'{p}  {W}x{H}  {len(out)/1024:.0f} KB')
