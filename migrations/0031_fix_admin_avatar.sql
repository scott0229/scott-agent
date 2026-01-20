-- Remove admin user's external avatar URL to use theme-consistent fallback
-- This ensures the admin avatar always matches the primary theme color
UPDATE USERS 
SET avatar_url = NULL 
WHERE email = 'admin' OR user_id = 'admin';
