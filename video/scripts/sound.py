"""Score and sound design for the Shardly film.

Every cue is read from video/timeline.json, the same file composition.html
uses, so picture and sound cannot drift. Everything is synthesized with numpy:
a soft piano for the light-mode opening, a 100 BPM pulse that builds through
the six chapters, real silence after kill -9, and a resolve when daylight
returns. A convolution reverb glues it together. Mids carry the important
sounds so the mix still reads on phone and laptop speakers.
Writes video/out/sound.wav (48 kHz stereo)."""
import json, os, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TL = json.load(open(os.path.join(HERE, "..", "timeline.json")))
SR = 48000
DUR = float(TL["duration"])
N = int(SR * DUR)
BEAT = 0.6                      # 100 BPM
rng = np.random.default_rng(11)
DL = np.zeros(N); DR = np.zeros(N)   # dry bus
WL = np.zeros(N); WR = np.zeros(N)   # reverb send


def ta(d): return np.arange(int(d * SR)) / SR
def hz(n): return 440.0 * 2 ** ((n - 69) / 12)


def band(x, lo, hi):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    m = np.clip((f - lo * 0.7) / (lo * 0.3 + 1e-9), 0, 1) * np.clip((hi * 1.3 - f) / (hi * 0.3), 0, 1)
    return np.fft.irfft(X * m, len(x))


def add(at, sig, gain=1.0, pan=0.0, rev=0.2):
    i = int(at * SR); j = min(N, i + len(sig))
    if at < 0 or i >= N or j <= i: return
    s = sig[: j - i] * gain
    l, r = np.sqrt((1 - pan) / 2) * 1.414, np.sqrt((1 + pan) / 2) * 1.414
    DL[i:j] += s * l; DR[i:j] += s * r
    if rev: WL[i:j] += s * l * rev; WR[i:j] += s * r * rev


def decay(d, tau, attack=0.002):
    t = ta(d); return np.clip(t / attack, 0, 1) * np.exp(-t / tau)


def saw(f, d, harmonics=10, detune=0.0):
    t = ta(d); out = np.zeros_like(t)
    for k in range(1, harmonics + 1):
        if f * k > 9000: break
        out += np.sin(2 * np.pi * f * k * t * (1 + detune)) / k
    return out


# ---------------- instruments ----------------
def piano(at, n, gain=0.16, pan=0.0, d=3.2, rev=0.5):
    f = hz(n); t = ta(d); sig = np.zeros_like(t)
    for k, amp in enumerate([1, 0.45, 0.22, 0.12, 0.07, 0.04], 1):
        fk = f * k * np.sqrt(1 + 0.0004 * k * k)          # slight string stiffness
        sig += amp * np.sin(2 * np.pi * fk * t) * np.exp(-t / (1.6 / k ** 0.7))
    sig += 0.25 * band(rng.standard_normal(len(t)), 1500, 6000) * decay(d, 0.004)
    add(at, sig * np.clip(t / 0.004, 0, 1), gain, pan, rev)


def chord(at, notes, gain=0.1, spread=0.0, **kw):
    for k, n in enumerate(notes): piano(at + k * spread, n, gain, pan=-0.4 + 0.8 * k / max(1, len(notes) - 1), **kw)


def pluck(at, n, gain=0.1, pan=0.0, d=0.35, rev=0.15):
    f = hz(n)
    sig = saw(f, d, 8) * decay(d, 0.08) + 0.5 * np.sin(2 * np.pi * f * 2 * ta(d)) * decay(d, 0.035)
    add(at, sig, gain, pan, rev)


def pad(t0, t1, notes, gain=0.04, fade_in=0.8, fade_out=1.2, bright=7, rev=0.4):
    d = t1 - t0
    if d <= 0: return
    sig = sum(saw(hz(n), d, bright, detune=0.003 * ((k % 2) * 2 - 1)) for k, n in enumerate(notes))
    t = ta(d); env = np.clip(t / fade_in, 0, 1) * np.clip((d - t) / fade_out, 0, 1)
    sig *= env * (0.85 + 0.15 * np.sin(2 * np.pi * 0.25 * t))
    add(t0, sig, gain, rev=rev)


