// relay web app — connects to /api/* served by `relay web`.

const { fuzzyFilter } = window.fuzzy;

const STATUS_GLYPH = {
  open: "·",
  in_progress: "▶",
  blocked: "⊘",
  snoozed: "⏸",
  done: "✓",
};

const STATE = {
  view: "today",
  filter: "",
  selectedId: null,
  cache: {
    tasks: { today: [], open: [], snoozed: [], done: [] },
    repos: [],
    contexts: [],
    counts: { today: 0, open: 0, snoozed: 0, done: 0, repos: 0, contexts: 0, sources: {} },
  },
  loading: { initial: true, list: false, sync: false },
  lastSyncAt: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// --- API ---------------------------------------------------------------

async function api(method, path, body) {
  const opts = { method };
  if (body) {
    opts.headers = { "content-type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${method} ${path} → ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

async function loadCounts() {
  STATE.cache.counts = await api("GET", "/api/counts");
}

async function loadView(view) {
  STATE.loading.list = true;
  if (view === "today") {
    STATE.cache.tasks.today = await api("GET", "/api/today?limit=200");
  } else if (view === "open") {
    STATE.cache.tasks.open = await api("GET", "/api/tasks?status=open&limit=500");
    const inprog = await api("GET", "/api/tasks?status=in_progress&limit=500");
    STATE.cache.tasks.open = [...inprog, ...STATE.cache.tasks.open];
  } else if (view === "snoozed") {
    STATE.cache.tasks.snoozed = await api("GET", "/api/tasks?status=snoozed&limit=500");
  } else if (view === "done") {
    STATE.cache.tasks.done = await api("GET", "/api/tasks?status=done&limit=200");
  } else if (view === "repos") {
    STATE.cache.repos = await api("GET", "/api/repos");
  } else if (view === "contexts") {
    STATE.cache.contexts = await api("GET", "/api/contexts?limit=100");
  }
  STATE.loading.list = false;
}

function currentList() {
  return STATE.cache.tasks[STATE.view] ?? [];
}

// --- Rendering ---------------------------------------------------------

function timeAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}

function renderHighlighted(text, indices) {
  if (!indices || indices.length === 0) return escapeHtml(text);
  const set = new Set(indices);
  let out = "";
  let buf = "";
  let isHL = null;
  const flush = () => {
    if (!buf) return;
    out += isHL ? `<mark>${escapeHtml(buf)}</mark>` : escapeHtml(buf);
    buf = "";
  };
  for (let i = 0; i < text.length; i++) {
    const hl = set.has(i);
    if (isHL === null) { isHL = hl; buf = text[i]; continue; }
    if (hl === isHL) buf += text[i];
    else { flush(); isHL = hl; buf = text[i]; }
  }
  flush();
  return out;
}

function renderSidebar() {
  const c = STATE.cache.counts;
  $("#count-today").textContent = c.today;
  $("#count-open").textContent = c.open;
  $("#count-snoozed").textContent = c.snoozed;
  $("#count-done").textContent = c.done;
  $("#count-repos").textContent = c.repos;
  $("#count-contexts").textContent = c.contexts;

  const s = c.sources ?? {};
  $("#src-code-todo").textContent = s.code_todo ?? 0;
  $("#src-github-issue").textContent = s.github_issue ?? 0;
  $("#src-github-pr").textContent = s.github_pr ?? 0;
  $("#src-claude-session").textContent = s.claude_session_todo ?? 0;
  $("#src-agents-note").textContent = s.agents_note ?? 0;
  $("#src-manual").textContent = s.manual ?? 0;

  $$(".sidebar__item").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.view === STATE.view);
  });

  $("#mode-badge").textContent = "● live";
  $("#mode-badge").style.color = "var(--accent)";
}

function renderTaskRow(row) {
  const t = row.task;
  const glyph = STATUS_GLYPH[t.status] ?? "·";
  const selected = t.id === STATE.selectedId;
  return `
    <div class="task-row ${selected ? "is-selected" : ""}" data-id="${t.id}">
      <div class="task-row__id">#${t.id}</div>
      <div class="task-row__status is-${t.status}">${glyph}</div>
      <div class="task-row__repo">${escapeHtml(t.repo)}</div>
      <div class="task-row__agent">${escapeHtml(t.assignee)}</div>
      <div class="task-row__title">${renderHighlighted(t.title, row.titleIndices)}</div>
    </div>
  `;
}

