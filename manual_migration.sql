CREATE TABLE PROJECT_USERS (
    project_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    assigned_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (project_id) REFERENCES PROJECTS(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES USERS(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, user_id)
);

CREATE INDEX idx_project_users_project ON PROJECT_USERS(project_id);
CREATE INDEX idx_project_users_user ON PROJECT_USERS(user_id);
