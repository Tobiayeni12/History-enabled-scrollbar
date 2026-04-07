const DEFAULT_HISTORY_SIZE = 12;
const DEBOUNCE_MS = 160;
const MIN_PIXEL_DELTA = 48;
const MIN_RATIO_DELTA = 0.012;
const PROGRAMMATIC_SCROLL_GUARD_MS = 320;

/**
 * Visit tasks: guided band + we store participant’s actual ratio as anchor.
 * Return tasks: must match their own anchor from task `returnTo` (tests return navigation).
 * @type {{ id: number; kind: "visit"|"return"; instruction: string; tolerance: number; targetRatio?: number; returnTo?: number }[]}
 */
const EXPERIMENT_TASKS = [
  {
    id: 1,
    kind: "visit",
    instruction:
      "Scroll to the **upper** part of the document (about **15–28%** from the very top). When the right area is in view, press “Complete task”. **Your exact position is saved** for a later return step.",
    targetRatio: 0.22,
    tolerance: 0.1,
  },
  {
    id: 2,
    kind: "visit",
    instruction:
      "Scroll to the **lower** part (about **72–92%** from the top). Press “Complete task” when ready. **This position is saved** too.",
    targetRatio: 0.82,
    tolerance: 0.1,
  },
  {
    id: 3,
    kind: "return",
    returnTo: 1,
    instruction:
      "**Return** to the **same scroll position** you had when you finished **Task 1** (match that spot, not just a rough percentage). Then press “Complete task”.",
    tolerance: 0.07,
  },
  {
    id: 4,
    kind: "return",
    returnTo: 2,
    instruction:
      "**Return** to the **same scroll position** you had when you finished **Task 2**. Press “Complete task” when you are back there.",
    tolerance: 0.08,
  },
];

/** @type {{ ratio: number; at: number }[]} */
let history = [];
let maxHistory = DEFAULT_HISTORY_SIZE;
let lastRecorded = null;
let debounceTimer = null;

/** When true, scroll position changes should not append to history (e.g. marker jump). */
let suppressHistoryUntil = 0;

/** null = free explore; 'A' = standard scrollbar; 'B' = history overlay */
let studyCondition = null;

/** @type {"idle"|"active"|"survey"|"done"} */
let studyPhase = "idle";
/** 'AB' or 'BA' */
let studyOrder = "AB";
let studyBlockIndex = 0;
let studyTaskIndex = 0;
let taskStartedAt = 0;
let taskScrollEvents = 0;
let taskLastScrollTop = 0;
let taskDirectionChanges = 0;
let taskLastSign = 0;

/** @type {object[]} */
let studyLog = [];

/** Visit task id -> scroll ratio when participant completed that task (reset each block). */
let blockAnchors = {};

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function nowMs() {
  return performance.now();
}

function shouldRecord(prev, next) {
  if (!prev) return true;
  const ratioDelta = Math.abs(next.ratio - prev.ratio);
  const pxDelta = Math.abs(next.scrollTop - prev.scrollTop);
  return ratioDelta >= MIN_RATIO_DELTA || pxDelta >= MIN_PIXEL_DELTA;
}

function recordLocation(scrollEl) {
  if (studyCondition === "A") return;

  if (performance.now() < suppressHistoryUntil) return;

  const maxScrollTop = Math.max(1, scrollEl.scrollHeight - scrollEl.clientHeight);
  const ratio = clamp01(scrollEl.scrollTop / maxScrollTop);
  const time = Date.now();

  const next = { ratio, scrollTop: scrollEl.scrollTop };
  if (!shouldRecord(lastRecorded, next)) return;

  history.unshift({ ratio, at: time });
  history = history.slice(0, maxHistory);
  lastRecorded = next;
}

function renderThumb(scrollEl, thumbEl, trackEl) {
  const trackRect = trackEl.getBoundingClientRect();
  const trackHeight = trackRect.height;
  const maxScrollTop = Math.max(1, scrollEl.scrollHeight - scrollEl.clientHeight);

  const visibleRatio = clamp01(scrollEl.clientHeight / scrollEl.scrollHeight);
  const thumbHeight = Math.max(18, Math.round(trackHeight * visibleRatio));

  const travel = Math.max(0, trackHeight - thumbHeight);
  const top = Math.round(travel * clamp01(scrollEl.scrollTop / maxScrollTop));

  thumbEl.style.top = `${top}px`;
  thumbEl.style.height = `${thumbHeight}px`;
}

