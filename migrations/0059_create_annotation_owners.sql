-- Create junction table for annotation owners (many-to-many)
CREATE TABLE IF NOT EXISTS ANNOTATION_OWNERS (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    annotation_id INTEGER NOT NULL,
    owner_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    FOREIGN KEY (annotation_id) REFERENCES ANNOTATIONS(id) ON DELETE CASCADE
);

-- Migrate existing data from ANNOTATIONS to ANNOTATION_OWNERS
INSERT INTO ANNOTATION_OWNERS (annotation_id, owner_id, user_id)
SELECT id, owner_id, user_id FROM ANNOTATIONS WHERE owner_id IS NOT NULL;
