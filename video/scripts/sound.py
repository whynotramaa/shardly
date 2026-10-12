"""Procedural score and sound design for the Shardly film (30 s, 120 BPM).

Everything is synthesized and timed to the same seconds as composition.html.
Energy is kept in the 150 Hz to 6 kHz range so it carries on phone and laptop
speakers; the final mix is loudness-normalized by ffmpeg when muxing.
Writes video/out/sound.wav (48 kHz stereo)."""
import os, wave
import numpy as np

SR = 48000
DUR = 30.0
N = int(SR * DUR)
BEAT = 0.5
rng = np.random.default_rng(11)
L = np.zeros(N); R = np.zeros(N)
T = np.arange(N) / SR

def ta(d): return np.arange(int(d * SR)) / SR
def note(n): return 440.0 * 2 ** ((n - 69) / 12)   # midi -> Hz

def band(x, lo, hi):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    m = np.clip((f - lo * 0.7) / (lo * 0.3 + 1e-9), 0, 1) * np.clip((hi * 1.3 - f) / (hi * 0.3), 0, 1)
    return np.fft.irfft(X * m, len(x))

def add(at, sig, gain=1.0, pan=0.0):
    i = int(at * SR); j = min(N, i + len(sig))
    if i >= N or j <= i: return
    s = sig[: j - i] * gain
    L[i:j] += s * np.sqrt((1 - pan) / 2) * 1.414; R[i:j] += s * np.sqrt((1 + pan) / 2) * 1.414

def decay(d, tau, attack=0.002):
    t = ta(d); return np.clip(t / attack, 0, 1) * np.exp(-t / tau)

def saw(f, d, harmonics=10, detune=0.0):
    t = ta(d); out = np.zeros_like(t)
    for k in range(1, harmonics + 1):
        if f * k > 9000: break
        out += np.sin(2 * np.pi * f * k * t * (1 + detune)) / k
    return out

# ---------------- instruments ----------------
def pluck(at, n, gain=0.12, pan=0.0, d=0.32):
    f = note(n)
    sig = saw(f, d, 8) * decay(d, 0.09) + 0.5 * np.sin(2 * np.pi * f * 2 * ta(d)) * decay(d, 0.04)
    add(at, sig, gain, pan)

def kick(at, gain=0.5):
    d = 0.32; t = ta(d)
    f = 55 + 120 * np.exp(-t / 0.025)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * decay(d, 0.11, 0.001)
    body = np.tanh(2.6 * body)                          # harmonics so it reads on small speakers
    click = band(rng.standard_normal(len(t)), 1500, 6000) * decay(d, 0.004, 0.0005)
    knock = np.sin(2 * np.pi * 180 * t) * decay(d, 0.03)
    add(at, body + 0.35 * click + 0.4 * knock, gain)

def hat(at, gain=0.06, pan=0.0):
    d = 0.06
    add(at, band(rng.standard_normal(int(d * SR)), 6000, 12000) * decay(d, 0.012), gain, pan)

def key(at, heavy=False, gain=0.32):
    d = 0.1 if not heavy else 0.18
    n = rng.standard_normal(int(d * SR)); t = ta(d)
    sig = 0.55 * band(n, 1600, 5200) * decay(d, 0.010) + 0.35 * band(rng.standard_normal(len(t)), 4000, 9000) * decay(d, 0.0025)
    sig += (0.7 if heavy else 0.35) * np.sin(2 * np.pi * (230 if heavy else 330) * t) * decay(d, 0.02 if heavy else 0.012)
    add(at, sig, gain * rng.uniform(0.85, 1.1) * (1.5 if heavy else 1), rng.uniform(-0.2, 0.2))

def tick(at, f=2400, gain=0.22, pan=0.0):
    d = 0.08; t = ta(d)
    sig = np.sin(2 * np.pi * f * t) * decay(d, 0.012) + 0.4 * np.sin(2 * np.pi * f * 2.01 * t) * decay(d, 0.006)
    sig += 0.3 * band(rng.standard_normal(len(t)), 3000, 10000) * decay(d, 0.002)
    add(at, sig, gain, pan)

def blip(at, f, gain=0.12, d=0.22, pan=0.0):
    t = ta(d)
    add(at, (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * f * 2 * t) + 0.1 * np.sin(2 * np.pi * f * 3 * t)) * decay(d, 0.06, 0.003), gain, pan)

def stab(at, notes, gain=0.12, d=0.7):
    sig = sum(saw(note(n), d, 9, detune=0.002 * (k - 1)) for k, n in enumerate(notes))
    add(at, sig * decay(d, 0.22, 0.004), gain)