def drone(t0, t1, n, gain=0.08, rev=0.3):
    d = t1 - t0; t = ta(d); f = hz(n)
    sig = 0.35 * np.sin(2 * np.pi * f * t) + 0.7 * np.sin(2 * np.pi * f * 2.003 * t) + 0.45 * np.sin(2 * np.pi * f * 3 * t) + 0.2 * np.sin(2 * np.pi * f * 4.01 * t)
    env = np.clip(t / 1.5, 0, 1) * np.clip((d - t) / 1.5, 0, 1)
    add(t0, sig * env, gain, rev=rev)


def kick(at, gain=0.4):
    d = 0.35; t = ta(d)
    f = 50 + 110 * np.exp(-t / 0.03)
    body = np.tanh(2.4 * np.sin(2 * np.pi * np.cumsum(f) / SR) * decay(d, 0.12, 0.001))
    click = band(rng.standard_normal(len(t)), 1500, 6000) * decay(d, 0.003, 0.0005)
    knock = np.sin(2 * np.pi * 170 * t) * decay(d, 0.03)
    add(at, 0.7 * body + 0.35 * click + 0.6 * knock, gain, rev=0.05)


def hat(at, gain=0.04, pan=0.3):
    d = 0.06; add(at, band(rng.standard_normal(int(d * SR)), 6500, 12000) * decay(d, 0.012), gain, pan, 0.05)


def bass(at, n, d=0.55, gain=0.16):
    f = hz(n); t = ta(d)
    sig = np.tanh(1.6 * (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2 * t))) * decay(d, 0.25, 0.004)
    add(at, sig, gain, rev=0.05)


def key(at, heavy=False, gain=0.22, pan=None):
    d = 0.18 if heavy else 0.1
    t = ta(d)
    sig = 0.55 * band(rng.standard_normal(len(t)), 1600, 5200) * decay(d, 0.010) + 0.35 * band(rng.standard_normal(len(t)), 4000, 9000) * decay(d, 0.0025)
    sig += (0.7 if heavy else 0.35) * np.sin(2 * np.pi * (230 if heavy else 330) * t) * decay(d, 0.02 if heavy else 0.012)
    add(at, sig, gain * rng.uniform(0.85, 1.1) * (1.5 if heavy else 1), rng.uniform(-0.2, 0.2) if pan is None else pan, 0.08)


def tick(at, f=2400, gain=0.12, pan=0.0, rev=0.1):
    d = 0.08; t = ta(d)
    sig = np.sin(2 * np.pi * f * t) * decay(d, 0.012) + 0.4 * np.sin(2 * np.pi * f * 2.01 * t) * decay(d, 0.006)
    sig += 0.3 * band(rng.standard_normal(len(t)), 3000, 10000) * decay(d, 0.002)
    add(at, sig, gain, pan, rev)


def blip(at, f, gain=0.1, d=0.3, pan=0.0, rev=0.25):
    t = ta(d)
    add(at, (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * f * 2 * t) + 0.1 * np.sin(2 * np.pi * f * 3 * t)) * decay(d, d / 4, 0.003), gain, pan, rev)


def chime(at, n, gain=0.08, pan=0.0):
    f = hz(n); d = 1.6; t = ta(d)
    sig = sum(a * np.sin(2 * np.pi * f * m * t) * np.exp(-t / (0.9 / m ** 0.5)) for a, m in [(1, 1), (0.5, 2.76), (0.25, 5.4)])
    add(at, sig * np.clip(t / 0.002, 0, 1), gain, pan, 0.5)


def thud(at, gain=0.3, f0=70):
    d = 0.5; t = ta(d)
    sig = np.tanh(2 * np.sin(2 * np.pi * np.cumsum(f0 + 60 * np.exp(-t / 0.02)) / SR)) * decay(d, 0.09)
    sig += 0.5 * np.sin(2 * np.pi * 220 * t) * decay(d, 0.03) + 0.2 * band(rng.standard_normal(len(t)), 800, 4000) * decay(d, 0.01)
    add(at, sig, gain, rev=0.15)


