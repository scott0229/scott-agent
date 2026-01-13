-- Fix admin password to use bcrypt hash instead of SHA256
-- Bcrypt hash of "admin" with 10 salt rounds
UPDATE USERS 
SET password = '$2b$10$QxRFR64PiqVRPn2oGyeh/.4hMZfHUk1dMnrCDiZKrQHNIetivdDU2' 
WHERE email = 'admin' OR user_id = 'admin';
