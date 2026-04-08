"""Debug: examine pixel patterns at window locations."""
import cv2
import numpy as np

gray = cv2.cvtColor(cv2.imread("detection/input/GF_clean.jpg"), cv2.COLOR_BGR2GRAY)

print("=== Kitchen right wall (x=1860-1930) ===")
print("Looking for horizontal tick marks (dark lines crossing vertical wall)")
for y in range(300, 600, 5):
    strip = gray[y, 1860:1930]
    dark = np.where(strip < 130)[0] + 1860
    if len(dark) >= 2:
        print(f"  y={y:4d}: dark pixels at x={list(dark)}")

print("\n=== Right wall: vertical strip profile ===")
print("Average intensity at each y (x=1880-1910)")
for y in range(250, 650, 10):
    mean = gray[y, 1880:1910].mean()
    n_dark = (gray[y, 1880:1910] < 140).sum()
    bar = "#" * n_dark
    print(f"  y={y:4d}: mean={mean:5.1f}  dark_px={n_dark:2d}  {bar}")

print("\n=== Study bottom wall (y=1330-1400) ===")
print("Average intensity at each x (y=1340-1380)")
for x in range(100, 600, 10):
    mean = gray[1340:1380, x].mean()
    n_dark = (gray[1340:1380, x] < 140).sum()
    bar = "#" * n_dark
    if n_dark > 0:
        print(f"  x={x:4d}: mean={mean:5.1f}  dark_px={n_dark:2d}  {bar}")

print("\n=== Bay window left wall (x=80-130) ===")
for y in range(250, 700, 10):
    mean = gray[y, 80:130].mean()
    n_dark = (gray[y, 80:130] < 140).sum()
    if n_dark > 0:
        bar = "#" * n_dark
        print(f"  y={y:4d}: mean={mean:5.1f}  dark_px={n_dark:2d}  {bar}")

print("\n=== Left exterior wall (Lounge/Study) x=80-120 ===")
for y in range(850, 980, 5):
    strip = gray[y, 70:130]
    n_dark = (strip < 140).sum()
    if n_dark > 0:
        dark = np.where(strip < 140)[0] + 70
        print(f"  y={y:4d}: dark at x={list(dark)}")
