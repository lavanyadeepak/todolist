const db = require('./db');
const { FIELDS, HttpError } = require('./fields');

/* ---------- dates ---------- */
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const nowStamp = () => new Date().toISOString();

function advance(dateStr, freq, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (freq === 'daily') return isoDate(new Date(y, m - 1, d + n));
  if (freq === 'weekly') return isoDate(new Date(y, m - 1, d + 7 * n));
  const months = freq === 'yearly' ? 12 * n : n;
  const first = new Date(y, m - 1 + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return isoDate(new Date(first.getFullYear(), first.getMonth(), Math.min(d, last)));
}

/* ---------- lookups ---------- */
function getList(id) {
  const l = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
  if (!l) throw new HttpError(404, 'List not found');
  return l;
}
function getTask(id) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!t) throw new HttpError(404, 'Task not found');
  return t;
}
const siblings = (listId, parentId) =>
  db.prepare('SELECT id FROM tasks WHERE list_id = ? AND parent_id IS ? ORDER BY pos, id')
    .all(listId, parentId).map((r) => r.id);

function renumber(ids) {
  const st = db.prepare('UPDATE tasks SET pos = ? WHERE id = ?');
  ids.forEach((id, i) => st.run(i, id));
}
function descendantIds(id) {
  return db.prepare(`
    WITH RECURSIVE d(id) AS (
      SELECT id FROM tasks WHERE parent_id = ?
      UNION ALL SELECT t.id FROM tasks t JOIN d ON t.parent_id = d.id
    ) SELECT id FROM d`).all(id).map((r) => r.id);
}

/* ---------- lists ---------- */
function createList(name) {
  name = String(name || '').trim().slice(0, 200) || 'Untitled';
  const info = db.prepare('INSERT INTO lists (name) VALUES (?)').run(name);
  return getList(info.lastInsertRowid);
}
function renameList(id, name) {
  getList(id);
  db.prepare('UPDATE lists SET name = ? WHERE id = ?').run(String(name || '').trim().slice(0, 200), id);
  return getList(id);
}
function deleteList(id) {
  getList(id);
  if (db.prepare('SELECT COUNT(*) c FROM lists').get().c <= 1) throw new HttpError(400, 'Cannot delete the last list');
  db.prepare('DELETE FROM lists WHERE id = ?').run(id);
}

/* ---------- tasks: create / update / delete ---------- */
const createTask = db.transaction(({ listId, parentId = null, afterId = null, title }) => {
  const list = getList(listId);
  title = FIELDS.title(title || 'New task');

  let parent = parentId;
  let index = null;
  if (afterId) {
    const ref = getTask(afterId);
    if (ref.list_id !== listId) throw new HttpError(400, 'Task belongs to another list');
    parent = ref.parent_id;
    index = siblings(listId, parent).indexOf(ref.id) + 1;
  } else if (parent) {
    if (getTask(parent).list_id !== listId) throw new HttpError(400, 'Parent belongs to another list');
  }

  const stamp = nowStamp();
  const info = db.prepare(`
    INSERT INTO tasks (list_id, uid, parent_id, title, start_date, created_at, last_mod)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(listId, list.next_uid, parent, title, today(), stamp, stamp);
  db.prepare('UPDATE lists SET next_uid = next_uid + 1 WHERE id = ?').run(listId);

  const ids = siblings(listId, parent).filter((i) => i !== info.lastInsertRowid);
  ids.splice(index ?? ids.length, 0, info.lastInsertRowid);
  renumber(ids);
  return getTask(info.lastInsertRowid);
});

const updateTask = db.transaction((id, patch) => {
  const task = getTask(id);
  const keys = Object.keys(patch).filter((k) => k !== 'done');
  for (const k of keys) if (!FIELDS[k]) throw new HttpError(400, `Unknown field: ${k}`);

  const unlocking = keys.length === 1 && keys[0] === 'locked';
  if (task.locked && !unlocking) throw new HttpError(423, 'Task is locked');

  const values = {};
  for (const k of keys) {
    try { values[k] = FIELDS[k](patch[k]); }
    catch (e) { throw new HttpError(400, `${k}: ${e.message}`); }
  }
  const completesByPercent = values.percent_done === 100 && !task.done_date;
  if (values.percent_done === 100 && !('done_date' in values) && !task.done_date) values.done_date = today();
  if ('percent_done' in values && values.percent_done < 100 && !('done_date' in values)) values.done_date = null;

  if (Object.keys(values).length) {
    const sets = Object.keys(values).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE tasks SET ${sets}, last_mod = @_mod WHERE id = @_id`)
      .run({ ...values, _mod: nowStamp(), _id: id });
  }
  if ('done' in patch) setDone(id, !!patch.done);
  else if (completesByPercent) {
    const updated = getTask(id);
    if (updated.recur_freq !== 'none') recur(updated);
  }
  return getTask(id);
});

