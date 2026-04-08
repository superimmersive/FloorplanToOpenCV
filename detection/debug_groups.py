"""Debug: list all raw tick groups."""
import detect_windows as dw
import cv2

gray = cv2.cvtColor(cv2.imread("detection/input/GF_clean.jpg"), cv2.COLOR_BGR2GRAY)
wm = cv2.imread("detection/output/masks/walls_mask.png", cv2.IMREAD_GRAYSCALE)

h_t, v_t = dw.extract_ticks(gray, wm, min_len=8, max_len=40,
                              hough_thr=6, max_gap=3, wall_dilation=15)

h_w = dw.group_ticks(v_t, "v", wall_thick=35, min_count=3,
                      max_spacing=55, min_span=40)
v_w = dw.group_ticks(h_t, "h", wall_thick=35, min_count=3,
                      max_spacing=55, min_span=40)
all_d = h_w + v_w
print(f"Total: {len(h_w)} horizontal + {len(v_w)} vertical = {len(all_d)}")

for i, d in enumerate(all_d):
    x1, y1, x2, y2 = d["bbox"]
    bw, bh = x2 - x1, y2 - y1
    orient = d["orientation"]
    n = d["num_ticks"]
    cv_ = d["spacing_cv"]
    wo = dw.filter_wall_overlap([dict(d)], wm, min_frac=0.0)
    wf = wo[0].get("wall_overlap", 0) if wo else 0
    print(f"  {i+1:2d}: [{x1:4d},{y1:4d}]-[{x2:4d},{y2:4d}]  "
          f"{orient:10s}  t={n:2d}  {bw:3d}x{bh:3d}  "
          f"cv={cv_:.2f}  wall={wf:.3f}")
