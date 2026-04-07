# History-enabled-scrollbar

Scrollable **document.png** viewer with a **history-enabled scrollbar overlay** (Condition B) and **standard scrollbar** mode (Condition A) for comparison.

## Run

```bash
python3 -m http.server 5173
```

Open `http://localhost:5173/index.html`.

## Milestone 1 (prototype)

- Scroll tracking with debounce; rolling history of last **N** locations.
- Markers on a custom overlay track; temporal encoding (size, opacity, color).
- Configurable **N** and **Clear history**.

## Milestone 2 (implemented in UI)

- **Click a marker** to jump to that scroll position (with brief suppression so jumps do not spam history).
- **Hover** on a marker for a small tooltip (% from top).
- **User study mode** (`studyDesign: "return_navigation_ab"` in JSON): random **AB** or **BA**. Each block has **4 tasks**: two **visit** tasks (guided bands; the participant’s **actual** `finalRatio` is stored as an anchor), then two **return** tasks scored against those anchors (`taskKind: "return"`, `returnToTaskId`). Logs `durationMs`, `correct`, `scrollEvents`, `directionChanges` per task.
- After **each** block: three Likert items (`ease`, `necessity`, `wantFeature`) about the scrollbar just used.
- After block 2’s survey: **Download results (JSON)**.
- **Export in-memory log** if someone abandons mid-session.