function setDone(id, done) {
  const t = getTask(id);
  const stamp = nowStamp();
  if (!done) {
    db.prepare(`UPDATE tasks SET done_date = NULL, percent_done = CASE WHEN percent_done = 100 THEN 0 ELSE percent_done END,
                last_mod = ? WHERE id = ?`).run(stamp, id);
    return;
  }
  const ids = [id, ...descendantIds(id)];
  const mark = db.prepare('UPDATE tasks SET done_date = COALESCE(done_date, ?), percent_done = 100, last_mod = ? WHERE id = ?');
  ids.forEach((i) => mark.run(today(), stamp, i));
  if (t.recur_freq !== 'none') recur(t);
}

function recur(t) {
  const step = (d) => (d ? advance(d, t.recur_freq, t.recur_interval) : null);
  let start = step(t.start_date);
  let due = step(t.due_date);
  if (!start && !due) start = advance(today(), t.recur_freq, t.recur_interval);

  if (t.recur_reuse) {
    // reset this task (and its subtasks) for the next occurrence
    const ids = [t.id, ...descendantIds(t.id)];
    const reset = db.prepare('UPDATE tasks SET done_date = NULL, percent_done = 0, last_mod = ? WHERE id = ?');
    ids.forEach((i) => reset.run(nowStamp(), i));
    db.prepare('UPDATE tasks SET start_date = ?, due_date = ? WHERE id = ?').run(start, due, t.id);
  } else {
    // keep the completed one, spawn a fresh copy right after it
    const copy = createTask({ listId: t.list_id, afterId: t.id, title: t.title });
    const cols = ['comments', 'priority', 'risk', 'status', 'allocated_to', 'allocated_by', 'category', 'tags', 'color',
      'time_estimate', 'time_est_units', 'cost', 'depends', 'file_link', 'external_id', 'icon',
      'recur_freq', 'recur_interval', 'recur_reuse'];
    const sets = cols.map((c) => `${c} = @${c}`).join(', ');
    db.prepare(`UPDATE tasks SET ${sets}, start_date = @start, due_date = @due WHERE id = @id`)
      .run({ ...Object.fromEntries(cols.map((c) => [c, t[c]])), start, due, id: copy.id });
  }
}

function deleteTask(id) {
  const t = getTask(id);
  if (t.locked) throw new HttpError(423, 'Task is locked');
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  renumber(siblings(t.list_id, t.parent_id));
}

const moveTask = db.transaction((id, action) => {
  const t = getTask(id);
  const sib = siblings(t.list_id, t.parent_id);
  const i = sib.indexOf(id);

  if (action === 'up' || action === 'down') {
    const j = action === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= sib.length) return;
    [sib[i], sib[j]] = [sib[j], sib[i]];
    renumber(sib);
  } else if (action === 'indent') {
    if (i === 0) throw new HttpError(400, 'No previous sibling to indent under');
    const newParent = sib[i - 1];
    sib.splice(i, 1);
    renumber(sib);
    db.prepare('UPDATE tasks SET parent_id = ? WHERE id = ?').run(newParent, id);
    renumber(siblings(t.list_id, newParent).filter((x) => x !== id).concat(id));
  } else if (action === 'outdent') {
    if (!t.parent_id) throw new HttpError(400, 'Already at top level');
    const parent = getTask(t.parent_id);
    sib.splice(i, 1);
    renumber(sib);
    db.prepare('UPDATE tasks SET parent_id = ? WHERE id = ?').run(parent.parent_id, id);
    const psib = siblings(t.list_id, parent.parent_id).filter((x) => x !== id);
    psib.splice(psib.indexOf(parent.id) + 1, 0, id);
    renumber(psib);
  } else {
    throw new HttpError(400, 'Unknown move');
  }
});

/* ---------- tree for display ---------- */
const SORTS = {
  pos: (t) => t.pos,
  id: (t) => t.uid,
  title: (t) => t.title.toLowerCase(),
  priority: (t) => t.priority,
  percent: (t) => t.calc_percent,
  start: (t) => t.start_date,
  due: (t) => t.due_date,
  est: (t) => t.time_estimate,
  spent: (t) => t.time_spent,
  alloc: (t) => t.allocated_to.toLowerCase(),
  status: (t) => t.status.toLowerCase(),
  category: (t) => t.category.toLowerCase(),
};

