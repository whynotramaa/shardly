# Approved website direction

The user requested a factual engineering guide written in the blog WRITING-DNA voice, preserving Shardly's identity with readable copy, plain backgrounds and cinematic animated drawings. After seeing mockups, the user chose actual local Coconat, smaller diagrams, and a sidebar preview rail. Their reference shows a thin vertical cluster of tick marks; hovering a mark opens a rounded text preview. They explicitly rejected the thumbnail-card interpretation and asked for header text to be 2px smaller. They then said "okay build this".

Approved compositional reference: `output/website-mockups/reader.html`. User rail reference: `/home/banana/.t3/userdata/attachments/3069df2b-66d2-418a-bb6f-4a23d706aa19-4e4c6e18-941a-45bd-afd9-e23b6bba3a65.png`.

- Type: Coconat Regular display, locally served with its SIL license. Syne reading/UI, Geist Mono for code/data. Headline max 60px; navigation text 10px, brand 24px. Mobile headline 28px and brand 20px match the approved reduced sizes.
- Ground/material: warm paper #f1ece1 and charcoal #0a0a0b. Blue #2f5f8c and peach #f0a878. Flat reading surface, hairlines, crisp geometric SVG.
- Layout: narrow fixed tick rail, hover/focus text preview, Escape dismissal, real chapter anchors with active tracking. Readable long-form article; compact native diagrams max680px; no large hero illustration or metric band.
- Motion: explicit play/pause and manual stepping. A transfer traces the meaningful path at each stage. One pass stops; offscreen playback pauses; reduced motion preserves static steps. No animation library.
- Truth: `website/ENGINEERING_FACTS.md`, implementation links, checked-in benchmark JSON. Preserve all limitations and measured domain reversal. Original fields and revision checks are distinct from original Office/PDF bytes.

Root DESIGN.md describes web/ and is not the visual authority for website/.

The user then explicitly requested centered text containers because the reading column was too far left. The final hero copy and guide article share a centered 690px maximum width. Text remains left-aligned within that centered column; the tick rail stays independent. Mobile retains space for the rail.
