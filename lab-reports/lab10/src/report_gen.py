import base64, html, re, pathlib
from pygments import highlight
from pygments.lexers import CppLexer, BashLexer
from pygments.formatters import HtmlFormatter

R = pathlib.Path(__file__).parent
SIM = R.parent / "sim"
b64 = lambda p: base64.b64encode(pathlib.Path(p).read_bytes()).decode()

def svg(name):
    s = (R / "figs" / f"{name}.svg").read_text()
    s = s[s.index("<svg"):]
    s = re.sub(r'width="[\d.]+pt" height="[\d.]+pt"', 'width="100%"', s, count=1)
    return s

def code(path, lexer):
    return highlight(pathlib.Path(path).read_text(), lexer, HtmlFormatter(nowrap=True))

def term(txt):
    out = []
    for line in txt.splitlines():
        e = html.escape(line)
        if line.startswith("$"):
            e = f'<span class="pr">$</span><span class="cmd">{e[1:]}</span>'
        elif line.startswith("Flow"):
            e = f'<span class="fl">{e}</span>'
        else:
            e = re.sub(r"(PDR\s+: )([\d.]+ %)", r'\1<b>\2</b>', e)
        out.append(e)
    return "\n".join(out)

runs = (SIM / "runs.txt").read_text()
cpp = code(SIM / "wifi-interference.cc", CppLexer())
sweep = code(SIM / "sweep.sh", BashLexer())

build = """$ N=$HOME/ns3/install          # ns-3.44 install prefix (headers + lib64)
$ g++ -std=c++20 -O2 -I$N/include wifi-interference.cc -o wifi-interference \\
      -L$N/lib64 $(ls $N/lib64/libns3.44-*.so | sed -E 's#.*/lib(.*)\\.so#-l\\1#') \\
      -Wl,-rpath,$N/lib64
$ ./wifi-interference --PrintHelp | head -14
wifi-interference [Program Options] [General Arguments]

Program Options:
    --linkDist:    TX to RX distance of each pair (m) [30]
    --interfDist:  Distance RX-B to TX-C (m) [50]
    --interf:      Enable interfering transmission [true]
    --simTime:     Simulation time (s) [10]
    --pktSize:     UDP payload size (bytes) [1024]
    --primaryInt:  Primary inter-packet interval (s) [0.002]
    --interfInt:   Interferer inter-packet interval (s) [0.001]
    --rxSens:      PHY RxSensitivity (dBm) [-82]
    --pcap:        Write PCAP traces [false]
    --verbose:     Print a readable summary [false]
    --run:         RNG run number [1]"""

tshark = """$ ./wifi-interference --interfDist=70 --pcap=1 --simTime=4
$ ls *.pcap
lab10-interf-0-0.pcap  lab10-interf-1-0.pcap  lab10-interf-2-0.pcap  lab10-interf-3-0.pcap
$ # data frames put on air by TX-A (seen in TX-A's own capture)
$ tshark -r lab10-interf-0-0.pcap -Y "wlan.fc.type_subtype==0x20 && wlan.ta==00:00:00:00:00:01" | wc -l
1511
$ # ACKs that came back to TX-A
$ tshark -r lab10-interf-0-0.pcap -Y "wlan.fc.type_subtype==0x1d && wlan.ra==00:00:00:00:00:01" | wc -l
1059
$ # data frames from TX-C that RX-B decoded (B can hear C, A cannot)
$ tshark -r lab10-interf-1-0.pcap -Y "wlan.fc.type_subtype==0x20 && wlan.ta==00:00:00:00:00:03" | wc -l
667"""

fonts = f"""
@font-face {{ font-family: 'Google Sans Flex'; src: url(data:font/woff2;base64,{b64(R/'fonts/GoogleSansFlex.woff2')}) format('woff2'); font-weight: 100 1000; font-stretch: 25% 151%; }}
@font-face {{ font-family: 'Geist Serif'; src: url(data:font/woff2;base64,{b64(R/'fonts/GeistSerifVF.woff2')}) format('woff2'); font-weight: 100 900; }}
@font-face {{ font-family: 'Geist Mono'; src: url(data:font/woff2;base64,{b64(R/'fonts/GeistMono-Variable.woff2')}) format('woff2'); font-weight: 100 900; }}
"""

