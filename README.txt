HISTORY-ENABLED SCROLLBAR — HOW TO RUN THE SYSTEM


REQUIRED FILES (keep these together in one folder)

  index.html      — main page (viewer + study UI)
  styles.css      — layout and styling
  script.js       — scrollbar logic and study code
  document.png    — long document shown in the scroll area

  If any of these are missing or renamed, the page may not load or look wrong.


  STEPS TO RUN (do these in order)

  1. Open a terminal (Terminal.app on Mac, or your system shell).

  2. Change directory to this project folder, for example:
        cd path/to/History-enabled-scrollbar

  3. Start a small local web server and run this:
        python3 -m http.server 5173


  4. Open your web browser.

  5. Go to this address (if you used Option A with port 5173):
        http://localhost:5173/index.html

     If the server shows a directory listing instead, click "index.html".

  6. You should see the document image on the left and the custom scrollbar
     track on the right (Condition B / free explore). Scroll the document to
     see history markers appear on the track after you pause scrolling.




  FREE EXPLORE (no study) — WHAT TO DO IN ORDER


  1. Scroll the document up and down.
  2. Pause briefly after moving — new positions are recorded after a short
     delay (debounce), not on every pixel.
  3. Watch the right-hand track: ticks (markers) show recent positions; newer
     ones look larger/brighter/purpler.
  4. Click a marker to jump back to that scroll position.
  5. Use the "History size (N)" slider to change how many locations are kept.
  6. Use "Clear history" to reset markers (current position is recorded again).


  USER STUDY MODE — WHAT TO DO IN ORDER


  1. Optionally type a Participant ID in the study panel.
  2. Click "Start study". The page assigns Condition A or B first at random
     (order AB or BA).
  3. Read the condition banner and the task instructions.
  4. For each task: scroll as instructed, then click "Complete task".
  5. Visit tasks (1–2) save your exact scroll position; return tasks (3–4)
     ask you to go back to those saved spots.
  6. After each block of four tasks, answer the three 1–5 questions and click
     "Submit answers and continue".
  7. After the second block and second survey, click "Download results (JSON)"
     to save the log file.
  8. To quit the study early, use "Abandon study"; you can use
     "Export in-memory log" if you need a partial JSON.


  CONDITION A vs B (for the study)


  Condition A — Standard scrollbar only (no overlay, no history markers).
  Condition B — History-enabled overlay with clickable markers (as in free
                explore).