function mixColor(recency01) {
  const t = recency01;
  const r = Math.round(255 * (1 - t) + 124 * t);
  const g = Math.round(255 * (1 - t) + 92 * t);
  const b = Math.round(255 * (1 - t) + 255 * t);
  return `rgba(${r}, ${g}, ${b}, 0.94)`;
}

function renderMarkers(scrollEl, markersEl, trackEl, tooltipEl) {
  const trackHeight = trackEl.getBoundingClientRect().height;
  markersEl.innerHTML = "";

  const count = history.length;
  for (let i = 0; i < count; i++) {
    const item = history[i];
    const recency01 = count <= 1 ? 1 : 1 - i / (count - 1);

    const size = 3 + Math.round(5 * recency01);
    const opacity = 0.35 + 0.58 * recency01;
    const bg = mixColor(recency01);

    const y = Math.round(item.ratio * trackHeight);
    const clampedY = Math.max(2, Math.min(trackHeight - 2, y));

    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "marker";
    marker.style.width = `${size}px`;
    marker.style.height = `${Math.max(10, size * 3)}px`;
    marker.style.opacity = `${opacity}`;
    marker.style.top = `${clampedY}px`;
    marker.style.background = bg;
    marker.title = "Jump to this location";
    marker.setAttribute("aria-label", `History location ${i + 1} of ${count}. Jump to scroll position.`);

    marker.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      jumpToRatio(scrollEl, item.ratio);
    });

    marker.addEventListener("mouseenter", (e) => {
      const pct = Math.round(item.ratio * 100);
      showMarkerTooltip(tooltipEl, e.clientX, e.clientY, `${pct}% from top · newer markers are warmer/purple`);
    });
    marker.addEventListener("mousemove", (e) => {
      const pct = Math.round(item.ratio * 100);
      positionMarkerTooltip(tooltipEl, e.clientX, e.clientY, `${pct}% from top`);
    });
    marker.addEventListener("mouseleave", () => hideMarkerTooltip(tooltipEl));

    markersEl.appendChild(marker);
  }
}

function showMarkerTooltip(el, x, y, text) {
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  positionMarkerTooltip(el, x, y);
}