function buildTree(listId, f = {}) {
  const rows = db.prepare('SELECT * FROM tasks WHERE list_id = ? ORDER BY pos, id').all(listId);
  const nodes = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const n of nodes.values()) (n.parent_id ? nodes.get(n.parent_id).children : roots).push(n);

  const t0 = today();
  const weekEnd = advance(t0, 'weekly', 1);

  const calc = (n) => {
    n.children.forEach(calc);
    n.sub_total = n.children.length;
    n.sub_done = n.children.filter((c) => c.done_date).length;
    n.calc_percent = n.done_date ? 100
      : n.children.length ? Math.round(n.children.reduce((s, c) => s + c.calc_percent, 0) / n.children.length)
      : n.percent_done;
    n.overdue = !n.done_date && !!n.due_date && n.due_date < t0;
  };
  roots.forEach(calc);

  const q = (f.q || '').toLowerCase();
  const hasTag = (n, tag) => n.tags.split(',').map((s) => s.trim()).includes(tag);
  const matches = (n) => {
    switch (f.show) {
      case 'incomplete': if (n.done_date) return false; break;
      case 'complete': if (!n.done_date) return false; break;
      case 'overdue': if (!n.overdue) return false; break;
      case 'today': if (n.done_date || n.due_date !== t0) return false; break;
      case 'week': if (n.done_date || !n.due_date || n.due_date < t0 || n.due_date > weekEnd) return false; break;
      case 'flagged': if (!n.flagged) return false; break;
    }
    if (q && !n.title.toLowerCase().includes(q) && !n.comments.toLowerCase().includes(q)) return false;
    if (f.status && n.status !== f.status) return false;
    if (f.category && !n.category.split(',').map((s) => s.trim()).includes(f.category)) return false;
    if (f.alloc && !n.allocated_to.split(',').map((s) => s.trim()).includes(f.alloc)) return false;
    if (f.tag && !hasTag(n, f.tag)) return false;
    return true;
  };

  const key = SORTS[f.sort] || SORTS.pos;
  const dir = f.dir === 'desc' ? -1 : 1;
  const cmp = (a, b) => {
    const x = key(a), y = key(b);
    const ex = x === null || x === '' || x === undefined, ey = y === null || y === '' || y === undefined;
    if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1; // empty values always last
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  };

  const prune = (list) => {
    const out = [];
    for (const n of list) {
      n.children = prune(n.children);
      if (matches(n) || n.children.length) out.push(n);
    }
    return out.sort(cmp);
  };
  const tree = prune(roots);

  const distinct = (col) => [...new Set(rows.flatMap((r) => r[col].split(',').map((s) => s.trim())).filter(Boolean))].sort();
  const flat = [];
  (function walk(list) { list.forEach((n) => { flat.push(n); walk(n.children); }); })(tree);

  return {
    tree, flat, total: rows.length,
    distinct: {
      status: distinct('status'), category: distinct('category'),
      alloc: distinct('allocated_to'), tag: distinct('tags'),
    },
  };
}

function exportList(listId) {
  const list = getList(listId);
  const tasks = db.prepare('SELECT * FROM tasks WHERE list_id = ? ORDER BY pos, id').all(listId);
  return { app: 'todolist-web', version: 1, list: { name: list.name }, tasks };
}

function notificationAgenda() {
  const todayDate = today();
  const tomorrowDate = advance(todayDate, 'daily', 1);
  const nextSevenDate = advance(todayDate, 'daily', 7);
  const rows = db.prepare(`
    SELECT t.id, t.list_id, l.name AS list_name, t.title, t.priority,
           t.due_date, t.start_date, t.due_date AS agenda_date
    FROM tasks t
    JOIN lists l ON l.id = t.list_id
    WHERE t.done_date IS NULL AND t.due_date IS NOT NULL AND t.due_date <> ''
    ORDER BY agenda_date, t.priority DESC, t.id`).all();

  const agenda = { overdue: [], today: [], tomorrow: [], next7: [], upcoming: [] };
  for (const task of rows) {
    if (task.agenda_date < todayDate) agenda.overdue.push(task);
    else if (task.agenda_date === todayDate) agenda.today.push(task);
    else if (task.agenda_date === tomorrowDate) agenda.tomorrow.push(task);
    else if (task.agenda_date <= nextSevenDate) agenda.next7.push(task);
    else agenda.upcoming.push(task);
  }
  return {
    date: todayDate,
    counts: Object.fromEntries(Object.entries(agenda).map(([key, items]) => [key, items.length])),
    agenda,
  };
}

module.exports = {
  today, getList, getTask, createList, renameList, deleteList,
  createTask, updateTask, deleteTask, moveTask, buildTree, exportList, notificationAgenda,
};
