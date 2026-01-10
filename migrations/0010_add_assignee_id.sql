ALTER TABLE ITEMS ADD COLUMN assignee_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_items_assignee_id ON ITEMS(assignee_id);