def impact(at, gain=0.6, d=3.0, f0=42, rev=0.5):
    t = ta(d)
    sub = np.tanh(2.0 * np.sin(2 * np.pi * np.cumsum(f0 + 130 * np.exp(-t / 0.05)) / SR)) * decay(d, 0.7, 0.002)
    body = (np.sin(2 * np.pi * 147 * t) + 0.6 * np.sin(2 * np.pi * 220 * t) + 0.3 * np.sin(2 * np.pi * 294 * t)) * decay(d, 0.25)
    noise = band(rng.standard_normal(len(t)), 300, 5000) * decay(d, 0.06)
    add(at, 0.3 * sub + 0.8 * body + 0.6 * noise, gain, rev=rev)


def whoosh(at, d, lo, hi, gain=0.12, rise=True, pan_sweep=0.0, rev=0.25):
    n = rng.standard_normal(int(d * SR)); t = ta(d)
    chunks = 32; out = np.zeros_like(n); seg = len(n) // chunks
    for k in range(chunks):
        p = k / (chunks - 1); p = p if rise else 1 - p
        c = lo * (hi / lo) ** p
        out[k * seg:(k + 1) * seg] = band(n[k * seg:(k + 2) * seg], c * 0.7, c * 1.4)[:seg]
    sig = out * np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.4
    if pan_sweep:
        i = int(at * SR); j = min(N, i + len(sig)); pn = np.linspace(-pan_sweep, pan_sweep, j - i)
        for B, w in ((DL, 1), (WL, rev)): B[i:j] += sig[: j - i] * gain * w * np.sqrt((1 - pn) / 2) * 1.414
        for B, w in ((DR, 1), (WR, rev)): B[i:j] += sig[: j - i] * gain * w * np.sqrt((1 + pn) / 2) * 1.414
    else: add(at, sig, gain, rev=rev)


def riser(at, d, gain=0.1, f0=180, oct=2.0):
    t = ta(d)
    ph = 2 * np.pi * np.cumsum(f0 * 2 ** (oct * t / d)) / SR
    sig = (np.sin(ph) + 0.4 * np.sin(2 * ph) + 0.2 * np.sin(3 * ph)) * (t / d) ** 2
    add(at, sig, gain, rev=0.3); whoosh(at, d, 400, 7000, gain * 0.8)


def reverse_swell(end, d=1.4, notes=(62, 69, 74), gain=0.08):
    """A reversed piano chord swelling into `end`."""
    t = ta(d); sig = np.zeros_like(t)
    for n in notes:
        f = hz(n)
        sig += sum(a * np.sin(2 * np.pi * f * k * t) for k, a in [(1, 1), (2, 0.4), (3, 0.15)]) * np.exp(-t / 0.7)
    sig = sig[::-1] * np.clip((d - t[::-1]) / 0.02, 0, 1)
    add(end - d, sig, gain, rev=0.6)


def tear(at):
    d = 0.3; t = ta(d)
    crushed = np.repeat(rng.standard_normal(len(t))[::14], 14)[: len(t)]
    buzz = np.sign(np.sin(2 * np.pi * (1100 - 3000 * t) * t))
    gate = (np.abs(np.sin(2 * np.pi * 31 * t)) > 0.3)
    add(at, (0.6 * band(crushed, 300, 8000) + 0.35 * buzz) * gate * decay(d, 0.14), 0.45, rev=0.0)
    impact(at, 0.4, 0.8, 60, rev=0.1)


def glitch_chatter(t0, t1, gain=0.12):
    at = t0; r = np.random.default_rng(5)
    while at < t1:
        d = r.uniform(0.01, 0.04); f = r.choice([180, 420, 900, 1700, 3100])
        sig = np.sign(np.sin(2 * np.pi * f * ta(d))) * 0.6 + 0.4 * r.standard_normal(int(d * SR))
        add(at, sig, gain, pan=r.uniform(-0.8, 0.8), rev=0.0); at += d + r.uniform(0.0, 0.03)


def air(t0, t1, gain=0.012):
    d = t1 - t0; t = ta(d)
    sig = band(rng.standard_normal(len(t)), 300, 3000) * np.clip(t / 2, 0, 1) * np.clip((d - t) / 2, 0, 1)
    add(t0, sig, gain, rev=0.3)


