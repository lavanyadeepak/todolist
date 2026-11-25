# ToDoList Web

A minimal web re-implementation of AbstractSpoon ToDoList using **Node + Express + EJS + SQLite** (better-sqlite3).
All users share the same task data. The app uses HTTP Basic authentication and listens on `127.0.0.1` by default.

    npm install
    npm start            # http://127.0.0.1:3000
    npm test

Env: `PORT`, `HOST` (set deliberately to expose it), `DB_PATH` (default `data/todolist.db`).

## Authentication

The first request displays the browser's built-in username/password prompt. Credentials are checked against the
`auth_users` table in SQLite; passwords must be bcrypt hashes in the format produced by Apache `htpasswd -B`.
Create a hash with `htpasswd -B -C 12 -n alice`, then insert or update the row using the username and hash from
its output:

```sql
INSERT INTO auth_users (username, password_hash)
VALUES ('alice', '$2y$12$...replace-with-the-full-hash...')
ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash;
```

The table is created automatically at startup. To reset a password, generate a new hash and update that user's
`password_hash` row. There is no self-service recovery or account-management page. Basic authentication sends
the password with each request, so use HTTPS (typically via a reverse proxy) before setting `HOST` to a
non-local address.

## What's in
- Multiple task lists (= one .tdl file / project), each with its own per-list task ID
- Unlimited nested subtasks; move up/down, indent/outdent, collapse/expand (state remembered)
- Fields: title, comments, priority, risk, % done (parents roll up from children), status, allocated to/by,
  category, tags, colour, flag, lock, start/due/done dates, time estimate/spent (+units), cost,
  dependencies, file link, external id, version, icon, recurrence (daily/weekly/monthly/yearly; reuse or spawn copy)
- Filters (show, text, status, category, tag, allocated to), column sorting, JSON export
- Keyboard: Insert / Ctrl+Insert, Delete, F2, arrows, Alt+arrows

## Not yet (vs the original)
Custom attributes, import of existing `.tdl` XML, reminders, time tracking, other views (Gantt, calendar, kanban),
archiving, per-user data/permissions, undo, rich-text comments.
