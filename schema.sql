CREATE TABLE IF NOT EXISTS USERS (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    user_id TEXT UNIQUE,
    password TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    role TEXT NOT NULL DEFAULT 'customer'
);

CREATE TABLE PROJECTS (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES USERS(id)
);

CREATE TABLE ITEMS (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  status TEXT DEFAULT 'New',
  milestone_id INTEGER,
  created_by INTEGER REFERENCES USERS(id),
  updated_by INTEGER REFERENCES USERS(id),
  assignee_id INTEGER REFERENCES USERS(id),
  FOREIGN KEY (project_id) REFERENCES PROJECTS(id) ON DELETE CASCADE
);
