# ToDoList Web

A minimal web re-implementation of AbstractSpoon ToDoList using **Node + Express + EJS + SQLite** (better-sqlite3).
Single-user, no login, listens on `127.0.0.1` only.

    npm install
    npm start            # http://127.0.0.1:3000
    npm test

Env: `PORT`, `HOST` (set deliberately if you expose it; there is no auth), `DB_PATH` (default `data/todolist.db`).

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
archiving, multi-user/auth, undo, rich-text comments.