# ---------------- the music bed ----------------
DM, BB, F_, C_, GM, A_ = [50, 57, 62, 65], [46, 53, 58, 62], [41, 53, 57, 60], [48, 55, 60, 64], [43, 55, 58, 62], [45, 52, 57, 61]
def groove(t0, t1, prog, gain=0.08, kick_g=0.0, hats=False, bass_g=0.0, pattern=(0, 2, 1, 3, 2, 1, 3, 2)):
    """Eighth-note plucks over a chord progression (one chord per bar of 4 beats)."""
    at = t0; step = 0
    while at < t1 - 1e-6:
        bar = int(round((at - t0) / (4 * BEAT) - 0.49)) % len(prog); ch = prog[bar]
        n = ch[pattern[step % 8]] + 12
        pluck(at, n, gain * (1.0 if step % 2 == 0 else 0.7), pan=-0.3 if step % 2 else 0.3)
        if kick_g and step % 2 == 0: kick(at, kick_g * (1.0 if step % 8 == 0 else 0.75))
        if hats and step % 2 == 1: hat(at)
        if bass_g and step % 8 in (0, 3, 6): bass(at, ch[0] - 12, 0.5, bass_g)
        at += BEAT / 2; step += 1


# ================= score, scene by scene =================
T = TL
air(0.0, T["dark"], 0.02)

# 01 open: caret blinks, two piano phrases under the hook
for k in range(2): tick(0.5 + k * 0.667, 1500, 0.05, rev=0.4)
chord(T["hook"], [50, 62, 69], 0.11, spread=0.05)
piano(T["hook"] + 0.6, 72, 0.08); piano(T["hook"] + 0.9, 74, 0.07)
chord(T["hook"] + 1.4, [46, 62, 65, 70], 0.09, spread=0.06)
piano(T["hook"] + 2.0, 77, 0.07)
# the field: plucks arrive, paper flutters past, the counter ticks up
groove(T["field"], T["finds"], [DM, BB], 0.05)
pad(T["field"], T["finds"] + 0.5, [50, 57, 62], 0.022)
r = np.random.default_rng(3)
for k in range(16): whoosh(T["field"] + 0.3 + k * 0.26 + r.uniform(0, 0.1), 0.3, 1500, 6000, 0.03, rise=False, pan_sweep=r.choice([-0.8, 0.8]))
cn0 = T["field"] + 1.2
for k in range(22): tick(cn0 + 1.4 * (k / 21) ** 0.5, 3200 + 40 * k, 0.04, pan=-0.4)
# "Shardly finds it." then the pull into one point and the box opening
chord(T["finds"], [53, 60, 65, 69, 72], 0.1, spread=0.03); pad(T["finds"], T["box"] + 1.0, [41, 53, 60, 65], 0.03, 0.3, 1.0)
riser(T["converge"], T["box"] - T["converge"], 0.07, 220, 2.5)
impact(T["box"], 0.35, 2.0, 55, rev=0.4); chime(T["box"], 81, 0.06); chime(T["box"] + 0.05, 88, 0.04)

# 02 search: a light bed, real keystrokes, enter, results, preview
pad(T["box"] + 0.3, T["question"], [50, 57, 62, 65], 0.022, 1.0, 1.5, bright=5)
groove(T["box"] + 0.6, T["question"] - 0.3, [DM, BB, F_, C_], 0.045)
q = "crash recovery"
for i, ch in enumerate(q):
    at = T["type"] + i * 0.082 + (0.035 if i % 4 == 1 else 0) + (0.06 if i > 5 else 0)
    key(at, gain=0.16 if ch == " " else 0.22)
key(T["enter"], heavy=True); whoosh(T["enter"], 0.4, 1200, 6000, 0.07)
for i in range(4): blip(T["enter"] + 0.9 + i * 0.12, hz(76 + [0, 3, 7, 12][i]), 0.06, 0.3, pan=-0.3 + 0.2 * i)
for k in range(4): blip(T["enter"] + 1.35 + k * 0.12 + 0.1, 2400, 0.025, 0.12)
whoosh(T["preview"], 0.5, 500, 4000, 0.08); blip(T["preview"] + 0.6, hz(86), 0.04, 0.5)
blip(T["annotate"], hz(81), 0.05, 0.4); blip(T["annotate"] + 0.7, hz(84), 0.05, 0.4)
# the question: the bed falls away, one note hangs
drone(T["question"] - 0.2, T["dark"] + 0.4, 38, 0.05)
piano(T["question"], 74, 0.1, d=4.0); piano(T["question"] + 0.5, 69, 0.08, d=4.0)
# collapse to a point, then the night opens
reverse_swell(T["dark"], 1.6, (50, 57, 62, 69), 0.09)
whoosh(T["collapse"] + 0.3, 0.8, 4000, 600, 0.08, rise=False)
impact(T["dark"], 0.85, 4.0, 38, rev=0.7)
whoosh(T["dark"], 1.3, 300, 3000, 0.08, pan_sweep=0.7)