def impact(at, gain=0.6, d=1.8, f0=48):
    t = ta(d)
    f = f0 + 140 * np.exp(-t / 0.04)
    sub = np.tanh(2.2 * np.sin(2 * np.pi * np.cumsum(f) / SR)) * decay(d, 0.5, 0.002)
    body = (np.sin(2 * np.pi * 196 * t) + 0.6 * np.sin(2 * np.pi * 294 * t)) * decay(d, 0.16)
    noise = band(rng.standard_normal(len(t)), 300, 5000) * decay(d, 0.05)
    tail = band(rng.standard_normal(len(t)), 800, 6000) * decay(d, 0.5) * 0.15
    add(at, 0.45 * sub + 0.8 * body + 0.6 * noise + tail, gain)

def whoosh(at, d, lo, hi, gain=0.14, rise=True, pan_sweep=False):
    n = rng.standard_normal(int(d * SR)); t = ta(d)
    chunks = 28; out = np.zeros_like(n); seg = len(n) // chunks
    for k in range(chunks):
        p = k / (chunks - 1); p = p if rise else 1 - p
        c = lo * (hi / lo) ** p
        out[k * seg:(k + 1) * seg] = band(n[k * seg:(k + 2) * seg], c * 0.7, c * 1.4)[:seg]
    sig = out * np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.4
    if pan_sweep:
        i = int(at * SR); j = min(N, i + len(sig)); pn = np.linspace(-0.8, 0.8, j - i)
        L[i:j] += sig[: j - i] * gain * np.sqrt((1 - pn) / 2) * 1.414; R[i:j] += sig[: j - i] * gain * np.sqrt((1 + pn) / 2) * 1.414
    else: add(at, sig, gain)

def riser(at, d, gain=0.12):
    t = ta(d)
    f = 220 * 2 ** (2 * t / d)
    tone = saw(1, d, 1) * 0
    ph = 2 * np.pi * np.cumsum(f) / SR
    sig = (np.sin(ph) + 0.4 * np.sin(2 * ph) + 0.2 * np.sin(3 * ph)) * (t / d) ** 2
    add(at, sig, gain); whoosh(at, d, 400, 7000, gain * 0.9)

def tear(at):
    d = 0.18; t = ta(d)
    crushed = np.repeat(rng.standard_normal(len(t))[::12], 12)[: len(t)]
    buzz = np.sign(np.sin(2 * np.pi * (1100 - 4000 * t) * t))
    sig = (0.6 * band(crushed, 300, 7000) + 0.35 * buzz) * (np.abs(np.sin(2 * np.pi * 38 * t)) > 0.25) * decay(d, 0.09)
    add(at, sig, 0.5); impact(at, 0.35, 0.6, 60)

def pad(t0, t1, notes, gain=0.05, fade_in=0.4, fade_out=0.8):
    d = t1 - t0
    sig = sum(saw(note(n), d, 7, detune=0.003 * ((k % 2) * 2 - 1)) for k, n in enumerate(notes))
    t = ta(d); env = np.clip(t / fade_in, 0, 1) * np.clip((d - t) / fade_out, 0, 1)
    add(t0, sig * env, gain)

