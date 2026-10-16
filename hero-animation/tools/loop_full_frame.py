# Seamless loop with exposure/tint lock.
# 1) measure per-frame plane means, 2) smooth them, 3) lock every frame to frame 0's means,
# 4) drop the first F frames and crossfade the last F frames into them.
import subprocess, sys, json, numpy as np
src, dst = sys.argv[1], sys.argv[2]
F = int(sys.argv[3]) if len(sys.argv) > 3 else 30
crf = sys.argv[4] if len(sys.argv) > 4 else "20"
info = json.loads(subprocess.run(["ffprobe","-v","error","-select_streams","v:0","-count_frames",
    "-show_entries","stream=width,height,r_frame_rate,nb_read_frames","-of","json",src],capture_output=True,check=True).stdout)["streams"][0]
w, h, N, fps = info["width"], info["height"], int(info["nb_read_frames"]), info["r_frame_rate"]
ys, cs = w * h, (w // 2) * (h // 2)
size = ys + 2 * cs

def frames():
    p = subprocess.Popen(["ffmpeg","-v","error","-i",src,"-f","rawvideo","-pix_fmt","yuv420p","-"],stdout=subprocess.PIPE)
    for i in range(N):
        buf = p.stdout.read(size)
        if len(buf) < size: raise SystemExit(f"short read at frame {i}")
        yield np.frombuffer(buf, np.uint8)
    p.wait()

# pass 1: plane means
st = np.array([[f[:ys].mean(), f[ys:ys+cs].mean(), f[ys+cs:].mean()] for f in frames()])
k = 15  # ~0.5 s moving average so the correction never flickers
pad = np.pad(st, ((k, k), (0, 0)), mode="edge")
sm = np.stack([np.convolve(pad[:, c], np.ones(2*k+1)/(2*k+1), mode="valid") for c in range(3)], axis=1)
ref = st[0]
gainY = (ref[0] - 16) / (sm[:, 0] - 16)
offU, offV = ref[1] - sm[:, 1], ref[2] - sm[:, 2]

def corrected(i, f):
    f = f.astype(np.float32)
    f[:ys] = 16 + (f[:ys] - 16) * gainY[i]
    f[ys:ys+cs] += offU[i]; f[ys+cs:] += offV[i]
    return f

enc = subprocess.Popen(["ffmpeg","-v","error","-y","-f","rawvideo","-pix_fmt","yuv420p","-s",f"{w}x{h}","-r",fps,"-i","-",
    "-c:v","libx264","-preset","slow","-crf",crf,"-pix_fmt","yuv420p","-movflags","+faststart",dst],stdin=subprocess.PIPE)
head = []
for i, f in enumerate(frames()):
    c = corrected(i, f)
    if i < F: head.append(c); continue
    if i >= N - F:
        a = (i - (N - F) + 1) / F
        a = a * a * (3 - 2 * a)
        c = c * (1 - a) + head[i - (N - F)] * a
    enc.stdin.write(np.clip(c + 0.5, 0, 255).astype(np.uint8).tobytes())
enc.stdin.close(); enc.wait()
print(f"{src}: {N} -> {N-F} frames, crossfade {F}, Y gain range {gainY.min():.3f}..{gainY.max():.3f}")
