"""Quick analysis of measurement data already captured by text detection."""
import json

with open("detection/output/json/detected_text.json") as f:
    texts = json.load(f)

dims, rooms, areas, fragments = [], [], [], []
ROOM_NAMES = {"LOUNGE", "KITCHEN", "LAUNDRY", "STUDY", "WC", "HALL", "DINING", "ST"}

for t in texts:
    txt = t["text"].strip()
    conf = t["conf"]
    bbox = t["bbox"]
    cx = sum(p[0] for p in bbox) / 4
    cy = sum(p[1] for p in bbox) / 4
    orient = t["orientation"]

    upper = txt.upper()
    if any(rn in upper for rn in ROOM_NAMES):
        rooms.append((txt, conf, cx, cy))
    elif "m?" in txt or "m2" in txt:
        areas.append((txt, conf, cx, cy))
    elif "SF" in upper:
        areas.append((txt, conf, cx, cy))
    elif "'" in txt or "[" in txt:
        dims.append((txt, conf, cx, cy, orient))
    elif len(txt) <= 2 and txt.isdigit():
        fragments.append((txt, conf, cx, cy))
    else:
        pass

print("=== ROOM NAMES ===")
for txt, conf, cx, cy in rooms:
    print(f"  {txt:20s}  conf={conf:.2f}  pos=({cx:.0f},{cy:.0f})")

print(f"\n=== ROOM AREAS ({len(areas)}) ===")
for txt, conf, cx, cy in areas:
    print(f"  {txt:20s}  conf={conf:.2f}  pos=({cx:.0f},{cy:.0f})")

print(f"\n=== DIMENSIONS ({len(dims)}) ===")
for txt, conf, cx, cy, orient in dims:
    print(f"  {txt:25s}  conf={conf:.2f}  pos=({cx:.0f},{cy:.0f})  {orient}")

print(f"\n=== FRAGMENTS ({len(fragments)} single-digit detections) ===")
print("  (Parts of dimension strings that EasyOCR fragmented)")

print("\n=== EXPECTED DIMENSIONS (from floor plan) ===")
print("  Top:      4362[14'-4] INCL BAY  |  2126[7'-0]  |  3517[11'-6]")
print("  Bottom:   2324[7'-7]  |  1045[3'-5]  |  3517[11'-6]")
print("  Left:     4160[13'-8]  |  2611[8'-7]")
print("  Right:    3960[13'-0]  |  2904[9'-6]")
print("  Interior: 1450[4'-9]")