# 03 inside: a dark drone and the six-layer map
drone(T["dark"] + 0.2, T["ingest"] + 1.0, 38, 0.07)
pad(T["inside"], T["ingest"], [38, 45, 50, 57], 0.03, 1.5, 1.5, bright=4)
piano(T["inside"], 62, 0.09, d=4.0); piano(T["inside"] + 1.2, 65, 0.07, d=4.0)
for i in range(6): tick(T["map"] + 0.15 + i * 0.12, 2000 + 200 * i, 0.07, pan=-0.6 + 0.24 * i)
riser(T["map"] + 1.4, 1.6, 0.05, 330, 1.0)
for i in range(6): pluck(T["map"] + 1.4 + i * 0.32, [62, 65, 69, 72, 74, 77][i], 0.07, pan=-0.6 + 0.24 * i)
whoosh(T["ingest"] - 0.9, 0.9, 3000, 500, 0.06, rise=False)

# 04 the chapters: a 100 BPM pulse that builds, a sweep on every chapter change
CH = ["ingest", "analyze", "index", "rank", "store", "recover"]
for c in CH[1:]:
    whoosh(T[c] - 0.3, 0.8, 600, 5000, 0.08, pan_sweep=0.8); thud(T[c] + 0.15, 0.22)
thud(T["ingest"] + 0.1, 0.3)
groove(T["ingest"], T["analyze"], [DM, BB, F_, C_], 0.05, kick_g=0.18)
groove(T["analyze"], T["index"], [DM, BB, F_, C_], 0.055, kick_g=0.2, hats=True)
groove(T["index"], T["rank"], [GM, BB, F_, A_], 0.055, kick_g=0.22, hats=True, bass_g=0.12)
groove(T["rank"], T["store"], [DM, BB, F_, C_], 0.06, kick_g=0.24, hats=True, bass_g=0.14)
groove(T["store"], T["recover"], [GM, BB, DM, A_], 0.055, kick_g=0.2, hats=True, bass_g=0.12)
for c, notes in [("ingest", [38, 50, 57]), ("analyze", [38, 50, 57]), ("index", [43, 50, 55]), ("rank", [38, 50, 57]), ("store", [43, 50, 58])]:
    pad(T[c], T[CH[CH.index(c) + 1]], notes, 0.018, 1.0, 1.0, bright=4)

c = T["ingest"]
for i in range(5): tick(c + 2.2 + i * 0.42 + 0.85, 2600, 0.08, pan=0.2)
rej = c + 2.2 + 5 * 0.42 + 0.9 + 0.85
blip(rej, 180, 0.14, 0.25); blip(rej + 0.09, 150, 0.12, 0.3); whoosh(rej + 0.05, 0.6, 2000, 300, 0.05, rise=False)
for k in range(7): tick(c + 3.4 + k * 0.22, 3400, 0.04, pan=0.5)
for k in range(2): thud(c + 7.4 + k * 0.15, 0.12, 110)

c = T["analyze"]
for k in range(8): tick(c + 2.2 + k * 0.05, 2800 + 90 * k, 0.06, pan=-0.6 + 0.17 * k)
blip(c + 3.4, hz(79), 0.06, 0.25); blip(c + 3.5, hz(84), 0.05, 0.25)
blip(c + 4.6, hz(76), 0.07, 0.4); blip(c + 4.75, hz(69), 0.06, 0.45)
tick(c + 5.85, 5200, 0.07); tick(c + 5.95, 5600, 0.06)
chime(c + 6.8, 81, 0.06)
tick(c + 8.7, 3000, 0.07); tick(c + 8.78, 3300, 0.06)
for k in range(4): blip(c + 9.3 + k * 0.14, hz(81 + [0, 3, 7, 10][k]), 0.05, 0.25)

