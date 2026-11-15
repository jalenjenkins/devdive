"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const UI = window.DownstackUI;
  const SCREENS = ["intro", "question", "reveal", "results"];
  const state = {
    token: null,
    view: null,
    deadline: 0,
    timer: null,
    busy: false,
    layers: [],
    ranks: [],
    lastResult: null,
    next: null,
    summary: null,
  };
  const meters = (value) => new Intl.NumberFormat("en-US").format(value) + " m";

  function savedName() {
    try {
      return localStorage.getItem("devdive.name") || "";
    } catch {
      return "";
    }
  }

  async function api(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(path, {
        method: body ? "POST" : "GET",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.error || response.statusText);
        error.status = response.status;
        error.data = data;
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  function show(name) {
    clearInterval(state.timer);
    for (const screen of SCREENS)
      $("#screen-" + screen).hidden = screen !== name;
    document.body.dataset.screen = name;
    // Opening the decorative map must never force timed play below the fold.
    if (window.matchMedia("(max-width: 760px)").matches)
      $("#depth-details").open = false;
  }

  function setError(selector, message = "") {
    const element = $(selector);
    element.textContent = message;
    element.hidden = !message;
  }

  function rarityMarks(element, tier) {
    element.replaceChildren();
    element.setAttribute(
      "aria-label",
      tier
        ? "Rarity " + tier + " of 6: " + UI.rankDescription(tier)
        : "No scored answer",
    );
    for (let i = 1; i <= 6; i++) {
      const mark = document.createElement("i");
      mark.classList.toggle("filled", i <= tier);
      mark.setAttribute("aria-hidden", "true");
      element.append(mark);
    }
  }

  function renderDepth(depth) {
    $("#depth-value").textContent = meters(depth);
    const current = UI.currentLayer(depth, state.layers);
    $("#depth-layer").textContent = state.layers[current]?.name || "Browser";
    $("#elevator").style.top = UI.depthPercent(depth, state.layers) + "%";
    const list = $("#layers");
    list.replaceChildren();
    state.layers.forEach((layer, i) => {
      const item = document.createElement("li");
      item.style.top = UI.depthPercent(layer.from, state.layers) + "%";
      item.classList.toggle("reached", i <= current);
      item.classList.toggle("current", i === current);
      if (i === current) item.setAttribute("aria-current", "step");
      const name = document.createElement("span");
      name.className = "layer-title";
      name.textContent = layer.name;
      const threshold = document.createElement("span");
      threshold.className = "layer-meters";
      threshold.textContent = meters(layer.from);
      item.append(name, threshold);
      list.append(item);
    });
  }

  function renderProgress(index, total) {
    $("#q-count").textContent = "Question " + (index + 1) + " / " + total;
    const list = $("#q-progress");
    list.replaceChildren();
    for (let i = 0; i < total; i++) {
      const item = document.createElement("li");
      item.classList.toggle("complete", i < index);
      item.classList.toggle("active", i === index);
      item.setAttribute(
        "aria-label",
        "Question " +
          (i + 1) +
          (i < index
            ? ", completed"
            : i === index
              ? ", current"
              : ", upcoming"),
      );
      if (i === index) item.setAttribute("aria-current", "step");
      list.append(item);
    }
  }

  function setAnswerBusy(busy) {
    state.busy = busy;
    $("#answer-form").setAttribute("aria-busy", String(busy));
    $("#answer").disabled = busy;
    $("#submit").disabled = busy;
    $("#submit").textContent = busy ? "Checking…" : "Submit";
  }

  function renderQuestion(view) {
    state.view = view;
    state.token = view.roundToken;
    setAnswerBusy(false);
    renderProgress(view.index, view.total);
    $("#q-text").textContent = view.prompt.text;
    $("#answer").value = "";
    $("#q-score").textContent = view.score + " pts";
    const last = state.lastResult;
    const previousTier = view.tiers.at(-1);
    $("#last-rank").textContent = last
      ? last.matched
        ? last.tierName
        : last.timedOut
          ? "Missed the launch"
          : "Launch failed"
      : previousTier !== undefined
        ? state.ranks.find((r) => r.tier === previousTier)?.name ||
          "Launch failed"
        : "Your first descent";
    $("#last-gain").textContent = last
      ? "+" + last.points + " pts · +" + meters(last.depthGained)
      : "Rarer answers go deeper.";
    rarityMarks($("#last-rarity"), last?.tier || previousTier || 0);
    renderDepth(view.depth);
    setError("#q-error");
    show("question");
    $("#answer").focus({ preventScroll: true });
    if (window.matchMedia("(max-width: 760px)").matches)
      $("#main").scrollIntoView({ block: "start" });
    startTimer(view.msLeft, view.totalMs);
  }

  function startTimer(msLeft, totalMs, autoSubmit = true) {
    clearInterval(state.timer);
    state.deadline = Date.now() + Math.max(0, msLeft);
    let announced = false;
    $("#timer-announcement").textContent = "";
    const tick = () => {
      const left = Math.max(0, state.deadline - Date.now());
      const seconds = UI.secondsLeft(left);
      $("#q-seconds").replaceChildren(String(seconds));
      const suffix = document.createElement("span");
      suffix.textContent = "s";
      $("#q-seconds").append(suffix);
      $("#q-seconds").setAttribute(
        "aria-label",
        seconds + " seconds remaining",
      );
      $("#timer-bar").style.transform =
        "scaleX(" + Math.max(0, Math.min(1, left / totalMs)) + ")";
      $("#timer").classList.toggle("low", left <= 5000);
      $("#time-warning").hidden = left > 5000;
      if (left <= 5000 && !announced) {
        $("#timer-announcement").textContent =
          "Five seconds or less remaining.";
        announced = true;
      }
      if (left <= 0) {
        clearInterval(state.timer);
        if (autoSubmit && !state.busy) void submit(true);
      }
    };
    // Arm the interval first so an already expired view can clear it in tick().
    state.timer = setInterval(tick, 100);
    tick();
  }

  async function submit(timedOut = false) {
    if (state.busy || !state.view) return;
    const deadline = state.deadline;
    const input = timedOut ? "" : $("#answer").value;
    setAnswerBusy(true);
    clearInterval(state.timer);
    setError("#q-error");
    try {
      const data = await api("/api/answer", {
        roundToken: state.token,
        index: state.view.index,
        input,
      });
      renderReveal(data);
    } catch (error) {
      setAnswerBusy(false);
      if (error.status === 409 && error.data?.state) {
        renderQuestion(error.data.state);
      } else if (error.status === 404 || error.data?.needsNext) {
        setError(
          "#q-error",
          "This question is no longer active. Reload to resume your daily dive.",
        );
      } else {
        setError(
          "#q-error",
          "Could not confirm your answer. Your text is saved here. Press Submit to retry, or reload to resume.",
        );
        startTimer(
          Math.max(0, deadline - Date.now()),
          state.view.totalMs,
          false,
        );
        $("#answer").focus({ preventScroll: true });
      }
    }
  }

  function renderReveal(data) {
    const result = data.result;
    state.lastResult = result;
    state.next = data.next;
    state.summary = data.summary;
    setAnswerBusy(false);
    $("#reveal-count").textContent =
      "Question " + (state.view.index + 1) + " / " + state.view.total;
    $("#reveal-status").textContent = result.matched
      ? "Correct answer"
      : result.timedOut
        ? "Out of time"
        : "No match";
    $("#reveal-prompt").textContent = state.view.prompt.text;
    $("#reveal-answer").textContent =
      result.canonical ||
      (result.timedOut
        ? "Your timer ran out."
        : "That answer wasn’t on the list.");
    $("#reveal-icon").src = result.matched
      ? "/assets/rocket.svg"
      : "/assets/stop.svg";
    $("#reveal-rank").textContent = result.matched
      ? result.tierName
      : result.timedOut
        ? "Missed the launch"
        : "Launch failed";
    $("#reveal-description").textContent = result.matched
      ? UI.rankDescription(result.tier)
      : "No points this time. Keep going.";
    rarityMarks($("#reveal-rarity"), result.tier);
    $("#reveal-points").textContent =
      "+" + result.points + " pts · +" + meters(result.depthGained);
    $("#reveal-flavor").textContent = result.matched
      ? UI.rankFlavor(result.tier)
      : UI.rankFlavor(0);
    $("#reveal-total").textContent = "Total " + data.score + " pts";
    $("#reveal-fact").textContent = result.fact
      ? "Deep cut: " + result.fact
      : "";
    const source = $("#reveal-source");
    source.hidden = !result.source;
    if (result.source) {
      source.textContent = "Source: " + result.source.name;
      source.href = result.source.url;
    }
    state.reportIndex = state.view.index;
    $("#report-answer").hidden = result.matched || result.timedOut;
    $("#report-answer").disabled = false;
    $("#report-status").textContent = "";
    $("#reveal-rarest").textContent = result.rarest?.length
      ? "Other deep cuts: " + result.rarest.join(", ")
      : "";
    $("#next").textContent = data.next ? "Next question" : "See results";
    $("#next-note").textContent = data.next
      ? "Take a breath. The next timer starts when you do."
      : "Your daily descent is complete.";
    $("#next").disabled = false;
    setError("#next-error");
    show("reveal");
    renderDepth(data.depth);
    $("#next").focus({ preventScroll: true });
    $("#main").scrollIntoView({ block: "start" });
    // Announce the result once without re-announcing a whole subtree on each update.
    $("#timer-announcement").textContent = "";
    $("#game-announcement").textContent =
      (result.matched
        ? result.tierName + ". "
        : result.timedOut
          ? "Out of time. "
          : "No match. ") +
      result.points +
      " points. " +
      meters(result.depthGained) +
      " deeper. Current depth " +
      meters(data.depth) +
      ".";
  }

  async function nextQuestion() {
    if ($("#next").disabled) return;
    if (!state.next) return renderResults(state.summary);
    $("#next").disabled = true;
    $("#next").textContent = "Starting…";
    setError("#next-error");
    try {
      const view = await api("/api/next", {
        roundToken: state.token,
        index: state.next.index,
      });
      renderQuestion(view);
    } catch {
      $("#next").disabled = false;
      $("#next").textContent = "Next question";
      setError(
        "#next-error",
        "Could not load the next prompt. Try again; its clock cannot be reset.",
      );
    }
  }

  function renderResults(summary) {
    state.summary = summary;
    renderDepth(summary.depth);
    $("#res-depth").textContent =
      meters(summary.depth) + " · " + summary.layer.name;
    $("#res-score").textContent = summary.score + " points";
    const row = $("#res-row");
    row.replaceChildren();
    summary.tiers.forEach((tier, i) => {
      const item = document.createElement("li");
      item.textContent = tier || "×";
      item.classList.toggle("hit", tier > 0);
      item.setAttribute(
        "aria-label",
        "Question " +
          (i + 1) +
          ": " +
          (state.ranks.find((r) => r.tier === tier)?.name || "No match"),
      );
      item.title = item.getAttribute("aria-label");
      row.append(item);
    });
    $("#res-rank").textContent =
      "Rank " + summary.rank + " of " + summary.totalPlayers + " today";
    $("#copy-status").textContent = "";
    $("#share-text").hidden = true;
    $("#share-label").hidden = true;
    const board = $("#board");
    board.replaceChildren();
    for (const entry of summary.leaderboard) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.className = "board-name";
      name.textContent = entry.name;
      const score = document.createElement("span");
      score.className = "board-score";
      score.textContent = entry.score + " pts · " + meters(entry.depth);
      item.append(name, score);
      board.append(item);
    }
    show("results");
    $("#copy").focus({ preventScroll: true });
    $("#main").scrollIntoView({ block: "start" });
  }

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(state.summary.share);
      $("#copy-status").textContent = "Copied!";
    } catch {
      $("#copy-status").textContent = "Select and copy the text below.";
      $("#share-label").hidden = false;
      const field = $("#share-text");
      field.hidden = false;
      field.value = state.summary.share;
      field.focus();
      field.select();
    }
  }

  async function begin() {
    $("#start").disabled = true;
    $("#start").textContent = "Starting…";
    const name = $("#name").value.trim();
    try {
      localStorage.setItem("devdive.name", name);
    } catch {
      /* Storage is optional. */
    }
    setError("#intro-error");
    try {
      const data = await api("/api/start", { name });
      if (data.finished) renderResults(data.summary);
      else if (data.reveal) {
        state.token = data.roundToken;
        state.view = data.reveal.question;
        renderReveal(data.reveal);
      } else renderQuestion(data);
    } catch (error) {
      setError(
        "#intro-error",
        error.message === "no prompts available today"
          ? "No prompts are available today. Please come back later."
          : "Could not start your dive. Try again.",
      );
    } finally {
      $("#start").disabled = false;
      $("#start").textContent = "Start today’s dive";
    }
  }

  async function loadMeta() {
    $("#retry-meta").hidden = true;
    $("#start").disabled = true;
    setError("#intro-error");
    try {
      const meta = await api("/api/meta");
      state.layers = meta.layers;
      state.ranks = meta.tiers;
      $("#puzzle-no").textContent =
        "Daily #" + String(meta.puzzleNumber).padStart(3, "0");
      $("#puzzle-date").textContent = meta.date;
      $("#puzzle-date").dateTime = meta.date;
      $("#question-duration").textContent = meta.questionSeconds;
      $("#content-count").textContent =
        meta.content.prompts +
        " source-backed prompts across " +
        meta.content.categories +
        " categories. No live AI judging.";
      const list = $("#rank-list");
      list.replaceChildren();
      for (const rank of meta.tiers) {
        const item = document.createElement("li");
        const name = document.createElement("strong");
        name.textContent = rank.tier + ". " + rank.name;
        item.append(
          name,
          document.createTextNode(
            UI.rankDescription(rank.tier) +
              " · " +
              rank.points +
              " pts · " +
              meters(rank.depth),
          ),
        );
        list.append(item);
      }
      renderDepth(0);
      rarityMarks($("#last-rarity"), 0);
      $("#start").disabled = false;
      $("#start").textContent = "Start today’s dive";
    } catch {
      $("#puzzle-no").textContent = "Offline";
      $("#start").textContent = "Waiting for connection";
      $("#retry-meta").hidden = false;
      setError(
        "#intro-error",
        "Could not connect. Check your connection, then reconnect below.",
      );
    }
  }

  $("#name").value = savedName();
  $("#start").addEventListener("click", begin);
  $("#retry-meta").addEventListener("click", loadMeta);
  $("#next").addEventListener("click", nextQuestion);
  $("#copy").addEventListener("click", copyResult);
  $("#report-answer").addEventListener("click", async () => {
    $("#report-answer").disabled = true;
    try {
      await api("/api/report", {
        roundToken: state.token,
        index: state.reportIndex,
      });
      $("#report-status").textContent =
        "Reported for review. Today’s scoring stays unchanged.";
    } catch {
      $("#report-answer").disabled = false;
      $("#report-status").textContent =
        "Could not send the report. Please try again.";
    }
  });
  $("#answer-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });
  const narrow = window.matchMedia("(max-width: 760px)");
  $("#depth-details").open = !narrow.matches;
  narrow.addEventListener("change", (event) => {
    $("#depth-details").open = !event.matches;
  });
  show("intro");
  void loadMeta();
})();