function positionMarkerTooltip(el, x, y, text) {
  if (!el || el.hidden) return;
  if (text) el.textContent = text;
  const pad = 12;
  const rect = el.getBoundingClientRect();
  let left = x + pad;
  let top = y + pad;
  if (left + rect.width > window.innerWidth - 8) left = x - rect.width - pad;
  if (top + rect.height > window.innerHeight - 8) top = y - rect.height - pad;
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${Math.max(8, top)}px`;
}

function hideMarkerTooltip(el) {
  if (!el) return;
  el.hidden = true;
}

function jumpToRatio(scrollEl, ratio) {
  const maxScrollTop = Math.max(1, scrollEl.scrollHeight - scrollEl.clientHeight);
  suppressHistoryUntil = performance.now() + PROGRAMMATIC_SCROLL_GUARD_MS;
  scrollEl.scrollTop = Math.round(clamp01(ratio) * maxScrollTop);
  lastRecorded = { ratio: clamp01(scrollEl.scrollTop / maxScrollTop), scrollTop: scrollEl.scrollTop };
}

function scheduleRecordAndRender(scrollEl, thumbEl, trackEl, markersEl, tooltipEl) {
  renderThumb(scrollEl, thumbEl, trackEl);

  if (debounceTimer) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    recordLocation(scrollEl);
    renderMarkers(scrollEl, markersEl, trackEl, tooltipEl);
  }, DEBOUNCE_MS);
}

function setHistorySize(n, scrollEl, markersEl, trackEl, tooltipEl) {
  maxHistory = n;
  history = history.slice(0, maxHistory);
  renderMarkers(scrollEl, markersEl, trackEl, tooltipEl);
}

function applyStudyCondition(condition, viewerEl, scrollEl, historyControlsEl) {
  studyCondition = condition;
  const isStandard = condition === "A";

  viewerEl.classList.toggle("viewer--standard", isStandard);
  scrollEl.classList.toggle("scrollRoot--native", isStandard);

  if (historyControlsEl) historyControlsEl.hidden = isStandard;

  if (isStandard) {
    history = [];
    lastRecorded = null;
  }
}

function pushLog(event) {
  studyLog.push({ t: Date.now(), ...event });
}

function getCurrentConditionLetter() {
  const first = studyOrder === "AB" ? "A" : "B";
  const second = studyOrder === "AB" ? "B" : "A";
  return studyBlockIndex === 0 ? first : second;
}

function conditionDescription(letter) {
  return letter === "A"
    ? "standard scrollbar (native, no history markers)"
    : "history-enabled scrollbar (overlay with markers)";
}

function currentTask() {
  return EXPERIMENT_TASKS[studyTaskIndex] ?? null;
}

function getEffectiveTargetRatio(task) {
  if (task.kind === "return") {
    const v = blockAnchors[task.returnTo];
    return typeof v === "number" ? v : null;
  }
  return task.targetRatio ?? null;
}

function logTaskStart(cond, task) {
  const eff = getEffectiveTargetRatio(task);
  const base = {
    type: "task_start",
    condition: cond,
    taskId: task.id,
    taskKind: task.kind,
    targetRatio: eff,
  };
  if (task.kind === "return") {
    pushLog({ ...base, returnToTaskId: task.returnTo });
  } else {
    pushLog(base);
  }
}

function resetTaskMetrics(scrollEl) {
  taskStartedAt = nowMs();
  taskScrollEvents = 0;
  taskLastScrollTop = scrollEl.scrollTop;
  taskDirectionChanges = 0;
  taskLastSign = 0;
}

/** Call after programmatic scrollTop changes so scroll events do not pollute task metrics. */
function resetTaskMetricsAfterProgrammaticScroll(scrollEl) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => resetTaskMetrics(scrollEl));
  });
}

function onTaskScroll(scrollEl) {
  if (studyPhase !== "active") return;
  taskScrollEvents += 1;
  const d = scrollEl.scrollTop - taskLastScrollTop;
  taskLastScrollTop = scrollEl.scrollTop;
  if (d === 0) return;
  const sign = Math.sign(d);
  if (taskLastSign !== 0 && sign !== taskLastSign) taskDirectionChanges += 1;
  taskLastSign = sign;
}

function refreshTaskUI() {
  const idle = document.getElementById("experimentIdle");
  const active = document.getElementById("experimentActive");
  const survey = document.getElementById("experimentSurvey");
  const surveyIntro = document.getElementById("surveyIntro");
  const done = document.getElementById("experimentDone");
  const badge = document.getElementById("conditionBadge");
  const instr = document.getElementById("taskInstruction");
  const prog = document.getElementById("taskProgress");

  if (studyPhase === "idle") {
    idle.hidden = false;
    active.hidden = true;
    if (survey) survey.hidden = true;
    if (done) done.hidden = true;
    return;
  }
  if (studyPhase === "survey") {
    idle.hidden = true;
    active.hidden = true;
    if (survey) survey.hidden = false;
    if (done) done.hidden = true;
    const letter = getCurrentConditionLetter();
    if (surveyIntro) {
      surveyIntro.textContent = `Block ${studyBlockIndex + 1} of 2 is complete. You just used Condition ${letter} (${conditionDescription(
        letter,
      )}). Answer about that scrollbar only: 1 = strongly disagree, 5 = strongly agree.`;
    }
    return;
  }
  if (studyPhase === "done") {
    idle.hidden = true;
    active.hidden = true;
    if (survey) survey.hidden = true;
    if (done) done.hidden = false;
    return;
  }

  idle.hidden = true;
  active.hidden = false;
  if (survey) survey.hidden = true;
  if (done) done.hidden = true;

  const letter = getCurrentConditionLetter();
  const label =
    letter === "A"
      ? "Condition A — Standard scrollbar only (no history markers)."
      : "Condition B — History-enabled scrollbar: markers show past positions; click to jump back.";
  badge.textContent = label;

  const task = currentTask();
  const blockNum = studyBlockIndex + 1;
  prog.textContent = `Block ${blockNum} of 2 · Task ${studyTaskIndex + 1} of ${EXPERIMENT_TASKS.length} · Order ${studyOrder}`;
  if (task) instr.innerHTML = task.instruction.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
}

function startStudy(viewerEl, scrollEl, historyControlsEl, thumbEl, trackEl, markersEl, tooltipEl) {
  studyOrder = Math.random() < 0.5 ? "AB" : "BA";
  studyBlockIndex = 0;
  studyTaskIndex = 0;
  studyPhase = "active";
  studyLog = [];

  const pid = document.getElementById("participantId");
  blockAnchors = {};

  pushLog({
    type: "study_start",
    participantId: pid && pid.value.trim() ? pid.value.trim() : null,
    order: studyOrder,
    userAgent: navigator.userAgent,
    studyDesign: "return_navigation_ab",
    studyGoal:
      "After two guided visits, participants return to their own saved scroll positions. Condition B shows history markers; A does not. Compare time, accuracy, and perceived necessity on return tasks.",
  });

  const first = getCurrentConditionLetter();
  applyStudyCondition(first, viewerEl, scrollEl, historyControlsEl);
  scrollEl.scrollTop = 0;
  lastRecorded = null;
  if (first === "B") {
    recordLocation(scrollEl);
  }

  renderThumb(scrollEl, thumbEl, trackEl);
  renderMarkers(scrollEl, markersEl, trackEl, tooltipEl);
  resetTaskMetricsAfterProgrammaticScroll(scrollEl);

  pushLog({
    type: "block_start",
    condition: first,
    blockIndex: studyBlockIndex,
  });
  logTaskStart(first, EXPERIMENT_TASKS[studyTaskIndex]);

  refreshTaskUI();
}

function completeTask(scrollEl, viewerEl, historyControlsEl, thumbEl, trackEl, markersEl, tooltipEl) {
  if (studyPhase !== "active") return;

  const cond = getCurrentConditionLetter();
  const task = currentTask();
  if (!task) return;

  const maxScrollTop = Math.max(1, scrollEl.scrollHeight - scrollEl.clientHeight);
  const finalRatio = clamp01(scrollEl.scrollTop / maxScrollTop);

  let effectiveTarget;
  if (task.kind === "return") {
    effectiveTarget = blockAnchors[task.returnTo];
    if (effectiveTarget === undefined) {
      window.alert("Missing saved position for this return task. Please abandon and restart the study.");
      return;
    }
  } else {
    effectiveTarget = task.targetRatio;
  }

  const delta = Math.abs(finalRatio - effectiveTarget);
  const correct = delta <= task.tolerance;
  const durationMs = Math.round(nowMs() - taskStartedAt);

  const completePayload = {
    type: "task_complete",
    condition: cond,
    taskId: task.id,
    taskKind: task.kind,
    targetRatio: effectiveTarget,
    tolerance: task.tolerance,
    finalRatio,
    correct,
    durationMs,
    scrollEvents: taskScrollEvents,
    directionChanges: taskDirectionChanges,
  };
  if (task.kind === "return") {
    completePayload.returnToTaskId = task.returnTo;
  }
  pushLog(completePayload);

  if (task.kind === "visit") {
    blockAnchors[task.id] = finalRatio;
  }

  studyTaskIndex += 1;
  if (studyTaskIndex >= EXPERIMENT_TASKS.length) {
    pushLog({ type: "block_end", condition: cond, blockIndex: studyBlockIndex });
    studyPhase = "survey";
    refreshTaskUI();
    return;
  }

  logTaskStart(cond, EXPERIMENT_TASKS[studyTaskIndex]);
  resetTaskMetrics(scrollEl);
  refreshTaskUI();
}

function buildLikertRadios() {
  document.querySelectorAll(".likert__row").forEach((row) => {
    const key = row.dataset.likert;
    row.innerHTML = "";
    for (let v = 1; v <= 5; v++) {
      const id = `likert_${key}_${v}`;
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `likert_${key}`;
      input.value = String(v);
      input.id = id;
      label.appendChild(input);
      label.appendChild(document.createTextNode(` ${v}`));
      row.appendChild(label);
    }
  });
}

function readLikert() {
  const out = {};
  document.querySelectorAll(".likert__row").forEach((row) => {
    const key = row.dataset.likert;
    const picked = row.querySelector("input[type=radio]:checked");
    out[key] = picked ? Number(picked.value) : null;
  });
  return out;
}

function clearLikertSelection() {
  document.querySelectorAll('.likert__row input[type="radio"]').forEach((i) => {
    i.checked = false;
  });
}

function continueAfterSurvey() {
  const likert = readLikert();
  if (Object.values(likert).some((v) => v == null)) {
    window.alert("Please answer all three questions (1–5).");
    return;
  }

  const cond = getCurrentConditionLetter();
  pushLog({
    type: "likert_submitted",
    condition: cond,
    blockIndex: studyBlockIndex,
    responses: likert,
  });

  clearLikertSelection();

  const viewerEl = document.getElementById("viewer");
  const scrollEl = document.getElementById("scrollRoot");
  const historyControlsEl = document.getElementById("historyControls");
  const thumbEl = document.getElementById("thumb");
  const trackEl = document.getElementById("historyTrack");
  const markersEl = document.getElementById("markers");
  const tooltipEl = document.getElementById("markerTooltip");

  if (!viewerEl || !scrollEl || !thumbEl || !trackEl || !markersEl) return;

  if (studyBlockIndex === 0) {
    studyBlockIndex = 1;
    studyTaskIndex = 0;
    blockAnchors = {};
    const next = getCurrentConditionLetter();
    applyStudyCondition(next, viewerEl, scrollEl, historyControlsEl);
    scrollEl.scrollTop = 0;
    lastRecorded = null;
    if (next === "B") recordLocation(scrollEl);
    renderThumb(scrollEl, thumbEl, trackEl);
    renderMarkers(scrollEl, markersEl, trackEl, tooltipEl);

    pushLog({ type: "block_start", condition: next, blockIndex: studyBlockIndex });
    logTaskStart(next, EXPERIMENT_TASKS[studyTaskIndex]);
    resetTaskMetricsAfterProgrammaticScroll(scrollEl);
    studyPhase = "active";
    refreshTaskUI();
    return;
  }

  pushLog({ type: "study_complete", order: studyOrder });
  studyPhase = "done";
  refreshTaskUI();
}

function abandonStudy(viewerEl, scrollEl, historyControlsEl, thumbEl, trackEl, markersEl, tooltipEl) {
  pushLog({ type: "study_abandoned", atBlock: studyBlockIndex, atTask: studyTaskIndex });
  blockAnchors = {};
  studyPhase = "idle";
  studyCondition = null;
  viewerEl.classList.remove("viewer--standard");
  scrollEl.classList.remove("scrollRoot--native");
  const historyControlsEl2 = document.getElementById("historyControls");
  if (historyControlsEl2) historyControlsEl2.hidden = false;
  recordLocation(scrollEl);
  renderThumb(scrollEl, thumbEl, trackEl);
  renderMarkers(scrollEl, markersEl, trackEl, document.getElementById("markerTooltip"));
  refreshTaskUI();
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadStudyResultsAndReset() {
  if (studyPhase !== "done") {
    window.alert("Finish both blocks and both short surveys first; the download button appears when the study is complete.");
    return;
  }
  if (!studyLog.length) {
    window.alert("No log data to export.");
    return;
  }

  const pid = document.getElementById("participantId");
  const payload = {
    exportedAt: new Date().toISOString(),
    participantId: pid && pid.value.trim() ? pid.value.trim() : null,
    counterbalancedOrder: studyOrder,
    events: studyLog,
  };

  downloadJson(payload, `history_scrollbar_study_${Date.now()}.json`);
  studyLog = [];

  studyPhase = "idle";
  studyCondition = null;
  const viewerEl = document.getElementById("viewer");
  const scrollEl = document.getElementById("scrollRoot");
  const historyControlsEl = document.getElementById("historyControls");
  const thumbEl = document.getElementById("thumb");
  const trackEl = document.getElementById("historyTrack");
  const markersEl = document.getElementById("markers");
  const tooltipEl = document.getElementById("markerTooltip");

  if (viewerEl && scrollEl) {
    viewerEl.classList.remove("viewer--standard");
    scrollEl.classList.remove("scrollRoot--native");
  }
  if (historyControlsEl) historyControlsEl.hidden = false;
  if (scrollEl && thumbEl && trackEl && markersEl) {
    recordLocation(scrollEl);
    renderThumb(scrollEl, thumbEl, trackEl);
    renderMarkers(scrollEl, markersEl, trackEl, tooltipEl);
  }

  refreshTaskUI();
}

function exportFreeLog() {
  if (!studyLog.length) {
    window.alert("No study log in memory. Run a study or complete tasks first.");
    return;
  }
  downloadJson(
    { exportedAt: new Date().toISOString(), events: studyLog },
    `history_scrollbar_log_${Date.now()}.json`,
  );
}

function init() {
  const scrollEl = document.getElementById("scrollRoot");
  const viewerEl = document.getElementById("viewer");
  const trackEl = document.getElementById("historyTrack");
  const thumbEl = document.getElementById("thumb");
  const markersEl = document.getElementById("markers");
  const tooltipEl = document.getElementById("markerTooltip");
  const sliderEl = document.getElementById("historySize");
  const sliderValueEl = document.getElementById("historySizeValue");
  const clearEl = document.getElementById("clearHistory");
  const historyControlsEl = document.getElementById("historyControls");

  if (!scrollEl || !viewerEl || !trackEl || !thumbEl || !markersEl || !sliderEl || !sliderValueEl || !clearEl) {
    return;
  }

  buildLikertRadios();

  maxHistory = Number(sliderEl.value) || DEFAULT_HISTORY_SIZE;
  sliderValueEl.textContent = String(maxHistory);
  recordLocation(scrollEl);
  renderThumb(scrollEl, thumbEl, trackEl);
  renderMarkers(scrollEl, markersEl, trackEl, tooltipEl);

  scrollEl.addEventListener(
    "scroll",
    () => {
      onTaskScroll(scrollEl);
      scheduleRecordAndRender(scrollEl, thumbEl, trackEl, markersEl, tooltipEl);
    },
    { passive: true },
  );

  window.addEventListener("resize", () => {
    renderThumb(scrollEl, thumbEl, trackEl);
    renderMarkers(scrollEl, markersEl, trackEl, tooltipEl);
  });

  sliderEl.addEventListener("input", () => {
    const n = Number(sliderEl.value);
    sliderValueEl.textContent = String(n);
    setHistorySize(n, scrollEl, markersEl, trackEl, tooltipEl);
  });

  clearEl.addEventListener("click", () => {
    history = [];
    lastRecorded = null;
    recordLocation(scrollEl);
    renderMarkers(scrollEl, markersEl, trackEl, tooltipEl);
  });

  document.getElementById("btnStartStudy")?.addEventListener("click", () => {
    startStudy(viewerEl, scrollEl, historyControlsEl, thumbEl, trackEl, markersEl, tooltipEl);
  });

  document.getElementById("btnCompleteTask")?.addEventListener("click", () => {
    completeTask(scrollEl, viewerEl, historyControlsEl, thumbEl, trackEl, markersEl, tooltipEl);
  });

  document.getElementById("btnAbandonStudy")?.addEventListener("click", () => {
    if (window.confirm("Stop the study and return to free explore?")) {
      abandonStudy(viewerEl, scrollEl, historyControlsEl, thumbEl, trackEl, markersEl, tooltipEl);
    }
  });

  document.getElementById("btnDownloadStudy")?.addEventListener("click", downloadStudyResultsAndReset);
  document.getElementById("btnSurveyContinue")?.addEventListener("click", continueAfterSurvey);
  document.getElementById("btnExportFreeLog")?.addEventListener("click", exportFreeLog);

  refreshTaskUI();
}

document.addEventListener("DOMContentLoaded", init);