c = T["index"]
for k in range(10): blip(c + 1.9 + k * 0.32 + 0.5, hz(74 + [0, 3, 7, 0, 5, 10, 0, 12, 0, 0][k]), 0.045, 0.2, pan=0.4)
chime(c + 5.0, 81, 0.06); chime(c + 5.1, 86, 0.04)
whoosh(c + 8.4, 2.4, 300, 4000, 0.05)
for k in range(48): tick(c + 8.4 + k * 0.05, 1800 + 30 * k, 0.025, pan=-0.6 + k / 40)
impact(c + 11.6, 0.35, 2.2, 52, rev=0.5); chime(c + 11.6, 86, 0.06); chime(c + 11.65, 93, 0.04)

c = T["rank"]
for i in range(3): blip(c + 2.5 + i * 0.35, hz(72 + 4 * i), 0.05, 0.3)
t0 = c + 5.3; d = 2.3; tt = ta(d)
ph = 2 * np.pi * np.cumsum(hz(64) * (1 + 1.2 * (1 - np.exp(-tt / 0.45)))) / SR
add(t0, np.sin(ph) * 0.5 * np.clip(tt / 0.1, 0, 1) * np.clip((d - tt) / 0.3, 0, 1), 0.06, rev=0.3)
blip(c + 9.0, hz(84), 0.06, 0.3); blip(c + 9.3, hz(72), 0.06, 0.3)
thud(c + 11.9, 0.14, 90); thud(c + 12.4, 0.14, 90); chime(c + 12.9, 86, 0.07)
whoosh(c + 13.8, 0.7, 600, 3500, 0.06)

c = T["store"]
for k in range(40): tick(c + 1.2 + 2.0 * (k / 39) ** 1.2, 2200 + (k % 3) * 300, 0.035, pan=-0.7 + 1.4 * k / 39)
for i in range(4): tick(c + 3.8 + i * 0.12, 3000, 0.05)
blip(c + 5.2, hz(81), 0.06, 0.3)
whoosh(c + 5.8, 0.5, 4000, 500, 0.07, rise=False); thud(c + 6.3, 0.2, 80)
chime(c + 6.6, 88, 0.05)
for i in range(4): tick(c + 5.3 + i * 0.6, 2600, 0.05)
thud(c + 9.1, 0.18, 60)

# 06 recover: tension, the kill, silence, the replay, the proof
c = T["recover"]; kill = T["kill"]; back = T["restart"]
drone(c, kill, 38, 0.06)
for b in np.arange(c, kill - 0.01, BEAT): kick(b, 0.12); tick(b + BEAT / 2, 1400, 0.03)
for at in (c + 1.6, c + 2.4, c + 3.2):
    tick(at, 2600, 0.12); thud(at + 0.02, 0.1, 100)
blip(c + 3.8, 1320, 0.07, 0.2); blip(c + 3.88, 1760, 0.06, 0.25)
tick(c + 4.6, 2600, 0.12); thud(c + 4.62, 0.1, 100)
riser(c + 5.1, kill - (c + 5.1), 0.08, 160, 1.5)
tear(kill); glitch_chatter(kill + 0.02, kill + 0.35, 0.1)
# blackout: only keys
txt = "process killed by signal 9\n\n$ shardly open ./data"
for k, ch in enumerate(txt):
    if ch.strip(): key(kill + 0.4 + k / 55, gain=0.1)
txt2 = "$ shardly open ./data\n  replaying wal.log … "
for k, ch in enumerate(txt2):
    if ch.strip(): key(back + 0.1 + k / 60, gain=0.08)
whoosh(back, 0.5, 300, 2000, 0.05)
drone(back + 0.3, T["proof"] + 1.0, 45, 0.05)
whoosh(back + 0.9, 1.7, 400, 3000, 0.05, pan_sweep=0.8)
chime(back + 1.5, 81, 0.07)
for k in range(5): tick(back + 2.1 + k * 0.05, 900 - 100 * k, 0.06)
whoosh(back + 2.1, 0.8, 3000, 400, 0.06, rise=False)
chord(back + 3.0, [50, 57, 62, 65], 0.07, spread=0.04)
pf = T["proof"]
ts = []
for start, dur, cnt in [(0.2, 1.3, 30), (0.45, 1.1, 12), (0.7, 1.0, 22)]:
    ts += list(pf + start + np.linspace(0, 1, cnt) ** 2.2 * dur)
