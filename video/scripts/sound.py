"""Procedural sound design for the Shardly film. Every cue is timed to the
same seconds as composition.html. Writes video/out/sound.wav (48 kHz stereo)."""
import os, wave
import numpy as np

SR = 48000
DUR = 20.0
N = int(SR * DUR)
rng = np.random.default_rng(7)
L = np.zeros(N); R = np.zeros(N)

def t_axis(d): return np.arange(int(d * SR)) / SR

def band(x, lo, hi):
    """FFT band-pass with soft edges."""
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    m = np.clip((f - lo * 0.7) / (lo * 0.3 + 1e-9), 0, 1) * np.clip((hi * 1.3 - f) / (hi * 0.3), 0, 1)
    return np.fft.irfft(X * m, len(x))

def add(at, sig, gain=1.0, pan=0.0):
    i = int(at * SR); j = min(N, i + len(sig))
    if i >= N or j <= i: return
    s = sig[: j - i] * gain
    L[i:j] += s * np.sqrt((1 - pan) / 2) * 1.414; R[i:j] += s * np.sqrt((1 + pan) / 2) * 1.414

def env_exp(d, tau, attack=0.0015):
    t = t_axis(d); a = np.clip(t / attack, 0, 1)
    return a * np.exp(-t / tau)

def key(at, heavy=False):
    d = 0.09 if not heavy else 0.16
    n = rng.standard_normal(int(d * SR))
    body = band(n, 1800, 5200) * env_exp(d, 0.010)
    click = band(rng.standard_normal(int(d * SR)), 4000, 9000) * env_exp(d, 0.0025)
    thock = np.sin(2 * np.pi * (180 if heavy else 260) * t_axis(d)) * env_exp(d, 0.02 if heavy else 0.012)
    sig = 0.5 * body + 0.35 * click + (0.6 if heavy else 0.25) * thock
    add(at, sig, 0.35 * rng.uniform(0.8, 1.1) * (1.6 if heavy else 1), pan=rng.uniform(-0.15, 0.15))

def tick(at, f=2400, gain=0.32, pan=0.0):
    d = 0.08
    t = t_axis(d)
    sig = np.sin(2 * np.pi * f * t) * env_exp(d, 0.012) + 0.4 * np.sin(2 * np.pi * f * 2.01 * t) * env_exp(d, 0.006)
    sig += 0.3 * band(rng.standard_normal(len(t)), 3000, 10000) * env_exp(d, 0.002)
    add(at, sig, gain, pan)

def hit(at, f=52, gain=0.9, d=1.6):
    t = t_axis(d)
    sweep = f * (1 + 1.2 * np.exp(-t / 0.03))
    ph = 2 * np.pi * np.cumsum(sweep) / SR
    sig = np.sin(ph) * env_exp(d, 0.45, 0.003) + 0.25 * np.sin(2 * ph) * env_exp(d, 0.18)
    sig += 0.15 * band(rng.standard_normal(len(t)), 80, 600) * env_exp(d, 0.03)
    add(at, sig, gain)

def whoosh(at, d, lo, hi, gain=0.18, rise=True, pan_sweep=False):
    n = rng.standard_normal(int(d * SR)); t = t_axis(d)
    chunks = 24; out = np.zeros_like(n); seg = len(n) // chunks
    for k in range(chunks):  # stepped sweep through bands
        p = k / (chunks - 1); p = p if rise else 1 - p
        c = lo * (hi / lo) ** p
        piece = band(n[k * seg:(k + 1) * seg + seg], c * 0.7, c * 1.4)[:seg]
        out[k * seg:(k + 1) * seg] = piece
    shape = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.5
    sig = out * shape
    if pan_sweep:
        i = int(at * SR); j = min(N, i + len(sig)); pan = np.linspace(-0.8, 0.8, j - i)
        L[i:j] += sig[: j - i] * gain * np.sqrt((1 - pan) / 2) * 1.414; R[i:j] += sig[: j - i] * gain * np.sqrt((1 + pan) / 2) * 1.414
    else: add(at, sig, gain)

def tear(at):
    d = 0.16; t = t_axis(d)
    n = rng.standard_normal(len(t))
    crushed = np.repeat(n[::12], 12)[: len(t)]
    buzz = np.sign(np.sin(2 * np.pi * (900 - 3500 * t) * t))
    sig = (0.6 * band(crushed, 300, 7000) + 0.3 * buzz) * (np.abs(np.sin(2 * np.pi * 38 * t)) > 0.25) * env_exp(d, 0.08)
    add(at, sig, 0.55)
    hit(at, 46, 0.6, 0.6)

def blip(at, f, gain=0.14, d=0.18, pan=0.0):
    t = t_axis(d)
    add(at, (np.sin(2 * np.pi * f * t) + 0.2 * np.sin(2 * np.pi * f * 3 * t)) * env_exp(d, 0.05, 0.004), gain, pan)

