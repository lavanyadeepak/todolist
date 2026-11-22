(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const listId = Number(document.body.dataset.listId);
  const collapseKey = `tdl-collapsed-${listId}`;

  let tasks = {};
  let selected = null;
  let collapsed = new Set();
  try { collapsed = new Set(JSON.parse(localStorage.getItem(collapseKey) || '[]')); } catch { /* ignore */ }
  const saveCollapsed = () => { try { localStorage.setItem(collapseKey, JSON.stringify([...collapsed])); } catch { /* ignore */ } };

  /* ---------- helpers ---------- */
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  const notificationLabels = {
    overdue: 'Overdue', today: 'Due today', tomorrow: 'Due tomorrow',
    next7: 'Due in the next 7 days', upcoming: 'Coming up next',
  };
  const notificationDate = (date) => date ? date.split('-').reverse().join('-') : '';
  function renderNotifications(data) {
    const total = Object.values(data.counts).reduce((sum, n) => sum + n, 0);
    const badge = $('#notifications-count');
    badge.textContent = total;
    badge.hidden = total === 0;
    $('#notifications-date').textContent = `Incomplete dated tasks across all lists · ${notificationDate(data.date)}`;
    const content = $('#notifications-content');
    content.replaceChildren();
    for (const [key, label] of Object.entries(notificationLabels)) {
      const section = document.createElement('section');
      section.className = 'notification-section';
      const heading = document.createElement('h3');
      heading.textContent = `${label} (${data.agenda[key].length})`;
      section.append(heading);
      if (!data.agenda[key].length) {
        const empty = document.createElement('p');
        empty.className = 'meta'; empty.textContent = 'None'; section.append(empty);
      } else {
        const list = document.createElement('ul');
        data.agenda[key].forEach((task) => {
          const item = document.createElement('li');
          const link = document.createElement('a');
          link.href = `/lists/${task.list_id}#t${task.id}`;
          link.textContent = `${task.title} — ${task.list_name}`;
          item.append(link, document.createTextNode(` · ${notificationDate(task.agenda_date)}`));
          list.append(item);
        });
        section.append(list);
      }
      content.append(section);
    }
  }
  async function loadNotifications() {
    const data = await api('GET', '/api/notifications');
    renderNotifications(data);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); await refreshTree().catch(() => {}); } };

  const rowEl = (id) => $(`#tree-body tr[data-id="${id}"]`);
  const visibleRows = () => $$('#tree-body tr.task').filter((r) => !r.classList.contains('hidden'));
  const loadData = () => { tasks = JSON.parse($('#tasks-data').textContent || '{}'); };

  /* ---------- tree refresh (keeps panel focus intact) ---------- */
  async function refreshTree() {
    const res = await fetch(location.pathname + location.search, { headers: { Accept: 'text/html' } });
    if (!res.ok) throw new Error('Could not reload tasks');
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    $('.tasks').innerHTML = $('.tasks', doc).innerHTML;
    $('#tasks-data').textContent = $('#tasks-data', doc).textContent;
    $$('datalist').forEach((dl) => { const n = $('#' + dl.id, doc); if (n) dl.innerHTML = n.innerHTML; });
    if (!$('#filters').contains(document.activeElement)) {
      $$('#filters select').forEach((sel) => {
        const n = $(`#filters select[name="${sel.name}"]`, doc);
        if (n) { const v = sel.value; sel.innerHTML = n.innerHTML; sel.value = v; }
      });
    }
    loadData();
    applyCollapse();
    select(selected, { keepFocus: true });
  }

  function applyCollapse() {
    let hideBelow = null;
    for (const tr of $$('#tree-body tr.task')) {
      const depth = Number(tr.dataset.depth);
      if (hideBelow !== null && depth > hideBelow) { tr.classList.add('hidden'); continue; }
      hideBelow = null;
      tr.classList.remove('hidden');
      const isParent = !!$('.twisty.has', tr);
      if (isParent && collapsed.has(Number(tr.dataset.id))) { tr.classList.add('collapsed'); hideBelow = depth; }
      else tr.classList.remove('collapsed');
    }
  }

  /* ---------- selection + detail panel ---------- */
  function select(id, { keepFocus = false } = {}) {
    $$('#tree-body tr.selected').forEach((r) => r.classList.remove('selected'));
    const t = id && tasks[id];
    const panel = $('#panel');
    if (!t) { selected = null; panel.hidden = true; history.replaceState(null, '', location.pathname + location.search); return; }
    selected = id;
    const tr = rowEl(id);
    if (tr) { tr.classList.add('selected'); if (!keepFocus) tr.scrollIntoView({ block: 'nearest' }); }
    history.replaceState(null, '', `${location.pathname}${location.search}#t${id}`);
    panel.hidden = false;
    fillPanel(t);
  }

  function fillPanel(t) {
    $$('[data-field]', $('#panel')).forEach((el) => {
      const f = el.dataset.field;
      el.disabled = !!t.locked && f !== 'locked';
      if (el === document.activeElement) return;
      if (el.type === 'checkbox') el.checked = !!t[f];
      else if (f === 'color') el.value = t.color || '#000000';
      else el.value = t[f] ?? '';
    });
    $('#clear-color').disabled = !!t.locked || !t.color;
    $('#meta').textContent =
      `ID ${t.uid} · created ${t.created_at.slice(0, 16).replace('T', ' ')} · modified ${t.last_mod.slice(0, 16).replace('T', ' ')}`;
  }

  const patchTask = guard(async (id, patch) => {
    const updated = await api('PATCH', `/api/tasks/${id}`, patch);
    tasks[id] = { ...tasks[id], ...updated };
    await refreshTree();
  });

  $('#panel').addEventListener('change', (e) => {
    const el = e.target.closest('[data-field]');
    if (!el || selected == null) return;
    patchTask(selected, { [el.dataset.field]: el.type === 'checkbox' ? el.checked : el.value });
  });
  $('#clear-color').addEventListener('click', () => selected != null && patchTask(selected, { color: '' }));

  /* ---------- tree interactions (delegated) ---------- */
  const tasksEl = $('.tasks');

  tasksEl.addEventListener('click', (e) => {
    const tr = e.target.closest('tr.task');
    if (!tr) return;
    const id = Number(tr.dataset.id);
    if (e.target.matches('.twisty.has')) {
      collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
      saveCollapsed(); applyCollapse();
      return;
    }
    if (e.target.matches('.chk')) return; // handled by change
    select(id);
  });

  tasksEl.addEventListener('change', (e) => {
    if (!e.target.matches('.chk')) return;
    const tr = e.target.closest('tr.task');
    const id = Number(tr.dataset.id);
    select(id);
    patchTask(id, { done: e.target.checked });
  });

  tasksEl.addEventListener('dblclick', (e) => {
    const tr = e.target.closest('tr.task');
    if (tr && e.target.closest('.title, .c-title')) editTitle(tr);
  });

  function editTitle(tr) {
    const id = Number(tr.dataset.id);
    const span = $('.title', tr);
    if (!span || $('.title-edit', tr)) return;
    if (tasks[id].locked) return toast('Task is locked');
    const input = document.createElement('input');
    input.className = 'title-edit';
    input.value = tasks[id].title;
    input.maxLength = 500;
    span.replaceWith(input);
    input.focus(); input.select();
    let finished = false;
    const finish = guard(async (save) => {
      if (finished) return;
      finished = true;
      const v = input.value.trim();
      if (save && v && v !== tasks[id].title) await api('PATCH', `/api/tasks/${id}`, { title: v });
      await refreshTree();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  /* ---------- toolbar actions ---------- */
  const createTask = guard(async (kind) => {
    const body = { list_id: listId, title: 'New task' };
    if (kind === 'sub' && selected) { body.parent_id = selected; collapsed.delete(selected); saveCollapsed(); }
    else if (selected) body.after_id = selected;
    const t = await api('POST', '/api/tasks', body);
    selected = t.id;
    await refreshTree();
    const tr = rowEl(t.id);
    if (tr) { select(t.id); editTitle(tr); } else toast('Task created (hidden by the current filter)');
  });

  const deleteSelected = guard(async () => {
    if (selected == null) return;
    const tr = rowEl(selected);
    const countSubs = (id) => Object.values(tasks).filter((t) => t.parent_id === id)
      .reduce((n, t) => n + 1 + countSubs(t.id), 0);
    const subs = countSubs(selected);
    const name = tasks[selected].title;
    if (!confirm(`Delete “${name}”${subs ? ` and its ${subs} subtask(s)` : ''}?`)) return;
    // pick a neighbour to select afterwards
    const rows = visibleRows();
    const i = rows.indexOf(tr);
    const next = rows[i + 1] || rows[i - 1];
    await api('DELETE', `/api/tasks/${selected}`);
    selected = next ? Number(next.dataset.id) : null;
    await refreshTree();
  });

  const moveSelected = guard(async (action) => {
    if (selected == null) return;
    await api('POST', `/api/tasks/${selected}/move`, { action });
    if (action === 'indent') { const p = tasks[selected].parent_id; if (p) collapsed.delete(p); }
    await refreshTree();
  });

  const newList = guard(async () => {
    const name = prompt('Name for the new list');
    if (name === null) return;
    const l = await api('POST', '/api/lists', { name });
    location.href = `/lists/${l.id}`;
  });
  const deleteList = guard(async () => {
    if (!confirm('Delete this entire list and all its tasks?')) return;
    await api('DELETE', `/api/lists/${listId}`);
    location.href = '/';
  });

  const renameList = guard(async () => {
    // The current list name is already rendered in the page. There is no
    // GET /api/lists/:id endpoint, so avoid making a request that returns 404.
    const listName = $('#list-name').value || '';
    const newName = prompt('Rename list to:', listName);
    if (newName === null) return;
    const l = await api('PATCH', `/api/lists/${listId}`, { name: newName });
    document.title = `${l.name} – ToDoList Web`;
    $('#list-name').value = l.name || '';
    const opt = $(`#list-switch option[value="${listId}"]`);
    if (opt) opt.textContent = l.name || '(untitled)';
  });

  const actions = {
    new: () => createTask('task'), sub: () => createTask('sub'), delete: deleteSelected,
    up: () => moveSelected('up'), down: () => moveSelected('down'),
    indent: () => moveSelected('indent'), outdent: () => moveSelected('outdent'),
    expand: () => { collapsed.clear(); saveCollapsed(); applyCollapse(); },
    collapse: () => { $$('#tree-body tr.task').forEach((r) => { if ($('.twisty.has', r)) collapsed.add(Number(r.dataset.id)); }); saveCollapsed(); applyCollapse(); },
    newlist: newList, deletelist: deleteList, renamelist: renameList,
  };
  $('.toolbar').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (b) actions[b.dataset.act]();
  });

  /* ---------- project / list header ---------- */
  $('#list-name').addEventListener('change', guard(async (e) => {
    const l = await api('PATCH', `/api/lists/${listId}`, { name: e.target.value });
    document.title = `${l.name} – ToDoList Web`;
    const opt = $(`#list-switch option[value="${listId}"]`);
    if (opt) opt.textContent = l.name || '(untitled)';
  }));
  $('#list-switch').addEventListener('change', (e) => { location.href = `/lists/${e.target.value}`; });
  $('#filters').addEventListener('change', () => $('#filters').submit());
  $('#notifications-button').addEventListener('click', async () => {
    try {
      await loadNotifications();
      $('#notifications-dialog').showModal();
    } catch (e) { toast(e.message); }
  });
  $('#notifications-email').addEventListener('click', guard(async () => {
    const button = $('#notifications-email');
    const status = $('#notifications-email-status');
    button.disabled = true; status.textContent = 'Sending…';
    try {
      await api('POST', '/api/notifications/email');
      status.textContent = 'Email sent.';
    } catch (e) {
      status.textContent = e.message;
      throw e;
    } finally { button.disabled = false; }
  }));

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    const rows = visibleRows();
    const i = rows.findIndex((r) => Number(r.dataset.id) === selected);

    if (e.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      actions[{ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'outdent', ArrowRight: 'indent' }[e.key]]();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const r = rows[i === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (r) select(Number(r.dataset.id));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const tr = rows[i];
      if (tr && $('.twisty.has', tr)) {
        e.key === 'ArrowLeft' ? collapsed.add(selected) : collapsed.delete(selected);
        saveCollapsed(); applyCollapse();
      }
    } else if (e.key === 'Insert') { e.preventDefault(); actions[e.ctrlKey ? 'sub' : 'new'](); }
    else if (e.key === 'Delete') { e.preventDefault(); deleteSelected(); }
    else if (e.key === 'F2' && rows[i]) { e.preventDefault(); editTitle(rows[i]); }
  });

  /* ---------- init ---------- */
  loadData();
  applyCollapse();
  loadNotifications().catch(() => {});
  const m = location.hash.match(/^#t(\d+)$/);
  select(m ? Number(m[1]) : null);
})();
