process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../app');

let base, server;
test.before(async () => {
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = async (method, url, body) => {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text };
};

test('home redirects to a list and renders', async () => {
  const res = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(res.status, 302);
  const page = await call('GET', res.headers.get('location'));
  assert.equal(page.status, 200);
  assert.match(page.text, /ToDoList Web/);
});

test('create, nest, reorder, update, done, delete', async () => {
  const listId = 1;
  const a = (await call('POST', '/api/tasks', { list_id: listId, title: 'A' })).json;
  const b = (await call('POST', '/api/tasks', { list_id: listId, title: 'B' })).json;
  const c = (await call('POST', '/api/tasks', { list_id: listId, parent_id: a.id, title: 'A.1' })).json;
  assert.deepEqual([a.uid, b.uid, c.uid], [1, 2, 3]);

  // insert after A -> between A and B
  const mid = (await call('POST', '/api/tasks', { list_id: listId, after_id: a.id, title: 'Mid' })).json;
  let page = (await call('GET', `/lists/${listId}`)).text;
  const order = [...page.matchAll(/class="title">([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(order, ['A', 'A.1', 'Mid', 'B']);

  // move B up, indent, outdent
  await call('POST', `/api/tasks/${b.id}/move`, { action: 'up' });
  await call('POST', `/api/tasks/${b.id}/move`, { action: 'indent' }); // under A (its previous sibling)
  page = (await call('GET', `/lists/${listId}`)).text;
  assert.match(page, new RegExp(`data-id="${b.id}" data-depth="1" data-parent="${a.id}"`));
  await call('POST', `/api/tasks/${b.id}/move`, { action: 'outdent' });
  page = (await call('GET', `/lists/${listId}`)).text;
  assert.match(page, new RegExp(`data-id="${b.id}" data-depth="0"`));

  // field validation
  assert.equal((await call('PATCH', `/api/tasks/${a.id}`, { priority: 11 })).status, 400);
  assert.equal((await call('PATCH', `/api/tasks/${a.id}`, { due_date: '2026-02-31' })).status, 400);
  assert.equal((await call('PATCH', `/api/tasks/${a.id}`, { color: 'red' })).status, 400);
  assert.equal((await call('PATCH', `/api/tasks/${a.id}`, { nope: 1 })).status, 400);
  assert.equal((await call('PATCH', `/api/tasks/${a.id}`, { title: '  ' })).status, 400);
  const ok = await call('PATCH', `/api/tasks/${a.id}`, { priority: 8, due_date: '2026-12-01', tags: 'x, y', color: '#FF0000' });
  assert.equal(ok.json.priority, 8);
  assert.equal(ok.json.color, '#ff0000');

  // marking a parent done completes subtasks
  const done = await call('PATCH', `/api/tasks/${a.id}`, { done: true });
  assert.ok(done.json.done_date);
  page = (await call('GET', `/lists/${listId}?show=incomplete`)).text;
  assert.doesNotMatch(page, /class="title">A\.1</);

  // lock blocks edits and deletes
  await call('PATCH', `/api/tasks/${mid.id}`, { locked: true });
  assert.equal((await call('PATCH', `/api/tasks/${mid.id}`, { title: 'x' })).status, 423);
  assert.equal((await call('DELETE', `/api/tasks/${mid.id}`)).status, 423);
  await call('PATCH', `/api/tasks/${mid.id}`, { locked: false });

  // delete cascades
  await call('DELETE', `/api/tasks/${a.id}`);
  const gone = await call('PATCH', `/api/tasks/${c.id}`, { title: 'x' });
  assert.equal(gone.status, 404);
});

test('recurring task resets with advanced dates; spawn-copy mode keeps the old one', async () => {
  const t = (await call('POST', '/api/tasks', { list_id: 1, title: 'Weekly review' })).json;
  await call('PATCH', `/api/tasks/${t.id}`, { start_date: '2026-11-22', due_date: '2026-11-29', recur_freq: 'weekly', recur_interval: 1 });
  const r = await call('PATCH', `/api/tasks/${t.id}`, { done: true });
  assert.equal(r.json.done_date, null);
  assert.equal(r.json.due_date, '2026-12-06');
  assert.equal(r.json.percent_done, 0);

  const yearly = (await call('POST', '/api/tasks', { list_id: 1, title: 'Yearly review' })).json;
  await call('PATCH', `/api/tasks/${yearly.id}`, {
    start_date: '2026-11-22', due_date: '2026-11-29', recur_freq: 'yearly', recur_interval: 1,
  });
  const yearlyDone = await call('PATCH', `/api/tasks/${yearly.id}`, { percent_done: 100 });
  assert.equal(yearlyDone.json.done_date, null);
  assert.equal(yearlyDone.json.start_date, '2027-11-22');
  assert.equal(yearlyDone.json.due_date, '2027-11-29');
  assert.equal(yearlyDone.json.percent_done, 0);

  const m = (await call('POST', '/api/tasks', { list_id: 1, title: 'Rent' })).json;
  await call('PATCH', `/api/tasks/${m.id}`, { due_date: '2026-01-31', recur_freq: 'monthly', recur_reuse: false });
  const done = await call('PATCH', `/api/tasks/${m.id}`, { done: true });
  assert.ok(done.json.done_date);
  const page = (await call('GET', '/lists/1?q=Rent')).text;
  assert.equal([...page.matchAll(/class="title">Rent</g)].length, 2);
  assert.match(page, /28-02-2026/); // Jan 31 + 1 month clamps to Feb 28
});

test('notifications summarize incomplete dated tasks across lists', async () => {
  const dated = (await call('POST', '/api/tasks', { list_id: 1, title: 'Notification task' })).json;
  await call('PATCH', `/api/tasks/${dated.id}`, { start_date: '2026-11-22', due_date: '2026-11-22' });
  const result = await call('GET', '/api/notifications');
  assert.equal(result.status, 200);
  assert.ok(result.json.counts.today >= 1);
  assert.ok(result.json.agenda.today.some((task) => task.title === 'Notification task'));

  const undated = (await call('POST', '/api/tasks', { list_id: 1, title: 'No due date' })).json;
  await call('PATCH', `/api/tasks/${undated.id}`, { start_date: '2026-11-22' });
  const withoutDueDate = await call('GET', '/api/notifications');
  assert.ok(!Object.values(withoutDueDate.json.agenda).flat().some((task) => task.title === 'No due date'));
});

test('filters, sort, XSS escaping, lists, export', async () => {
  const x = (await call('POST', '/api/tasks', { list_id: 1, title: '<script>alert(1)</script>' })).json;
  await call('PATCH', `/api/tasks/${x.id}`, { comments: '</script><b>boom</b>', status: 'Blocked' });
  const page = (await call('GET', '/lists/1?status=Blocked')).text;
  assert.doesNotMatch(page, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(page, /<\/script><b>boom/);
  assert.match(page, /&lt;script&gt;alert\(1\)/);

  assert.equal((await call('GET', '/lists/1?sort=bogus&dir=sideways')).status, 200);
  assert.equal((await call('GET', '/lists/999')).status, 404);

  const l2 = (await call('POST', '/api/lists', { name: 'Second' })).json;
  assert.equal((await call('POST', '/api/tasks', { list_id: l2.id, title: 'Other' })).json.uid, 1);
  assert.equal((await call('DELETE', `/api/lists/${l2.id}`)).status, 200);
  assert.equal((await call('DELETE', '/api/lists/1')).status, 400); // last list

  const exp = await call('GET', '/lists/1/export.json');
  assert.equal(exp.json.app, 'todolist-web');
  assert.ok(exp.json.tasks.length > 0);
});
