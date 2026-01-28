-- Update operation field from '無' to '新開倉'
UPDATE OPTIONS 
SET operation = '新開倉' 
WHERE operation = '無' OR operation IS NULL;