function renderDetail(task) {
  if (!task) return `<div class="empty">select a task →</div>`;
  const meta = [
    ["repo", `<span class="is-link">${escapeHtml(task.repo)}</span>`],
    ["source", `<span class="badge is-${task.source_type}">${task.source_type}</span>`],
    ["status", task.status],
    ["assignee", task.assignee],
    ["priority", String(task.priority)],
    ["updated", timeAgo(task.updated_at)],
  ];
  if (task.due_at) meta.push(["due", timeAgo(task.due_at)]);
  if (task.session_id) meta.push(["session", task.session_id]);
  if (task.context_hash) meta.push(["context", task.context_hash.slice(0, 10)]);
  if (task.files?.length) meta.push(["files", task.files.map(escapeHtml).join("<br>")]);

  return `
    <div class="detail__title">
      <span class="detail__title-id">#${task.id}</span>
    </div>
    <div class="detail__title-text">${escapeHtml(task.title)}</div>
    <div class="detail__meta">
      ${meta.map(([l, v]) => `
        <div class="detail__meta-label">${l}</div>
        <div class="detail__meta-value">${v}</div>
      `).join("")}
    </div>
    ${task.body ? `<div class="detail__body">${escapeHtml(task.body)}</div>` : ""}
    <div class="detail__actions">
      <button class="primary" data-action="copy-cli">📋 relay run ${task.id}</button>
      <button data-action="snooze">⏸ Snooze</button>
      <button data-action="close">✓ Close</button>
      <button data-action="reopen" ${task.status === "done" || task.status === "snoozed" ? "" : "style=display:none"}>↺ Reopen</button>
    </div>
  `;
}