# ---------- Act 1 ----------
for k in [0.62, 0.70, 0.77, 0.86, 1.0, 1.07, 1.14, 1.30, 1.38, 1.45, 1.55, 1.62, 1.71]: key(k)
key(1.86, heavy=True)
# 1.86 -> 2.1 : silence

# drone 2.1 -> 16.4, resolves into a sustained chord, gone by 19.8
t = np.arange(N) / SR
dr_env = np.clip((t - 2.1) / 1.6, 0, 1) ** 2 * (1 - np.clip((t - 16.3) / 0.5, 0, 1))
duck = 1 - 0.7 * np.exp(-np.clip(t - 7.0, 0, None) / 0.35) * (t >= 7.0)
drone = (np.sin(2 * np.pi * 55 * t) + 0.5 * np.sin(2 * np.pi * 82.41 * t + 0.4 * np.sin(2 * np.pi * 0.13 * t)) + 0.25 * np.sin(2 * np.pi * 110.3 * t)) * (0.85 + 0.15 * np.sin(2 * np.pi * 0.25 * t))
L += 0.07 * drone * dr_env * duck; R += 0.07 * np.roll(drone, 40) * dr_env * duck
chord_env = np.clip((t - 16.75) / 0.25, 0, 1) * (1 - np.clip((t - 18.9) / 0.9, 0, 1))
chord = sum(a * np.sin(2 * np.pi * f * t) for f, a in [(55, 1), (110, 0.6), (164.8, 0.35), (220, 0.25), (329.6, 0.12), (440, 0.06)])
L += 0.08 * chord * chord_env; R += 0.08 * np.roll(chord, 60) * chord_env

# ---------- Act 2 ----------
for k, at in enumerate([4.75, 5.25, 5.75, 6.2]): tick(at, 2400 if k != 2 else 3200, 0.34, pan=-0.3 + 0.2 * k)
blip(5.88, 1320, 0.12); blip(5.95, 1760, 0.10)                 # ack
whoosh(4.88, 0.4, 600, 2600, 0.07)                                  # record 1 fills
whoosh(6.4, 0.6, 500, 1800, 0.06)                                   # record 2 fills, dies
tear(7.0)
whoosh(7.5, 0.9, 400, 5000, 0.16, pan_sweep=True)                   # recovery scan
blip(8.12, 330, 0.12, 0.3); blip(8.2, 247, 0.10, 0.35)              # torn write discarded
# odometer: clicks that slow down as the counters settle
ts = []
for start, dur, cnt in [(8.62, 0.85, 22), (8.77, 0.8, 12), (8.92, 0.75, 18)]:
    u = np.linspace(0, 1, cnt) ** 1.9
    ts += list(start + u * dur)
for at in sorted(ts): tick(at, rng.uniform(3600, 4400), 0.08, pan=rng.uniform(-0.4, 0.4))
hit(9.62, 50, 1.0, 1.8)                                              # the 0 lands

# ---------- Act 3 ----------
whoosh(9.95, 0.7, 300, 3000, 0.08)                                  # underline -> box
tick(10.95, 1800, 0.12)
q = "replayWalRecord"
for i in range(len(q)): key(10.86 + i * 0.062 + (0.03 if i % 4 == 3 else 0) + (0.04 if i > 6 else 0))
whoosh(12.0, 0.25, 1500, 8000, 0.12)                                # crack
for i in range(3): tick(12.62 + i * 0.09, 2000 + i * 400, 0.16, pan=-0.3 + 0.3 * i)
for i in range(3): blip(13.15 + i * 0.096, [880, 988, 1175][i], 0.08, pan=-0.2 + 0.2 * i)
whoosh(14.3, 0.5, 200, 1200, 0.08)                                  # row lifts
for i in range(2): blip(14.88 + i * 0.12, [660, 880][i], 0.07, 0.3)
whoosh(15.28, 0.55, 300, 4000, 0.1)                                 # bars stack
tick(15.85, 2800, 0.2)                                               # total lands

# ---------- lockup ----------
whoosh(16.1, 0.6, 2000, 200, 0.1, rise=False)                       # bar collapses to hairline
hit(16.75, 41, 0.8, 2.8)
for i in range(7): blip(16.78 + i * 0.07, 1760 * 2 ** (i / 12 * 2), 0.025, 0.5, pan=-0.5 + i / 6)
for i in range(9): tick(17.78 + i * 0.07, 5200, 0.025)
key(18.78); key(19.3)

# hard silence on the last frames
cut = int(19.8 * SR); L[cut:] = 0; R[cut:] = 0
# fade edges, soft-limit, normalize
st = np.stack([L, R], 1)
st = np.tanh(st * 1.4) / np.tanh(1.4)
st /= max(1e-9, np.abs(st).max()) / 0.89
os.makedirs(os.path.join(os.path.dirname(__file__), "..", "out"), exist_ok=True)
path = os.path.join(os.path.dirname(__file__), "..", "out", "sound.wav")
with wave.open(path, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st * 32767).astype(np.int16).tobytes())
print("wrote", os.path.abspath(path))
