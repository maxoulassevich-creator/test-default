"""Turn a full-frame AI clip into a small zone layer that composites over the static photo.

usage: zone.py clip.mp4 plate.png outdir
writes outdir/zone.mp4 (cropped to the moving area), outdir/zone_mask.png, outdir/zone.json
Streams frames (three passes) so memory stays small; motion analysis runs at half resolution.
"""
import json, subprocess, sys, os, numpy as np
from PIL import Image, ImageFilter

clip, plate_path, outdir = sys.argv[1:4]
os.makedirs(outdir, exist_ok=True)
plate = np.asarray(Image.open(plate_path).convert('RGB'), np.float32)
H, W = plate.shape[:2]
h2, w2 = H // 2, W // 2
plate2 = np.asarray(Image.open(plate_path).convert('RGB').resize((w2, h2), Image.BILINEAR), np.float32)

def read_frames(w, h):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", clip, "-vf", f"scale={w}:{h}:flags=lanczos",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    n = w * h * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n: break
        yield np.frombuffer(b, np.uint8).reshape(h, w, 3).astype(np.float32)
    p.wait()

def smooth(a, k=12):
    pad = np.pad(a, ((k, k), (0, 0)), mode='edge')
    return np.stack([np.convolve(pad[:, c], np.ones(2*k+1)/(2*k+1), mode='valid') for c in range(a.shape[1])], 1)

fps = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate",
                      "-of", "csv=p=0", clip], capture_output=True, text=True).stdout.strip()

# pass 1 (half res): global exposure/tint lock factors and per-frame difference to the clean plate
raw = []
for f in read_frames(w2, h2):
    raw.append(f)
means = np.array([f.reshape(-1, 3).mean(0) for f in raw])
gain = plate2.reshape(-1, 3).mean(0) / smooth(means)
diff = np.stack([np.abs(f * g - plate2).mean(2) for f, g in zip(raw, gain)]).astype(np.float32)
del raw
N = len(diff)
noise = np.median(diff, axis=0)
motion = (diff - noise[None]) > 18                     # N,h2,w2 : pixels that clearly differ (object + its shadow)
union = motion.mean(0) > 0.004
m = Image.fromarray((union * 255).astype(np.uint8)).resize((W, H), Image.NEAREST)
m = m.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(31))
mm = np.asarray(m) > 0
ys, xs = np.nonzero(mm)
if len(xs) == 0: raise SystemExit("no motion found")
pad_px = 24
x0, x1 = max(0, xs.min() - pad_px), min(W, xs.max() + pad_px)
y0, y1 = max(0, ys.min() - pad_px), min(H, ys.max() + pad_px)
x0 -= x0 % 2; y0 -= y0 % 2; x1 -= (x1 - x0) % 2; y1 -= (y1 - y0) % 2
m.filter(ImageFilter.GaussianBlur(10)).crop((x0, y0, x1, y1)).save(os.path.join(outdir, 'zone_mask.png'))
print(f"frames={N} fps={fps} bbox=({x0},{y0})-({x1},{y1}) size={x1-x0}x{y1-y0}")

# pass 2 (full res, crop only): local background color offset inside the bbox
bx0, by0, bx1, by1 = x0 // 2, y0 // 2, x1 // 2, y1 // 2
pl = plate[y0:y1, x0:x1]
offs = []
for i, f in enumerate(read_frames(W, H)):
    c = f[y0:y1, x0:x1] * gain[i]
    bg = ~np.asarray(Image.fromarray((motion[i, by0:by1, bx0:bx1] * 255).astype(np.uint8)).resize((x1-x0, y1-y0), Image.NEAREST)).astype(bool)
    offs.append((pl[bg] - c[bg]).mean(0) if bg.sum() > 100 else np.zeros(3))
offs = smooth(np.array(offs))

# pass 3: write the cropped, color-locked zone clip
enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{x1-x0}x{y1-y0}",
                        "-r", fps, "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "20",
                        "-pix_fmt", "yuv420p", "-movflags", "+faststart", os.path.join(outdir, 'zone.mp4')],
                       stdin=subprocess.PIPE)
for i, f in enumerate(read_frames(W, H)):
    enc.stdin.write(np.clip(f[y0:y1, x0:x1] * gain[i] + offs[i] + .5, 0, 255).astype(np.uint8).tobytes())
enc.stdin.close(); enc.wait()

activity = motion[:, by0:by1, bx0:bx1].mean((1, 2))
json.dump({"image": [W, H], "bbox": [int(x0), int(y0), int(x1), int(y1)], "fps": fps, "frames": N,
           "activity": [round(float(a), 5) for a in activity]}, open(os.path.join(outdir, 'zone.json'), 'w'))
print("activity first/last 5:", np.round(activity[:5], 4), np.round(activity[-5:], 4), "max", activity.max().round(4))