ws1 = b64(R / "figs/ws_hidden_c.png")
ws2 = b64(R / "figs/ws_rxb_c.png")

topo = """
<svg viewBox="0 0 680 210" width="100%" font-family="Google Sans Flex" font-size="12">
  <defs>
    <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2a78d6"/></marker>
    <marker id="ao" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#eb6834"/></marker>
    <marker id="dm" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#8a8984"/></marker>
  </defs>
  <!-- carrier sense ranges (82 m, drawn to scale 2.2 px/m with d = 70 m) -->
  <circle cx="70" cy="92" r="180" fill="#2a78d6" fill-opacity="0.05" stroke="#2a78d6" stroke-opacity="0.35" stroke-dasharray="4 4"/>
  <circle cx="290" cy="92" r="180" fill="#eb6834" fill-opacity="0.05" stroke="#eb6834" stroke-opacity="0.4" stroke-dasharray="4 4"/>
  <text x="74" y="24" fill="#2a78d6" font-size="11">sensing range of TX-A (about 82 m)</text>
  <text x="445" y="24" fill="#c4501f" font-size="11" text-anchor="middle">sensing range of TX-C</text>
  <line x1="84" y1="92" x2="122" y2="92" stroke="#2a78d6" stroke-width="2.5" marker-end="url(#ar)"/>
  <line x1="304" y1="92" x2="342" y2="92" stroke="#eb6834" stroke-width="2.5" marker-end="url(#ao)"/>
  <path d="M276,84 Q215,50 150,84" fill="none" stroke="#eb6834" stroke-width="1.5" stroke-dasharray="3 3" marker-end="url(#ao)"/>
  <text x="213" y="58" text-anchor="middle" fill="#c4501f" font-size="11">interference at RX-B</text>
  <g font-weight="600">
    <circle cx="70" cy="92" r="13" fill="#2a78d6"/><text x="70" y="96.5" fill="#fff" text-anchor="middle">A</text>
    <circle cx="136" cy="92" r="13" fill="#fff" stroke="#2a78d6" stroke-width="2.5"/><text x="136" y="96.5" fill="#2a78d6" text-anchor="middle">B</text>
    <circle cx="290" cy="92" r="13" fill="#eb6834"/><text x="290" y="96.5" fill="#fff" text-anchor="middle">C</text>
    <circle cx="356" cy="92" r="13" fill="#fff" stroke="#eb6834" stroke-width="2.5"/><text x="356" y="96.5" fill="#c4501f" text-anchor="middle">D</text>
  </g>
  <g fill="#52514e" font-size="11" text-anchor="middle">
    <text x="70" y="124">TX-A  n0</text><text x="136" y="124">RX-B  n1</text>
    <text x="290" y="124">TX-C  n2</text><text x="356" y="124">RX-D  n3</text>
  </g>
  <g stroke="#8a8984" stroke-width="1">
    <line x1="70" y1="150" x2="136" y2="150" marker-start="url(#dm)" marker-end="url(#dm)"/>
    <line x1="136" y1="150" x2="290" y2="150" marker-start="url(#dm)" marker-end="url(#dm)"/>
    <line x1="290" y1="150" x2="356" y2="150" marker-start="url(#dm)" marker-end="url(#dm)"/>
  </g>
  <g fill="#0b0b0b" font-size="11.5" text-anchor="middle">
    <text x="103" y="168">L = 30 m</text><text x="213" y="168">d (swept 0 to 150 m)</text><text x="323" y="168">L = 30 m</text>
  </g>
  <text x="400" y="88" fill="#52514e" font-size="11">x axis only, all nodes static</text>
  <text x="400" y="104" fill="#52514e" font-size="11">primary flow  A to B, UDP :9, 4.19 Mbit/s</text>
  <text x="400" y="120" fill="#52514e" font-size="11">interfering flow  C to D, UDP :10, 8.19 Mbit/s</text>
  <text x="10" y="200" fill="#52514e" font-size="11">Drawn for d = 70 m: A and C are outside each other's sensing range, but B sits inside C's. That is the hidden-terminal case.</text>
</svg>"""

ascii_zones = """ d (m)  0 ............ 52 | 53 ........... 82 | 83 ............ 150
        |  A hears C      |  A can't hear C   |  B can't hear C
        |  C hears A      |  B still hears C  |
        |  CSMA/CA shares |  HIDDEN TERMINAL  |  no interaction
        |  the channel    |  collisions at B  |  (spatial reuse)"""