function renderRepos() {
  const repos = STATE.cache.repos;
  if (repos.length === 0) return `<div class="empty">no repos yet — try \`relay sync\`</div>`;
  const max = Math.max(1, ...repos.map((r) => r.open + r.in_progress));
  return `
    <div class="repo-grid">
      ${repos.map((r) => {
        const total = r.open + r.in_progress;
        const pct = total / max * 100;
        return `
          <div class="repo-card">
            <div class="repo-card__name">${escapeHtml(r.name)}</div>
            <div class="repo-card__stats">
              <div><span class="repo-card__stat-num">${r.open}</span> open</div>
              <div><span class="repo-card__stat-num">${r.in_progress}</span> active</div>
              <div><span class="repo-card__stat-num">${r.snoozed}</span> snoozed</div>
            </div>
            <div class="repo-card__bar"><div class="repo-card__bar-fill" style="width: ${pct}%"></div></div>
            <div class="repo-card__age">last activity: ${timeAgo(r.lastTouched)}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderContexts() {
  const contexts = STATE.cache.contexts;
  if (contexts.length === 0) return `<div class="empty">no contexts yet — set up the Stop hook with \`relay hook install\`</div>`;
  return `
    <div class="contexts-list">
      ${contexts.map((c) => `
        <div class="context-item">
          <div class="context-item__hash">${c.hash.slice(0, 10)}</div>
          <div>
            <div><span class="context-item__repo">${escapeHtml(c.repo)}</span>
              <span class="task-row__agent" style="font-size: 11px; color: var(--text-dim);"> · ${escapeHtml(c.branch)} · ${c.headSha.slice(0, 7)}</span>
              ${c.dirtyFiles.length ? `<span class="context-item__dirty">+${c.dirtyFiles.length} dirty</span>` : ""}
            </div>
            <div class="context-item__summary">${escapeHtml(c.summary.split("\n")[0] || "")}</div>
          </div>
          <div class="context-item__when">${timeAgo(c.createdAt)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderMain() {
  const main = $("#main-body");

  if (STATE.view === "repos") {
    main.innerHTML = `<div class="view">${renderRepos()}</div>`;
    $("#filter-bar").style.display = "none";
    return;
  }
  if (STATE.view === "contexts") {
    main.innerHTML = `<div class="view">${renderContexts()}</div>`;
    $("#filter-bar").style.display = "none";
    return;
  }

  $("#filter-bar").style.display = "flex";
  const base = currentList();
  const rows = fuzzyFilter(base, STATE.filter);
  $("#filter-count").textContent = STATE.filter
    ? `${rows.length}/${base.length} match`
    : `${base.length} item${base.length === 1 ? "" : "s"}`;
  $("#filter-clear").style.display = STATE.filter ? "inline" : "none";

  if (!STATE.selectedId || !rows.find((r) => r.task.id === STATE.selectedId)) {
    STATE.selectedId = rows[0]?.task.id ?? null;
  }
  const selected = base.find((t) => t.id === STATE.selectedId) ?? null;

  if (rows.length === 0 && !STATE.loading.list) {
    main.innerHTML = `
      <div class="split">
        <div class="list-pane"><div class="empty">${STATE.filter ? "no matches" : "nothing here"}</div></div>
        <div class="detail-pane">${renderDetail(null)}</div>
      </div>
    `;
    return;
  }

  main.innerHTML = `
    <div class="split">
      <div class="list-pane">
        ${rows.map(renderTaskRow).join("")}
      </div>
      <div class="detail-pane">${renderDetail(selected)}</div>
    </div>
  `;

  $$(".task-row").forEach((row) => {
    row.addEventListener("click", () => {
      STATE.selectedId = Number(row.dataset.id);
      renderMain();
    });
  });

  $$('.detail__actions button').forEach((btn) => {
    btn.addEventListener('click', () => handleAction(btn.dataset.action));
  });
}

// --- Actions -----------------------------------------------------------

async function handleAction(action) {
  const t = currentList().find((x) => x.id === STATE.selectedId);
  if (!t) return;

  if (action === "copy-cli") {
    const cmd = `relay run ${t.id}`;
    try {
      await navigator.clipboard.writeText(cmd);
      showToast(`copied: ${cmd}`);
    } catch {
      showToast(`run with: ${cmd}`);
    }
    return;
  }

  try {
    if (action === "snooze") await api("POST", `/api/tasks/${t.id}/snooze`);
    if (action === "close") await api("POST", `/api/tasks/${t.id}/close`);
    if (action === "reopen") await api("POST", `/api/tasks/${t.id}/reopen`);
    showToast(`${action} #${t.id}`);
    await Promise.all([loadCounts(), loadView(STATE.view)]);
    renderSidebar();
    renderMain();
  } catch (e) {
    showToast(`error: ${e.message}`);
  }
}

async function doSync() {
  if (STATE.loading.sync) return;
  STATE.loading.sync = true;
  const btn = $("#sync-btn");
  btn.disabled = true;
  btn.textContent = "↻ syncing…";
  try {
    const report = await api("POST", "/api/sync");
    STATE.lastSyncAt = new Date();
    $("#sync-time").textContent = `synced ${timeAgo(STATE.lastSyncAt.toISOString())}`;
    const total = report.inserted + report.updated;
    showToast(`sync: +${report.inserted} new, ${report.updated} updated`);
    await loadCounts();
    await loadView(STATE.view);
    renderSidebar();
    renderMain();
  } catch (e) {
    showToast(`sync failed: ${e.message}`);
  } finally {
    STATE.loading.sync = false;
    btn.disabled = false;
    btn.textContent = "↻ sync";
  }
}

function showToast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("is-visible");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("is-visible"), 2000);
}

// --- Navigation --------------------------------------------------------

async function applyHash() {
  const hash = location.hash.replace(/^#\//, "") || "today";
  STATE.view = hash;
  STATE.selectedId = null;
  renderSidebar();
  try {
    await loadView(STATE.view);
  } catch (e) {
    showToast(`load failed: ${e.message}`);
  }
  renderMain();
}

function moveSelection(delta) {
  const base = currentList();
  const rows = fuzzyFilter(base, STATE.filter);
  if (!rows.length) return;
  const idx = rows.findIndex((r) => r.task.id === STATE.selectedId);
  const next = Math.max(0, Math.min(rows.length - 1, idx + delta));
  STATE.selectedId = rows[next].task.id;
  renderMain();
  document.querySelector(`.task-row[data-id="${STATE.selectedId}"]`)?.scrollIntoView({ block: "nearest" });
}

// --- Init --------------------------------------------------------------

async function init() {
  $$(".sidebar__item[data-view]").forEach((el) => {
    el.addEventListener("click", () => { location.hash = `#/${el.dataset.view}`; });
  });

  const input = $("#filter-input");
  input.addEventListener("input", (e) => {
    STATE.filter = e.target.value;
    STATE.selectedId = null;
    renderMain();
  });
  $("#filter-clear").addEventListener("click", () => {
    STATE.filter = "";
    input.value = "";
    renderMain();
  });
  $("#sync-btn").addEventListener("click", doSync);

  document.addEventListener("keydown", (e) => {
    if (document.activeElement === input) {
      if (e.key === "Escape") { input.blur(); STATE.filter = ""; input.value = ""; renderMain(); }
      return;
    }
    if (e.key === "/") { e.preventDefault(); input.focus(); return; }
    if (e.key === "j" || e.key === "ArrowDown") moveSelection(1);
    if (e.key === "k" || e.key === "ArrowUp") moveSelection(-1);
    if (e.key === "1") location.hash = "#/today";
    if (e.key === "2") location.hash = "#/open";
    if (e.key === "3") location.hash = "#/snoozed";
    if (e.key === "R" && (e.shiftKey || e.altKey)) doSync();
  });

  window.addEventListener("hashchange", applyHash);

  try {
    await api("GET", "/api/health");
  } catch (e) {
    document.body.innerHTML = `<div style="padding: 40px; font-family: monospace; color: #ff7b72">cannot reach /api/health.<br>Start the server with <code>relay web</code>.</div>`;
    return;
  }

  await loadCounts();
  await applyHash();
}

init();
