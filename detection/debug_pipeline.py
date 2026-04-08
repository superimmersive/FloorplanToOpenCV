"""Debug Dining right wall gap detection."""
import cv2
import numpy as np

wall_mask = cv2.imread("detection/output/masks/walls_mask.png", cv2.IMREAD_GRAYSCALE)
gray = cv2.cvtColor(cv2.imread("detection/input/GF_clean.jpg"), cv2.COLOR_BGR2GRAY)
_, binary = cv2.threshold(gray, 160, 255, cv2.THRESH_BINARY_INV)

# At x=1900, gap 2 is y=973-1231 (Dining window)
# Check binary pixels in this region
for y in range(970, 1240, 10):
    strip = binary[y, 1880:1920]
    n = np.sum(strip > 0)
    dark_x = np.where(strip > 0)[0] + 1880
    if n > 0:
        print(f"y={y}: {n} binary pixels at x={dark_x.tolist()[:8]}")
    else:
        print(f"y={y}: no binary pixels")

# Check morphological opening of the gap region
print("\n--- Morphological opening test ---")
x_lo, x_hi = 1880, 1920
for gap_name, y0, y1 in [("Kitchen", 398, 684), ("Dining", 973, 1231)]:
    roi = binary[y0:y1, x_lo:x_hi]
    kv = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 40))
    filtered = cv2.morphologyEx(roi, cv2.MORPH_OPEN, kv)
    print(f"{gap_name} gap y={y0}-{y1}: roi_px={np.count_nonzero(roi)}"
          f"  filtered_px={np.count_nonzero(filtered)}")

# Also check grayscale values in the Dining window area
print("\n--- Grayscale at Dining window area ---")
for y in [1000, 1050, 1100, 1150, 1200]:
    strip = gray[y, 1890:1920]
    print(f"y={y}: min={strip.min()} max={strip.max()} mean={strip.mean():.1f}"
          f"  dark(<140)={np.sum(strip<140)}")
