-- Add name column to USERS table
ALTER TABLE USERS ADD COLUMN name TEXT;

-- Update admin profile with specific name and avatar
UPDATE USERS 
SET name = '管理者', 
    avatar_url = 'https://ui-avatars.com/api/?name=Admin&background=random' 
WHERE email = 'admin';

-- Set default name for other users to be their user_id
UPDATE USERS SET name = user_id WHERE name IS NULL;
