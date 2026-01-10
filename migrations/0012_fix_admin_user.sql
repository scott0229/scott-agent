-- Fix admin user to ensure user_id is set
UPDATE USERS SET user_id = 'admin' WHERE email = 'admin' AND user_id IS NULL;

-- Ensure admin user exists if not already present
INSERT OR IGNORE INTO USERS (email, password, role, user_id) 
VALUES ('admin', '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', 'admin', 'admin');