# ---------------- score ----------------
# A minor pulse on eighth notes; bar = 4 beats = 2 s
PROG = [[57, 64, 69, 64], [53, 60, 65, 60], [55, 62, 67, 62], [52, 59, 64, 59]]   # Am F G Em
def pulse(t0, t1, gain=0.1, every=0.25):
    gain *= 1.6
    at = t0
    while at < t1 - 1e-6:
        bar = int((at // 2.0)) % 4; step = int(round((at % 2.0) / every)) % 4
        pluck(at, PROG[bar][step] + (12 if step == 2 else 0), gain, pan=0.25 if step % 2 else -0.25)
        at += every

# scene 1: cards pop on sixteenths, words land on beats
for i in range(12): tick(0.25 + i * 0.125, 1800 + 120 * i, 0.16, pan=-0.6 + 0.1 * i)
for k, at in enumerate([0.5, 1.0, 1.5]): stab(at, [[57, 64, 69], [53, 60, 65], [55, 62, 67]][k], 0.09, 0.5); kick(at, 0.35)
riser(2.0, 0.95, 0.10)
impact(3.0, 0.7); stab(3.0, [45, 57, 64, 69], 0.08, 1.4)
pulse(3.0, 8.5, 0.07)
for b in np.arange(3.0, 8.5, BEAT): kick(b, 0.22)

# scene 2: typing, enter on the beat, results, preview
q = "crash recovery"
for i in range(len(q)): key(4.55 + i * 0.058 + (0.03 if i % 5 == 2 else 0))
key(5.5, heavy=True); whoosh(5.5, 0.32, 1200, 6000, 0.08)
for i in range(4): blip(6.0 + i * 0.125, note(76 + [0, 3, 7, 12][i]), 0.08, pan=-0.3 + 0.2 * i)
whoosh(7.0, 0.45, 500, 4000, 0.09); blip(7.5, note(88), 0.05, 0.4)
# 8.5 - 9.0: the bed drops out, a breath before the turn
stab(9.0, [57, 60, 64, 69], 0.1, 0.9); kick(9.0, 0.4)
riser(9.0, 1.5, 0.11)
impact(10.5, 0.85, 2.2, 44); stab(10.5, [45, 57, 64, 72], 0.08, 1.6)

# scene 3: the signal descends one layer per three beats; four-on-the-floor underneath
pulse(10.5, 17.0, 0.085)
for b in np.arange(11.0, 17.0, BEAT): kick(b, 0.42)
for b in np.arange(11.25, 17.0, BEAT): hat(b, 0.07, pan=0.3)
for k, at in enumerate([11.0, 12.5, 14.0, 15.5]): blip(at, note(84 - 3 * k), 0.13, 0.5)
for i in range(2): tick(11.1 + i * 0.12, 2600, 0.1)
for i in range(3): tick(11.6 + i * 0.1, 3000, 0.08)
for k in range(22): tick(12.55 + k * 0.016 * 1.4, 4200, 0.03)
blip(13.1, note(81), 0.1, 0.4); blip(13.18, note(88), 0.07, 0.4)
whoosh(14.6, 0.55, 300, 3000, 0.1)
whoosh(15.65, 0.3, 4000, 400, 0.1, rise=False); kick(15.95, 0.5); tick(15.95, 1400, 0.18)
for i in range(8): pluck(17.0 + i * 0.0625, [69, 72, 76, 79, 81, 84, 88, 93][i], 0.09, pan=-0.5 + i / 7)
impact(17.5, 0.45, 1.4, 52); pad(17.5, 19.2, [57, 64, 69, 72], 0.04, 0.05, 0.6)

# scene 4: write path, kill, silence, recovery
whoosh(19.0, 0.5, 300, 2500, 0.08)
pulse(19.0, 21.0, 0.06)
for b in np.arange(19.0, 21.0, BEAT): kick(b, 0.3)
for k, at in enumerate([19.5, 19.85, 20.15, 20.5]): tick(at, 2400 if k != 2 else 3200, 0.24, pan=-0.3 + 0.2 * k)
blip(20.22, 1320, 0.09); blip(20.29, 1760, 0.07)
tear(21.0)
whoosh(21.5, 0.75, 400, 5000, 0.13, pan_sweep=True)
blip(21.9, 330, 0.1, 0.3); blip(21.98, 247, 0.08, 0.35)
ts = []
for start, dur, cnt in [(22.5, 0.8, 22), (22.65, 0.75, 12), (22.8, 0.7, 18)]:
    ts += list(start + np.linspace(0, 1, cnt) ** 1.9 * dur)
for at in sorted(ts): tick(at, rng.uniform(3600, 4400), 0.06, pan=rng.uniform(-0.4, 0.4))
impact(23.5, 0.85, 2.0, 46); stab(23.5, [45, 57, 64, 69, 76], 0.08, 1.4)
pad(23.6, 25.2, [57, 64, 72], 0.03, 0.3, 0.6)

# scene 5: lockup
whoosh(25.0, 0.55, 500, 3500, 0.08)
impact(25.5, 0.6, 2.4, 44)
pad(25.5, 29.6, [45, 57, 64, 69, 76], 0.05, 0.08, 1.4)
for i in range(7): pluck(25.5 + i * 0.07, [69, 72, 76, 79, 81, 84, 88][i], 0.05, pan=-0.5 + i / 6)
blip(26.5, note(81), 0.05, 0.6); blip(27.0, note(84), 0.04, 0.6); blip(27.5, note(88), 0.04, 0.6)
key(28.25, gain=0.25); key(28.85, gain=0.25)

cut = int(29.8 * SR); L[cut:] = 0; R[cut:] = 0
def highpass(x, fc=90.0):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X * (1 / np.sqrt(1 + (fc / np.maximum(f, 1e-3)) ** 8)), len(x))   # 4th-order shape
st = np.stack([highpass(L), highpass(R)], 1)
st = np.tanh(st * 1.3) / np.tanh(1.3)
st /= max(1e-9, np.abs(st).max()) / 0.89
out = os.path.join(os.path.dirname(__file__), "..", "out", "sound.wav")
os.makedirs(os.path.dirname(out), exist_ok=True)
with wave.open(out, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st * 32767).astype(np.int16).tobytes())
mono = st.mean(1); X = np.abs(np.fft.rfft(mono)) ** 2; f = np.fft.rfftfreq(len(mono), 1 / SR)
print("wrote", os.path.abspath(out))
for lo, hi in [(0, 120), (120, 400), (400, 2000), (2000, 24000)]:
    print(f"  {lo:>5}-{hi:<5} Hz  {100 * X[(f >= lo) & (f < hi)].sum() / X.sum():5.1f}%")
