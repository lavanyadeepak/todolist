const path = require('path');
const express = require('express');
const db = require('./db');
const T = require('./tasks');
const { HttpError, UNITS, RECUR } = require('./fields');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const idParam = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'Not found');
  return n;
};
const str = (v) => (typeof v === 'string' ? v : '');

/* ---------- pages ---------- */
app.get('/', (req, res) => {
  const first = db.prepare('SELECT id FROM lists ORDER BY id LIMIT 1').get() || T.createList('My Tasks');
  res.redirect(`/lists/${first.id}`);
});

app.get('/lists/:id', (req, res) => {
  const list = T.getList(idParam(req.params.id));
  const filters = {};
  for (const k of ['show', 'q', 'status', 'category', 'alloc', 'tag', 'sort', 'dir']) filters[k] = str(req.query[k]);
  const view = T.buildTree(list.id, filters);

  const data = Object.fromEntries(view.flat.map((n) => {
    const { children, ...rest } = n;
    return [n.id, rest];
  }));

  res.render('index', {
    list, lists: db.prepare('SELECT id, name FROM lists ORDER BY id').all(),
    ...view, f: filters, today: T.today(), UNITS, RECUR,
    json: JSON.stringify(data).replace(/</g, '\\u003c'),
  });
});

app.get('/lists/:id/export.json', (req, res) => {
  const out = T.exportList(idParam(req.params.id));
  res.attachment(`${out.list.name.replace(/[^\w.-]+/g, '_') || 'tasklist'}.json`).json(out);
});

/* ---------- JSON API ---------- */
app.post('/api/lists', (req, res) => res.status(201).json(T.createList(req.body.name)));
app.patch('/api/lists/:id', (req, res) => res.json(T.renameList(idParam(req.params.id), req.body.name)));
app.delete('/api/lists/:id', (req, res) => { T.deleteList(idParam(req.params.id)); res.json({ ok: true }); });

app.post('/api/tasks', (req, res) => {
  const b = req.body;
  res.status(201).json(T.createTask({
    listId: idParam(b.list_id),
    parentId: b.parent_id ? idParam(b.parent_id) : null,
    afterId: b.after_id ? idParam(b.after_id) : null,
    title: b.title,
  }));
});
app.patch('/api/tasks/:id', (req, res) => res.json(T.updateTask(idParam(req.params.id), req.body || {})));
app.delete('/api/tasks/:id', (req, res) => { T.deleteTask(idParam(req.params.id)); res.json({ ok: true }); });
app.post('/api/tasks/:id/move', (req, res) => {
  T.moveTask(idParam(req.params.id), str(req.body.action));
  res.json({ ok: true });
});

/* ---------- errors ---------- */
app.use((req, res) => res.status(404).type('text').send('Not found'));
app.use((err, req, res, _next) => {
  const status = err.status || (err.code && String(err.code).startsWith('SQLITE_') ? 400 : 500);
  if (status === 500) console.error(err);
  const message = status === 500 ? 'Internal error' : err.message;
  if (req.path.startsWith('/api/')) return res.status(status).json({ error: message });
  res.status(status).type('text').send(message);
});

module.exports = app;
