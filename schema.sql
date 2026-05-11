CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task TEXT NOT NULL,
  start_date TEXT,
  due_date TEXT,
  email TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  start_email_sent INTEGER NOT NULL DEFAULT 0,
  due_email_sent INTEGER NOT NULL DEFAULT 0,
  overdue_email_sent INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
