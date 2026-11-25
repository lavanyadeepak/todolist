const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const file = process.env.DB_PATH || path.join(__dirname, 'data', 'todolist.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

const db = new Database(file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// One "list" == one .tdl file in the original (PROJECTNAME, NEXTUNIQUEID).
// One "task" row == one TASK element; nesting via parent_id (PARENTID) + pos (POS).
db.exec(`
CREATE TABLE IF NOT EXISTS lists (
  id        INTEGER PRIMARY KEY,
  name      TEXT    NOT NULL DEFAULT '',
  next_uid  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT   NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id              INTEGER PRIMARY KEY,
  list_id         INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  uid             INTEGER NOT NULL,                 -- ID column (per list)
  parent_id       INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  pos             INTEGER NOT NULL DEFAULT 0,

  title           TEXT    NOT NULL,
  comments        TEXT    NOT NULL DEFAULT '',
  priority        INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 0 AND 10),
  risk            INTEGER NOT NULL DEFAULT 0 CHECK (risk BETWEEN 0 AND 10),
  percent_done    INTEGER NOT NULL DEFAULT 0 CHECK (percent_done BETWEEN 0 AND 100),
  status          TEXT    NOT NULL DEFAULT '',
  allocated_to    TEXT    NOT NULL DEFAULT '',      -- comma separated (aAllocTo)
  allocated_by    TEXT    NOT NULL DEFAULT '',
  category        TEXT    NOT NULL DEFAULT '',      -- comma separated
  tags            TEXT    NOT NULL DEFAULT '',      -- comma separated
  color           TEXT    NOT NULL DEFAULT '',      -- #rrggbb or ''
  flagged         INTEGER NOT NULL DEFAULT 0,
  locked          INTEGER NOT NULL DEFAULT 0,

  start_date      TEXT,                             -- YYYY-MM-DD
  due_date        TEXT,
  done_date       TEXT,
  time_estimate   REAL    NOT NULL DEFAULT 0,
  time_est_units  TEXT    NOT NULL DEFAULT 'hours',
  time_spent      REAL    NOT NULL DEFAULT 0,
  time_spent_units TEXT   NOT NULL DEFAULT 'hours',
  cost            REAL    NOT NULL DEFAULT 0,

  depends         TEXT    NOT NULL DEFAULT '',      -- comma separated uids
  file_link       TEXT    NOT NULL DEFAULT '',
  external_id     TEXT    NOT NULL DEFAULT '',
  version         TEXT    NOT NULL DEFAULT '',
  icon            TEXT    NOT NULL DEFAULT '',

  recur_freq      TEXT    NOT NULL DEFAULT 'none',  -- none|daily|weekly|monthly|yearly
  recur_interval  INTEGER NOT NULL DEFAULT 1,
  recur_reuse     INTEGER NOT NULL DEFAULT 1,       -- 1: reset this task, 0: spawn a copy

  created_at      TEXT    NOT NULL,
  created_by      TEXT    NOT NULL DEFAULT '',
  last_mod        TEXT    NOT NULL,
  last_mod_by     TEXT    NOT NULL DEFAULT '',

  UNIQUE (list_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_tasks_list_parent ON tasks(list_id, parent_id, pos);

CREATE TABLE IF NOT EXISTS auth_users (
  username     TEXT PRIMARY KEY NOT NULL,
  password_hash TEXT NOT NULL
);
`);

module.exports = db;
