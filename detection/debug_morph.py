"""Debug: test morphological tick extraction."""
import os
import cv2
import numpy as np

os.makedirs("detection/output/debug", exist_ok=True)

gray = cv2.cvtColor(cv2.imread("detection/input/GF_clean.jpg"), cv2.COLOR_BGR2GRAY)
wall_mask = cv2.imread("detection/output/masks/walls_mask.png", cv2.IMREAD_GRAYSCALE)

_, binary = cv2.threshold(gray, 160, 255, cv2.THRESH_BINARY_INV)
wall_dilated = cv2.dilate(wall_mask, np.ones((15, 15), np.uint8))
binary_walls = cv2.bitwise_and(binary, wall_dilated)

# Remove horizontal structures → leftover = vertical tick marks
kh = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 1))
opened_h = cv2.morphologyEx(binary_walls, cv2.MORPH_OPEN, kh)
v_ticks = cv2.subtract(binary_walls, opened_h)

# Remove vertical structures → leftover = horizontal tick marks
kv = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 15))
opened_v = cv2.morphologyEx(binary_walls, cv2.MORPH_OPEN, kv)
h_ticks = cv2.subtract(binary_walls, opened_v)

# Save individual images
cv2.imwrite("detection/output/debug/debug_v_ticks.png", v_ticks)
cv2.imwrite("detection/output/debug/debug_h_ticks.png", h_ticks)

# Combined colour overlay
img = cv2.imread("detection/input/GF_clean.jpg")
overlay = img.copy()
overlay[v_ticks > 0] = (255, 0, 0)    # blue = vertical ticks
overlay[h_ticks > 0] = (0, 0, 255)    # red = horizontal ticks
cv2.imwrite("detection/output/debug/debug_morph_ticks.png", overlay)

# Count connected components per image
for name, tick_img in [("v_ticks", v_ticks), ("h_ticks", h_ticks)]:
    n, _, stats, centroids = cv2.connectedComponentsWithStats(tick_img, 8)
    areas = [stats[i, cv2.CC_STAT_AREA] for i in range(1, n)]
    print(f"{name}: {n-1} components, "
          f"area range {min(areas) if areas else 0}-{max(areas) if areas else 0}")

print("Saved: output/debug/debug_morph_ticks.png")