HTML = f"""<!doctype html><html><head><meta charset="utf-8"><title>Lab Assignment 10</title>
<style>
{fonts}
:root {{ --ink:#0b0b0b; --ink2:#52514e; --ink3:#8a8984; --rule:#e2e1dc; --tint:#f6f5f1; --blue:#2a78d6; --orange:#eb6834; --aqua:#1baf7a; }}
@page {{ size: A4; margin: 15mm 15mm 16mm 15mm; }}
* {{ box-sizing: border-box; }}
html {{ background:#fff; }}
body {{ font-family:'Google Sans Flex', sans-serif; font-size:10pt; line-height:1.55; color:var(--ink); margin:0; background:#fff;
  font-variation-settings: 'opsz' 12; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
h1,h2,h3,.serif {{ font-family:'Geist Serif', serif; font-weight:500; letter-spacing:-0.01em; }}
h1 {{ font-size:27pt; line-height:1.12; margin:0 0 6pt; }}
h2 {{ font-size:15pt; margin:20pt 0 6pt; padding-top:6pt; border-top:1px solid var(--ink); display:flex; gap:10pt; align-items:baseline; break-after:avoid; }}
h2 .n {{ font-family:'Geist Mono'; font-size:9pt; color:var(--ink3); font-weight:400; }}
h3 {{ font-size:11.5pt; margin:13pt 0 4pt; break-after:avoid; }}
p {{ margin:0 0 7pt; }}
code, .mono {{ font-family:'Geist Mono', monospace; font-size:8.6pt; }}
p code, li code, td code {{ background:var(--tint); padding:0.5pt 3pt; border-radius:3px; }}
.cover {{ border-bottom:1px solid var(--ink); padding-bottom:12pt; margin-bottom:4pt; }}
.eyebrow {{ font-family:'Geist Mono'; font-size:8.5pt; letter-spacing:0.08em; text-transform:uppercase; color:var(--ink2); margin-bottom:10pt; }}
.sub {{ font-size:11.5pt; color:var(--ink2); max-width:150mm; }}
.meta {{ display:grid; grid-template-columns: repeat(4, 1fr); gap:0; margin-top:14pt; border-top:1px solid var(--rule); }}
.meta div {{ padding:6pt 8pt 0 0; font-size:9pt; }}
.meta span {{ display:block; font-family:'Geist Mono'; font-size:7.5pt; color:var(--ink3); text-transform:uppercase; letter-spacing:0.06em; }}
table {{ border-collapse:collapse; width:100%; font-size:9pt; margin:4pt 0 9pt; break-inside:avoid; }}
th {{ text-align:left; font-weight:600; border-bottom:1px solid var(--ink); padding:4pt 6pt 3pt 0; font-size:8.5pt; }}
td {{ border-bottom:1px solid var(--rule); padding:3.5pt 6pt 3.5pt 0; vertical-align:top; }}
td.num, th.num {{ text-align:right; font-family:'Geist Mono'; font-size:8.5pt; font-variant-numeric: tabular-nums; }}
tr.hl td {{ background:#fdf0ea; }}
figure {{ margin:8pt 0 12pt; break-inside:avoid; }}
figcaption {{ font-size:8.8pt; color:var(--ink2); margin-top:4pt; }}
figcaption b {{ color:var(--ink); font-family:'Geist Serif'; font-weight:600; }}
figure img {{ width:100%; border:1px solid var(--rule); display:block; }}
pre {{ font-family:'Geist Mono', monospace; font-size:7.2pt; line-height:1.36; margin:4pt 0 10pt; white-space:pre-wrap; word-break:break-word; }}
pre.src {{ background:#fbfaf7; border:1px solid var(--rule); border-left:3px solid var(--blue); padding:8pt 10pt; }}
pre.term {{ background:#16161a; color:#d8d7d2; padding:9pt 11pt; border-radius:6px; break-inside:avoid; }}
pre.term .pr {{ color:#1baf7a; }} pre.term .cmd {{ color:#ffffff; }} pre.term .fl {{ color:#8fb8ef; }} pre.term b {{ color:#ffb38f; font-weight:600; }}
pre.ascii {{ background:var(--tint); padding:8pt 10pt; font-size:7.8pt; border-radius:4px; break-inside:avoid; }}
.cols2 {{ column-count:2; column-gap:18pt; }} .cols2 pre.term {{ break-inside:auto; }}
.term-head {{ break-after:avoid; font-family:'Geist Mono'; font-size:7.5pt; color:var(--ink3); margin:8pt 0 -2pt; }}
.callout {{ border-left:3px solid var(--orange); background:#fdf3ee; padding:7pt 10pt; margin:8pt 0 10pt; font-size:9.4pt; break-inside:avoid; }}
.callout.blue {{ border-color:var(--blue); background:#eef4fc; }}
.two {{ display:grid; grid-template-columns:1fr 1fr; gap:14pt; }}
ul, ol {{ margin:0 0 8pt; padding-left:15pt; }} li {{ margin-bottom:2.5pt; }}
.k {{ font-family:'Geist Mono'; font-size:8pt; color:var(--ink3); }}
.pb {{ break-before:page; }}
/* pygments */
.c1,.cm,.c,.cp {{ color:#8a8984; font-style:italic; }} .cp {{ color:#6250d6; font-style:normal; }}
.k,.kt,.kd,.kr,.kc {{ color:#c4501f; }} pre.src .k {{ font-size:inherit; font-family:inherit; }}
.s,.s1,.s2,.sc,.dl {{ color:#008300; }} .mi,.mf,.mh {{ color:#2a78d6; }} .nf,.nb {{ color:#6250d6; }} .nv {{ color:#2a78d6; }}
</style></head><body>

<div class="cover">
  <div class="eyebrow">Computer Networks Lab  ·  Lab Assignment 10</div>
  <h1>Impact of interference on an<br>IEEE 802.11b Wi-Fi link</h1>
  <div class="sub">An ns-3 study of two co-located transmitter and receiver pairs: how far the interfering pair must be before the primary link stops paying for it, and why the worst place to put it is not the closest one.</div>
  <div class="meta">
    <div><span>Name</span>________________</div>
    <div><span>Roll no.</span>________________</div>
    <div><span>Simulator</span>ns-3.44, C++20</div>
    <div><span>Date</span>02 Nov 2026</div>
  </div>
</div>

<h2><span class="n">01</span>Aim</h2>
<p>Build an ns-3 simulation with two wireless links in the same area, one carrying the traffic we care about and one generating interfering traffic. Configure both with IEEE 802.11b, run UDP over each, capture packets with PCAP, measure the packet delivery of the primary link, and repeat while changing the distance between the primary pair and the interfering pair.</p>

<table>
<tr><th style="width:8%">Task</th><th style="width:52%">What was asked</th><th>Where it is done</th></tr>
<tr><td class="num">1</td><td>Two pairs of Wi-Fi nodes (TX + RX)</td><td><code>nodes.Create(4)</code>, Fig. 1, Section 3</td></tr>
<tr><td class="num">2</td><td>Configure devices with IEEE 802.11b</td><td><code>WIFI_STANDARD_80211b</code>, DSSS 11 Mbit/s, ad hoc MAC</td></tr>
<tr><td class="num">3</td><td>Position nodes to study interference</td><td><code>ListPositionAllocator</code>, link budget in Table 2</td></tr>
<tr><td class="num">4</td><td>UDP from transmitter to its receiver</td><td><code>UdpClient</code> on A, <code>UdpServer</code> on B (port 9)</td></tr>
<tr><td class="num">5</td><td>Second transmission that interferes</td><td>C to D on the same channel (port 10), Section 3</td></tr>
<tr><td class="num">6</td><td>PCAP tracing</td><td><code>phy.EnablePcap()</code> with radiotap headers, Section 6</td></tr>
<tr><td class="num">7</td><td>Measure packet delivery under interference</td><td>FlowMonitor + MAC retry traces, Sections 5 and 7</td></tr>
<tr><td class="num">8</td><td>Repeat for different distances</td><td>31 distances x 5 seeds, plus a load sweep, Section 7</td></tr>
</table>

<h2><span class="n">02</span>Background</h2>
<p><b>802.11b PHY.</b> 802.11b runs in the 2.4 GHz band with 22 MHz channels and offers 1, 2, 5.5 and 11 Mbit/s using DSSS and CCK. Every station on the same channel shares one collision domain, so a second link nearby is not "noise" in the abstract; it is a competitor for the same air.</p>
<p><b>CSMA/CA.</b> Before sending, a station listens. If it decodes a preamble or sees energy above its threshold, it defers, then counts down a random backoff. Each unicast frame must be acknowledged; if the ACK does not come, the sender doubles its contention window and tries again, up to the retry limit (<code>FrameRetryLimit</code> = 7 attempts in ns-3.44). This is the mechanism that decides who wins, so it shapes every result below.</p>
<p><b>Three distances that matter.</b> The <i>transmission range</i> is where a frame can be decoded. The <i>carrier-sense range</i> is where a station hears enough to defer. The <i>interference range</i> is where a signal is strong enough to ruin someone else's reception. When the interfering transmitter is outside the sender's sensing range but inside the receiver's, CSMA/CA has nothing to work with. That is the classic <b>hidden-terminal</b> problem, and it turned out to be the most damaging region in this experiment.</p>

<h2><span class="n">03</span>Simulation design</h2>
<figure>{topo}
<figcaption><b>Fig. 1.</b> Topology. Both pairs share one ad hoc 802.11b channel. Only <i>d</i>, the gap between the primary receiver B and the interfering transmitter C, is changed between runs.</figcaption></figure>

<div class="two">
<div>
<h3>Table 1. Parameters</h3>
<table>
<tr><th>Parameter</th><th>Value</th></tr>
<tr><td>Standard / MAC</td><td>802.11b, <code>AdhocWifiMac</code></td></tr>
<tr><td>Rate control</td><td>Constant, DSSS 11 Mbit/s data, 1 Mbit/s control</td></tr>
<tr><td>Tx power</td><td>16 dBm</td></tr>
<tr><td>Rx sensitivity</td><td>-82 dBm</td></tr>
<tr><td>Propagation</td><td>Log-distance, n = 3, 40.05 dB at 1 m</td></tr>
<tr><td>Packet size</td><td>1024 B UDP payload</td></tr>
<tr><td>Primary load</td><td>1 pkt / 2 ms = 4.19 Mbit/s</td></tr>
<tr><td>Interferer load</td><td>1 pkt / 1 ms = 8.19 Mbit/s</td></tr>
<tr><td>Traffic window</td><td>1 s to 10 s (9 s)</td></tr>
<tr><td>Seeds per point</td><td>5 (RngRun 1 to 5)</td></tr>
</table>
</div>
<div>
<h3>Table 2. Link budget</h3>
<p style="font-size:9pt">P<sub>rx</sub>(r) = 16 - 40.05 - 30 log<sub>10</sub>(r) dBm</p>
<table>
<tr><th>Path</th><th class="num">r (m)</th><th class="num">P<sub>rx</sub> (dBm)</th></tr>
<tr><td>A to B (wanted)</td><td class="num">30</td><td class="num">-68.4</td></tr>
<tr><td>C to B, d = 20</td><td class="num">20</td><td class="num">-63.1</td></tr>
<tr><td>C to B, d = 50</td><td class="num">50</td><td class="num">-75.0</td></tr>
<tr><td>C to B, d = 70</td><td class="num">70</td><td class="num">-79.4</td></tr>
<tr><td>A to C, d = 52</td><td class="num">82</td><td class="num">-81.5</td></tr>
<tr><td>C to B, d = 90</td><td class="num">90</td><td class="num">-82.7</td></tr>
</table>
<p style="font-size:9pt">The sweep located the effective sensing edge between 82 m and 83 m, which is within half a dB of the configured -82 dBm.</p>
</div>
</div>

<p><b>Why these numbers.</b> The primary link at 30 m has about 25 dB of margin over the noise floor, so on its own it should lose nothing, and the baseline confirms it. The interferer is deliberately saturated at 8.19 Mbit/s, which is more than an 802.11b channel can carry at 1024 B frames (around 5.7 Mbit/s of goodput). That way it always has a frame waiting and the result shows the worst case rather than a lucky gap in its traffic. RTS/CTS is left off, which is the default and how most real 802.11b networks ran.</p>

<div class="callout blue"><b>Two artifacts I had to remove before the numbers meant anything.</b> (1) Both senders start at exactly t = 1 s, so their ARP request broadcasts collided. Broadcasts are never retried, ns-3 marks the ARP entry dead for 100 s, and the whole flow silently delivered 0 packets in some seeds. The ARP caches are now pre-filled with <code>NeighborCacheHelper</code>. (2) Two CBR sources started at the same instant stay in lock-step forever, so they either always collide or never do. The interferer now starts with a random offset of 1 to 1000 µs per run.</div>

<h2><span class="n">04</span>Source code</h2>
<p>The complete program, <code>wifi-interference.cc</code>. Each numbered comment block maps to a task from Section 1.</p>
<pre class="src">{cpp}</pre>

<h3>Sweep script</h3>
<p>Runs the distance sweep (31 points x 5 seeds, plus 5 baseline runs with the interferer off) and the interferer-load sweep at three representative distances. Seeds for one point run in parallel; the whole thing takes about a minute.</p>
<pre class="src">{sweep}</pre>

<h2><span class="n">05</span>Build and run</h2>
<div class="term-head">terminal · build</div>
<pre class="term">{term(build)}</pre>
<div class="term-head">terminal · four representative runs</div>
<pre class="term" style="column-count:2;column-gap:22pt;column-rule:1px solid #333">{term(runs)}</pre>
<p>Flow 2 loses packets even when it is far away (d = 120 m). That is expected: it offers 8.19 Mbit/s into a channel that carries about 5.7, so its own queue overflows. It is the primary flow that we are judging.</p>

<h2><span class="n">06</span>PCAP analysis</h2>
<p><code>phy.EnablePcap("lab10-interf", devices)</code> writes one capture per node with a radiotap header (<code>DLT_IEEE802_11_RADIO</code>), so every 802.11 frame each radio decoded is visible, including ACKs and retransmissions. The PCAP runs were shortened to 4 s (3 s of traffic) to keep files small.</p>
<figure><img src="data:image/png;base64,{ws1}">
<figcaption><b>Fig. 2.</b> Wireshark, TX-A's capture, d = 70 m, filtered on frames to or from A. Normal exchanges alternate data then ACK. Frames 40 to 41 and 43 to 44 are data frames sent back to back with no ACK between them: B never acknowledged frame 40, so A retransmitted it.</figcaption></figure>
<figure><img src="data:image/png;base64,{ws2}">
<figcaption><b>Fig. 3.</b> Wireshark, RX-B's capture, data frames only. B decodes the interferer's frames (10.1.1.3 to 10.1.1.4) mixed in with its own traffic. B hears C; A does not. This is the evidence for the hidden-terminal reading of the 53 to 82 m region.</figcaption></figure>

<div class="term-head">terminal · counting frames with tshark</div>
<pre class="term">{term(tshark)}</pre>

<h3>Table 3. Frame accounting from the captures</h3>
<table>
<tr><th>Scenario</th><th class="num">Data frames sent by A</th><th class="num">ACKs back to A</th><th class="num">MAC retries (trace)</th><th class="num">C frames decoded at B</th></tr>
<tr><td>No interferer</td><td class="num">1500</td><td class="num">1500</td><td class="num">0</td><td class="num">0</td></tr>
<tr><td>d = 20 m (shared)</td><td class="num">1249</td><td class="num">1172</td><td class="num">77</td><td class="num">1234</td></tr>
<tr class="hl"><td>d = 70 m (hidden)</td><td class="num">1511</td><td class="num">1059</td><td class="num">452</td><td class="num">667</td></tr>
<tr><td>d = 120 m (far)</td><td class="num">1500</td><td class="num">1500</td><td class="num">0</td><td class="num">0</td></tr>
</table>
<p>The bookkeeping closes exactly in every row: <i>frames sent = ACKs received + MAC retries</i>. So the PCAP files and the MAC trace sources agree with each other, which is a cheap but useful check that the measurement code is counting what it claims to. Note the two interference cases fail in opposite ways. At 20 m A sends <i>fewer</i> frames than its application produced (1249 of 1500) because it keeps deferring to C. At 70 m A sends <i>more</i> frames than it had (1511) because it never defers but keeps having to retransmit.</p>

<h2><span class="n">07</span>Results</h2>
<figure>{svg("pdr")}
<figcaption><b>Fig. 4.</b> Packet delivery ratio against d. Mean of 5 seeds, error bars are one standard deviation. Shaded band is the hidden-terminal region.</figcaption></figure>

<h3>Table 4. Primary link at selected distances (mean of 5 seeds)</h3>
<table>
<tr><th>d (m)</th><th>Regime</th><th class="num">PDR %</th><th class="num">Goodput Mbit/s</th><th class="num">Delay ms</th><th class="num">MAC retries</th><th class="num">Retry-limit drops</th><th class="num">Interferer Mbit/s</th></tr>
<tr><td>none</td><td>baseline</td><td class="num">100.0</td><td class="num">4.21</td><td class="num">1.0</td><td class="num">0</td><td class="num">0</td><td class="num">0.00</td></tr>
<tr><td>0 to 20</td><td>shared</td><td class="num">70.3 ± 0.4</td><td class="num">2.96</td><td class="num">460</td><td class="num">198</td><td class="num">0</td><td class="num">3.34</td></tr>
<tr><td>45</td><td>shared</td><td class="num">74.1 ± 0.6</td><td class="num">3.12</td><td class="num">455</td><td class="num">100</td><td class="num">0</td><td class="num">3.28</td></tr>
<tr><td>50</td><td>shared</td><td class="num">76.7 ± 0.4</td><td class="num">3.23</td><td class="num">452</td><td class="num">29</td><td class="num">0</td><td class="num">3.27</td></tr>
<tr class="hl"><td>55</td><td>hidden</td><td class="num">63.0 ± 2.1</td><td class="num">2.65</td><td class="num">469</td><td class="num">1329</td><td class="num">4.2</td><td class="num">5.67</td></tr>
<tr class="hl"><td>70</td><td>hidden</td><td class="num">65.2 ± 2.8</td><td class="num">2.74</td><td class="num">467</td><td class="num">1297</td><td class="num">3.8</td><td class="num">5.67</td></tr>
<tr><td>85</td><td>far</td><td class="num">100.0</td><td class="num">4.21</td><td class="num">1.0</td><td class="num">0</td><td class="num">0</td><td class="num">5.70</td></tr>
<tr><td>120</td><td>far</td><td class="num">100.0</td><td class="num">4.21</td><td class="num">1.0</td><td class="num">0</td><td class="num">0</td><td class="num">5.70</td></tr>
</table>

<figure>{svg("thr")}
<figcaption><b>Fig. 5.</b> Goodput of both flows. In the shared region they split the channel roughly evenly. In the hidden region the interferer takes the whole channel because it no longer defers to A.</figcaption></figure>

<figure>{svg("retry_delay")}
<figcaption><b>Fig. 6.</b> Left: MAC-layer failed attempts at TX-A, which jump about 6x when C becomes hidden. Right: mean delay of delivered packets on a log scale, about 1 ms without contention and about 460 ms with it.</figcaption></figure>

<h3>Interferer load at fixed distance</h3>
<p>To check that the shape of Fig. 4 depends on how busy the interferer is, the interferer's rate was swept at three distances (3 seeds each), with the primary held at 4.19 Mbit/s.</p>
<figure>{svg("load")}
<figcaption><b>Fig. 7.</b> Primary PDR against interferer offered load. At 120 m the interferer is harmless at any rate. At 20 m losses begin once the two loads together exceed what the channel can carry. At 70 m the link survives up to about 4 Mbit/s and then collapses.</figcaption></figure>

<h2><span class="n">08</span>Analysis</h2>
<p>The curve in Fig. 4 is not monotonic, and that is the main finding. Moving the interferer away does not steadily help. There are three regimes with sharp edges, and the edges line up with the 82 m sensing range from the link budget.</p>
<pre class="ascii">{html.escape(ascii_zones)}</pre>

<h3>Regime 1: shared channel (d ≤ 52 m)</h3>
<p>A and C hear each other, so CSMA/CA does its job: they take turns. Collisions are rare (about 200 retries over 9 s), and no frame ever hits the retry limit. The primary still loses about 30% of its packets, but not because of corrupted frames. It simply gets about half the airtime (2.96 of the roughly 6.3 Mbit/s the two flows carry together) while asking for 4.19 Mbit/s. The excess sits in A's MAC queue until it is dropped, which is why delivered packets average around 460 ms of delay. ns-3's <code>WifiMacQueue</code> drops any packet older than <code>MaxDelay</code> = 500 ms (and holds at most 500 packets), so the delay plateau just under that value is the queue limit, not the radio.</p>
<p>Within this regime PDR <i>rises</i> slightly from 70% to 77% between 40 m and 52 m, and retries fall from about 200 to 29. When A and C pick the same backoff slot they collide at B. At d = 20 m the interferer arrives at B 5 dB stronger than A, so the collision always destroys A's frame. At d = 50 m A is 6.6 dB stronger than C at B, and B can decode A's frame through the collision. This is the capture effect, and it is visible in the retry counter before it shows in PDR.</p>

<h3>Regime 2: hidden terminal (53 m ≤ d ≤ 82 m)</h3>
<p>This is the worst place for the interferer, even though it is farther away than in regime 1. A and C can no longer hear each other, so both transmit whenever they like. C is saturated, so it is on air almost all the time. B is still inside C's range, so whenever C's frame reaches B first, B locks onto it (Fig. 3 shows B decoding C's traffic) and A's frame is lost. A sees no ACK, doubles its backoff and tries again. With seed 1, retries go from 8 at d = 52 m to 1322 at d = 53 m. One metre, crossing the sensing edge, changes the MAC's life by two orders of magnitude.</p>
<p>The signal-to-interference ratio at B is actually healthy here (11 dB at d = 70 m, Table 2). The loss is not caused by C being loud. It is caused by B being <i>busy</i> with C's frame when A's arrives. That is why the curve is flat across the whole region instead of improving gradually as C moves away.</p>
<p>Two further points are easy to miss. First, the primary still loses most of its packets in its own queue, not on the air: only about 4 frames per run hit the retry limit, while about 1600 packets are dropped from the queue because retransmissions and doubled backoffs stretch the service time. Second, the network as a whole carries more in this region (2.74 + 5.67 = 8.4 Mbit/s) than in regime 1 (6.3 Mbit/s), because C now gets spatial reuse. The gain all goes to the interferer and the cost all lands on the primary. The standard deviation across seeds is also 4 to 7 times larger here, since outcomes depend on how often C's frames happen to start before A's.</p>

<h3>Regime 3: out of range (d ≥ 83 m)</h3>
<p>C's signal at B drops below the sensitivity threshold. B never syncs to it, and its energy is too small to hurt A's 25 dB margin. The primary is back at 100% delivery, 4.21 Mbit/s and about 1 ms delay, identical to the baseline, while the interferer runs at full rate. Both links coexist on one channel without any coordination.</p>

<h3>What the load sweep adds</h3>
<p>Fig. 7 shows the hidden terminal is a threshold problem, not a gradual one. At d = 70 m with the interferer at or below 4 Mbit/s, the primary delivers everything; MAC retries recover the occasional collision (891 retries at 2.7 Mbit/s, all recovered, 6 ms delay). The link only breaks once C's airtime fraction is high enough that retries keep running into it. In the shared region the decline is smooth and starts earlier, because there the cost is airtime, and every extra bit the interferer sends is taken out of the primary's share.</p>

<h2><span class="n">09</span>Conclusion</h2>
<ul>
<li>Without interference the 802.11b link at 30 m delivers 100% of 4.19 Mbit/s with about 1 ms delay.</li>
<li>A saturated interferer within carrier-sense range cuts primary PDR to about 70%. The loss comes from sharing airtime, and frames on air rarely fail.</li>
<li>The worst case is a hidden interferer (53 to 82 m here), giving 63 to 65% PDR, 6x more retransmissions and the highest variance. Moving the interferer away made things worse before it made them better.</li>
<li>Past the receiver's sensing range (83 m and beyond) the interference vanishes completely and both links run at full rate.</li>
<li>The PCAP captures confirm the mechanism directly: missing ACKs and back-to-back retransmissions from A, and C's frames decoded at B. Frame counts from the captures match the MAC trace sources exactly.</li>
</ul>
<p><b>Limitations.</b> Static nodes on a line, a deterministic log-distance channel with no fading, a single fixed rate with no rate adaptation, and no RTS/CTS. Enabling RTS/CTS (<code>RtsCtsThreshold</code> set to 0) is the obvious next experiment. It should mostly fix regime 2, because C would hear B's CTS and defer, at the cost of extra overhead in the other regimes.</p>
</body></html>"""

(R / "report.html").write_text(HTML)
print("written", len(HTML) // 1024, "KB")
