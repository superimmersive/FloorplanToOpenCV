"""Debug: visualize all detected tick marks and edges in wall regions."""
import os
import cv2
import math
import numpy as np

os.makedirs("detection/output/debug", exist_ok=True)

img = cv2.imread("detection/input/GF_clean.jpg")
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
wall_mask = cv2.imread("detection/output/masks/walls_mask.png", cv2.IMREAD_GRAYSCALE)

blurred = cv2.GaussianBlur(gray, (3, 3), 0)
edges = cv2.Canny(blurred, 50, 150)

# Try larger dilation to capture tick marks near wall edges
kern = np.ones((15, 15), np.uint8)
wall_region = cv2.dilate(wall_mask, kern)
edges_in_wall = cv2.bitwise_and(edges, wall_region)

lines = cv2.HoughLinesP(edges_in_wall, 1, np.pi / 180,
                         threshold=6, minLineLength=8, maxLineGap=3)
segments = lines.reshape(-1, 4)
print(f"Total Hough segments: {len(segments)}")

vis = img.copy()

h_ticks, v_ticks = [], []
for seg in segments:
    x1, y1, x2, y2 = seg
    length = math.hypot(x2 - x1, y2 - y1)
    if length < 8 or length > 40:
        continue
    angle = math.degrees(math.atan2(y2 - y1, x2 - x1)) % 180
    if angle < 15 or angle > 165:
        h_ticks.append(seg)
        cv2.line(vis, (x1, y1), (x2, y2), (0, 0, 255), 1)   # red = horizontal
    elif 75 < angle < 105:
        v_ticks.append(seg)
        cv2.line(vis, (x1, y1), (x2, y2), (255, 0, 0), 1)   # blue = vertical

print(f"h_ticks={len(h_ticks)}, v_ticks={len(v_ticks)}")
cv2.imwrite("detection/output/debug/debug_ticks_all.png", vis)
print("Saved: output/debug/debug_ticks_all.png")

# Also save edges_in_wall for inspection
cv2.imwrite("detection/output/debug/debug_edges_in_wall.png", edges_in_wall)
print("Saved: output/debug/debug_edges_in_wall.png")

# Show ticks near known window locations
# Right wall (Kitchen): x~1860-1920
right_h = [s for s in h_ticks
           if 1850 < (s[0]+s[2])/2 < 1930]
print(f"\nHorizontal ticks near right wall (x=1850-1930): {len(right_h)}")
for s in sorted(right_h, key=lambda s: (s[1]+s[3])/2):
    print(f"  ({s[0]},{s[1]})-({s[2]},{s[3]}) y_mid={(s[1]+s[3])/2:.0f}")

# Left wall (Study/Lounge): x~100-400
left_h = [s for s in h_ticks
          if 90 < (s[0]+s[2])/2 < 410]
print(f"\nHorizontal ticks near left wall (x=90-410): {len(left_h)}")
for s in sorted(left_h, key=lambda s: (s[1]+s[3])/2):
    print(f"  ({s[0]},{s[1]})-({s[2]},{s[3]}) y_mid={(s[1]+s[3])/2:.0f}")

# Bottom wall (Study/Dining): y~1320-1400
bottom_v = [s for s in v_ticks
            if 1310 < (s[1]+s[3])/2 < 1410]
print(f"\nVertical ticks near bottom wall (y=1310-1410): {len(bottom_v)}")
for s in sorted(bottom_v, key=lambda s: (s[0]+s[2])/2):
    print(f"  ({s[0]},{s[1]})-({s[2]},{s[3]}) x_mid={(s[0]+s[2])/2:.0f}")

# Top area near Lounge/Laundry: y~200-300
top_v = [s for s in v_ticks
         if 190 < (s[1]+s[3])/2 < 310]
print(f"\nVertical ticks near top (y=190-310): {len(top_v)}")
for s in sorted(top_v, key=lambda s: (s[0]+s[2])/2):
    print(f"  ({s[0]},{s[1]})-({s[2]},{s[3]}) x_mid={(s[0]+s[2])/2:.0f}")
