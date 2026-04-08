"""Debug: check tick components near known window locations."""
import cv2
import numpy as np

gray = cv2.cvtColor(cv2.imread("detection/input/GF_clean.jpg"), cv2.COLOR_BGR2GRAY)
wall_mask = cv2.imread("detection/output/masks/walls_mask.png", cv2.IMREAD_GRAYSCALE)

_, binary = cv2.threshold(gray, 160, 255, cv2.THRESH_BINARY_INV)
wall_d = cv2.dilate(wall_mask, np.ones((15, 15), np.uint8))
bw = cv2.bitwise_and(binary, wall_d)

kh = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 1))
v_ticks = cv2.subtract(bw, cv2.morphologyEx(bw, cv2.MORPH_OPEN, kh))

kv = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 15))
h_ticks = cv2.subtract(bw, cv2.morphologyEx(bw, cv2.MORPH_OPEN, kv))


def show_region(name, tick_img, x1, y1, x2, y2):
    roi = tick_img[y1:y2, x1:x2]
    n_white = np.count_nonzero(roi)
    n, _, stats, cents = cv2.connectedComponentsWithStats(roi, 8)
    print(f"\n{name} [{x1},{y1}]-[{x2},{y2}]: {n_white} white px, {n-1} components")
    for i in range(1, min(n, 20)):
        a = stats[i, cv2.CC_STAT_AREA]
        bw = stats[i, cv2.CC_STAT_WIDTH]
        bh = stats[i, cv2.CC_STAT_HEIGHT]
        cx, cy = cents[i]
        print(f"  comp {i}: area={a:4d}  {bw:2d}x{bh:2d}  "
              f"at ({cx+x1:.0f},{cy+y1:.0f})")


# Kitchen right wall: vertical wall with HORIZONTAL tick marks → check h_ticks
show_region("Kitchen R-wall h_ticks", h_ticks, 1840, 200, 1940, 700)

# Dining right wall: similar
show_region("Dining R-wall h_ticks", h_ticks, 1840, 700, 1940, 1400)

# Bay window top: horizontal wall with VERTICAL tick marks → check v_ticks
show_region("Bay top v_ticks", v_ticks, 80, 180, 420, 260)

# Bay window left: vertical wall → check h_ticks
show_region("Bay left h_ticks", h_ticks, 60, 200, 130, 750)

# Study bottom: horizontal wall → check v_ticks
show_region("Study bottom v_ticks", v_ticks, 80, 1310, 650, 1410)

# Top between Laundry-Kitchen: check v_ticks
show_region("Top Laundry-Kit v_ticks", v_ticks, 1500, 180, 1750, 310)

# Left exterior wall (Study): vertical wall → check h_ticks
show_region("Left ext wall h_ticks", h_ticks, 60, 700, 140, 1400)

# Also check what's in the floor plan at Kitchen right wall
print("\n--- Grayscale pixel check near Kitchen right wall ---")
for y in range(350, 600, 40):
    row = gray[y, 1860:1930]
    print(f"  y={y}: min={row.min():3d} max={row.max():3d} mean={row.mean():.0f}")
