'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);

  const SCREENS = ['intro', 'question', 'reveal', 'results'];
  const state = { token: null, view: null, deadline: 0, timer: null, submitting: false, layers: [] };

  // A random id kept in localStorage identifies the player. There are no accounts.
  function playerId() {
    try {
      let id = localStorage.getItem('devdive.pid');
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem('devdive.pid', id);
      }
      return id;
    } catch {
      return crypto.randomUUID();
    }
  }

  function savedName() {
    try { return localStorage.getItem('devdive.name') || ''; } catch { return ''; }
  }

  function saveName(name) {
    try { localStorage.setItem('devdive.name', name); } catch { /* storage unavailable */ }
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || res.statusText);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function show(name) {
    for (const s of SCREENS) $(`#screen-${s}`).hidden = s !== name;
  }

  function setError(selector, message) {
    const el = $(selector);
    el.textContent = message || '';
    el.hidden = !message;
  }

  // ---- question screen ---------------------------------------------------

  function renderLayers(depth) {
    const list = $('#layers');
    list.replaceChildren();
    let current = 0;
    state.layers.forEach((layer, i) => { if (depth >= layer.from) current = i; });
    state.layers.forEach((layer, i) => {
      const li = document.createElement('li');
      li.textContent = layer.name;
      if (i <= current) li.classList.add('reached');
      if (i === current) li.classList.add('current');
      list.appendChild(li);
    });
  }

  function renderQuestion(view) {
    state.view = view;
    state.token = view.roundToken;
    $('#q-count').textContent = `Question ${view.index + 1} of ${view.total}`;
    $('#q-layer').textContent = view.layer.name;
    $('#q-score').textContent = `${view.score} pts · ${view.depth} m`;
    $('#q-text').textContent = view.prompt.text;
    $('#answer').value = '';
    renderLayers(view.depth);
    setError('#q-error', '');
    show('question');
    $('#answer').focus();
    startTimer(view.msLeft, view.totalMs);
  }

  function startTimer(msLeft, totalMs) {
    clearInterval(state.timer);
    state.deadline = Date.now() + msLeft;
    const bar = $('#timer-bar');
    const tick = () => {
      const left = Math.max(0, state.deadline - Date.now());
      bar.style.transform = `scaleX(${left / totalMs})`;
      bar.classList.toggle('low', left < 5000);
      $('#q-seconds').textContent = `${Math.ceil(left / 1000)} seconds left`;
      if (left <= 0) {
        clearInterval(state.timer);
        submit(true);
      }
    };
    tick();
    state.timer = setInterval(tick, 100);
  }

  async function submit(timedOut = false) {
    if (state.submitting || !state.view) return;
    state.submitting = true;
    clearInterval(state.timer);
    const input = timedOut ? '' : $('#answer').value;
    try {
      const data = await api('/api/answer', { roundToken: state.token, index: state.view.index, input });
      renderReveal(data);
    } catch (err) {
      if (err.status === 409 && err.data && err.data.state) {
        renderQuestion(err.data.state);
      } else if (err.status === 404) {
        setError('#q-error', 'This round has expired. Reload to start again.');
      } else {
        setError('#q-error', 'Could not reach the server. Try again.');
        startTimer(Math.max(0, state.deadline - Date.now()), state.view.totalMs);
      }
    } finally {
      state.submitting = false;
    }
  }

  // ---- reveal screen -----------------------------------------------------

  function renderReveal(data) {
    const r = data.result;
    const badge = $('#reveal-badge');
    badge.className = `badge ${r.matched ? 'hit' : 'miss'}`;
    badge.textContent = r.matched ? `${r.emoji} ${r.tierName}` : r.timedOut ? '⏱ Out of time' : '✗ No match';
    $('#reveal-points').textContent = r.matched ? `+${r.points} pts · +${r.depthGained} m deeper` : '+0';
    $('#reveal-answer').textContent = r.matched ? `Your answer: ${r.canonical}` : 'That was not on the list for this prompt.';
    $('#reveal-fact').textContent = r.fact ? `Fun fact: ${r.fact}` : '';
    $('#reveal-rarest').textContent = r.rarest.length ? `Deep cuts you could have said: ${r.rarest.join(', ')}` : '';

    const last = !data.next;
    $('#next').textContent = last ? 'See results' : 'Next';
    $('#next').onclick = () => (last ? renderResults(data.summary) : renderQuestion(data.next));
    show('reveal');
    $('#next').focus();
  }

  // ---- results screen ----------------------------------------------------

  function renderResults(summary) {
    $('#res-depth').textContent = `${summary.depth} m · ${summary.layer.name}`;
    $('#res-score').textContent = `${summary.score} points`;
    $('#res-row').textContent = summary.emojiRow;
    $('#res-rank').textContent = `Rank ${summary.rank} of ${summary.totalPlayers} today`;
    $('#copy-status').textContent = '';

    const board = $('#board');
    board.replaceChildren();
    for (const entry of summary.leaderboard) {
      const li = document.createElement('li');
      li.textContent = `${entry.name} — ${entry.score} pts, ${entry.depth} m`;
      board.appendChild(li);
    }

    $('#copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(summary.share);
        $('#copy-status').textContent = 'Copied!';
      } catch {
        window.prompt('Copy your result:', summary.share);
      }
    };
    show('results');
  }

  // ---- startup -----------------------------------------------------------

  async function begin() {
    const name = $('#name').value.trim();
    saveName(name);
    setError('#intro-error', '');
    $('#start').disabled = true;
    try {
      const data = await api('/api/start', { playerId: playerId(), name });
      if (data.finished) renderResults(data.summary);
      else renderQuestion(data);
    } catch (err) {
      setError('#intro-error', err.message === 'no prompts available today' ? 'No prompts are available today.' : 'Could not start. Try again.');
    } finally {
      $('#start').disabled = false;
    }
  }

  async function init() {
    $('#name').value = savedName();
    $('#start').addEventListener('click', begin);
    $('#answer-form').addEventListener('submit', (e) => {
      e.preventDefault();
      submit(false);
    });
    try {
      const meta = await api('/api/meta');
      state.layers = meta.layers;
      $('#puzzle-no').textContent = `#${meta.puzzleNumber} · ${meta.date}`;
    } catch {
      setError('#intro-error', 'Could not reach the server.');
    }
    show('intro');
  }

  init();
})();
