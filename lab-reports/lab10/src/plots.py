import csv, statistics as st, collections, sys
import matplotlib; matplotlib.use("svg")
import matplotlib.pyplot as plt
out = sys.argv[1]
plt.rcParams.update({
  "svg.fonttype": "none", "font.family": "Google Sans Flex", "font.size": 10,
  "axes.spines.top": False, "axes.spines.right": False, "axes.edgecolor": "#8a8984",
  "axes.labelcolor": "#52514e", "xtick.color": "#52514e", "ytick.color": "#52514e",
  "axes.grid": True, "grid.color": "#e6e5e0", "grid.linewidth": 0.8, "axes.axisbelow": True,
  "legend.frameon": False,
})
BLUE, ORANGE, AQUA, INK = "#2a78d6", "#eb6834", "#1baf7a", "#0b0b0b"

def agg(fn, key):
    g = collections.defaultdict(list)
    for r in csv.DictReader(open(fn)): g[(float(r["dist"]), r[key])].append(r)
    return g

g = agg("dist.csv", "interf")
ds = sorted(k[0] for k in g if k[1] == "1")
m = lambda c, d: st.mean(float(x[c]) for x in g[(d, "1")])
sd = lambda c, d: st.pstdev(float(x[c]) for x in g[(d, "1")])

def zones(ax):
    for a, b, lab in ((-2, 52.5, "shared channel\n(CSMA/CA)"), (52.5, 82.5, "hidden\nterminal"), (82.5, 152, "out of range")):
        ax.axvspan(a, b, color={"hidden\nterminal": "#fbe3d9"}.get(lab, "#f4f3ef" if a < 0 else "#ffffff"), zorder=0, lw=0)
        ax.text((a + b) / 2, 1.02, lab, transform=ax.get_xaxis_transform(), ha="center", va="bottom", fontsize=8.5, color="#52514e")
    ax.set_xlim(-2, 152)

def save(fig, name):
    fig.savefig(f"{out}/{name}.svg", bbox_inches="tight"); plt.close(fig)

# Fig 1: PDR vs distance
fig, ax = plt.subplots(figsize=(6.6, 3.0))
zones(ax)
ax.axhline(100, color=AQUA, lw=1.5, ls=(0, (4, 3)), label="no interference (baseline)")
ax.errorbar(ds, [m("pdr", d) for d in ds], yerr=[sd("pdr", d) for d in ds], color=BLUE, lw=2, marker="o", ms=4.5, capsize=2, elinewidth=1, label="primary link A→B")
ax.plot(ds, [m("ipdr", d) for d in ds], color=ORANGE, lw=2, marker="s", ms=4, label="interfering link C→D")
ax.set_ylim(0, 110); ax.set_ylabel("Packet delivery ratio (%)"); ax.set_xlabel("Distance d between RX-B and TX-C (m)")
ax.legend(loc="lower right", fontsize=8.5, ncol=1)
save(fig, "pdr")

# Fig 2: throughput
fig, ax = plt.subplots(figsize=(6.6, 2.7))
zones(ax)
ax.plot(ds, [m("thr", d) for d in ds], color=BLUE, lw=2, marker="o", ms=4.5, label="primary A→B")
ax.plot(ds, [m("ithr", d) for d in ds], color=ORANGE, lw=2, marker="s", ms=4, label="interferer C→D")
ax.axhline(4.21, color=AQUA, lw=1.5, ls=(0, (4, 3)), label="primary offered load")
ax.set_ylim(0, 7); ax.set_ylabel("Goodput (Mbit/s)"); ax.set_xlabel("Distance d (m)")
ax.legend(loc="lower right", fontsize=8.5, ncol=3)
save(fig, "thr")

# Fig 3: retries + delay (two panels, not dual axis)
fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.8, 2.5))
for ax in (a1, a2):
    for a, b in ((52.5, 82.5),): ax.axvspan(a, b, color="#fbe3d9", lw=0, zorder=0)
    ax.set_xlim(-2, 152); ax.set_xlabel("Distance d (m)")
a1.bar(ds, [m("retries", d) for d in ds], width=3.4, color=BLUE)
a1.set_ylabel("MAC retransmissions at TX-A"); a1.set_title("Failed attempts (no ACK)", fontsize=9.5, color=INK, loc="left")
a2.plot(ds, [m("delay", d) for d in ds], color=BLUE, lw=2, marker="o", ms=4)
a2.set_yscale("log"); a2.set_ylabel("Mean one-way delay (ms)"); a2.set_title("End-to-end delay, log scale", fontsize=9.5, color=INK, loc="left")
fig.tight_layout(w_pad=2.5)
save(fig, "retry_delay")

# Fig 4: load sweep
g2 = agg("load.csv", "interval")
fig, ax = plt.subplots(figsize=(6.6, 2.7))
cols = {20.0: (BLUE, "o", "d = 20 m (shared)"), 70.0: (ORANGE, "s", "d = 70 m (hidden)"), 120.0: (AQUA, "^", "d = 120 m (far)")}
for d, (c, mk, lab) in cols.items():
    ks = sorted([k for k in g2 if k[0] == d], key=lambda k: -float(k[1]))
    xs = [1024 * 8 / float(k[1]) / 1e6 for k in ks]
    ys = [st.mean(float(x["pdr"]) for x in g2[k]) for k in ks]
    ax.plot(xs, ys, color=c, marker=mk, lw=2, ms=5, label=lab)
ax.set_xlabel("Interferer offered load (Mbit/s)"); ax.set_ylabel("Primary PDR (%)"); ax.set_ylim(50, 104)
ax.legend(loc="lower left", fontsize=8.5)
save(fig, "load")
print("ok")
