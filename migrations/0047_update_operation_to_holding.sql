-- Migration: Update operation value from '新開倉' to '持有中'
-- This updates all existing option records with operation '新開倉' to '持有中'

UPDATE OPTIONS 
SET operation = '持有中' 
WHERE operation = '新開倉';