for at in sorted(ts): tick(at, rng.uniform(3200, 4200), 0.035, pan=rng.uniform(-0.5, 0.5))
impact(pf + 1.75, 0.6, 3.5, 44, rev=0.6); chord(pf + 1.75, [38, 50, 57, 62, 65], 0.08, spread=0.02)
pad(pf + 1.8, T["light"] + 0.6, [38, 50, 57, 62], 0.03, 0.4, 1.0)

# 07 daylight and the finale
reverse_swell(T["light"] + 1.2, 1.6, (62, 66, 69, 74), 0.08)
whoosh(T["light"], 1.4, 500, 8000, 0.06)
chord(T["recap"], [50, 62, 66, 69], 0.1, spread=0.05)
pad(T["recap"], T["lockup"], [50, 57, 62, 66], 0.025, 0.8, 0.6)
for i in range(6): pluck(T["recap"] + 0.5 + i * 0.16, [62, 66, 69, 74, 78, 81][i], 0.05, pan=-0.6 + 0.24 * i, rev=0.4)
whoosh(T["lockup"] - 0.9, 0.9, 4000, 600, 0.06, rise=False)
impact(T["lockup"], 0.55, 4.0, 42, rev=0.7)
chord(T["lockup"], [38, 50, 57, 62, 66, 69], 0.1, spread=0.03, d=6.0)
pad(T["lockup"], DUR - 0.2, [38, 50, 57, 62, 66, 74], 0.035, 0.2, 4.0)
for i in range(7): pluck(T["lockup"] + 0.2 + i * 0.07, [62, 66, 69, 74, 78, 81, 86][i], 0.04, pan=-0.6 + 0.2 * i, rev=0.5)
piano(T["lockup"] + 1.3, 78, 0.07, d=4.0); piano(T["lockup"] + 2.1, 81, 0.05, d=4.0); piano(T["lockup"] + 2.7, 86, 0.05, d=5.0)

# ---------------- reverb, master ----------------
def reverb_ir(seconds=2.6, seed=1):
    r = np.random.default_rng(seed); t = ta(seconds)
    ir = r.standard_normal(len(t)) * np.exp(-t / 0.55)
    ir = band(ir, 200, 7000)
    ir[: int(0.012 * SR)] = 0
    return ir / np.sqrt((ir ** 2).sum())

def convolve(x, h):
    n = 1 << int(np.ceil(np.log2(len(x) + len(h))))
    return np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(h, n), n)[: len(x)]

L = DL + 0.9 * convolve(WL, reverb_ir(seed=1)); R = DR + 0.9 * convolve(WR, reverb_ir(seed=2))
end = int((DUR - 0.05) * SR); L[end:] = 0; R[end:] = 0
fade = int(2.0 * SR); w = np.linspace(1, 0, fade); L[end - fade:end] *= w; R[end - fade:end] *= w

def highpass(x, fc=55.0):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X * (1 / np.sqrt(1 + (fc / np.maximum(f, 1e-3)) ** 8)), len(x))

st = np.stack([highpass(L), highpass(R)], 1)
st = np.tanh(st * 1.2) / np.tanh(1.2)
st /= max(1e-9, np.abs(st).max()) / 0.89
out = os.path.join(HERE, "..", "out", "sound.wav")
os.makedirs(os.path.dirname(out), exist_ok=True)
with wave.open(out, "wb") as wv:
    wv.setnchannels(2); wv.setsampwidth(2); wv.setframerate(SR)
    wv.writeframes((st * 32767).astype(np.int16).tobytes())
mono = st.mean(1); X = np.abs(np.fft.rfft(mono)) ** 2; f = np.fft.rfftfreq(len(mono), 1 / SR)
print("wrote", os.path.abspath(out))
for lo, hi in [(0, 120), (120, 400), (400, 2000), (2000, 24000)]:
    print(f"  {lo:>5}-{hi:<5} Hz  {100 * X[(f >= lo) & (f < hi)].sum() / X.sum():5.1f}%")
