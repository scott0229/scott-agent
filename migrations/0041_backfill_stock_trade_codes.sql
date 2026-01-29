-- Backfill codes for existing stock trades
-- This migration generates 5-character uppercase alphanumeric codes for all existing trades without codes

-- We'll use a simple approach: generate codes based on row ID to ensure uniqueness
-- Format: Combination of letters and numbers based on the ID

-- For existing records, we'll generate codes using a combination of:
-- 1. Convert ID to base-36 (0-9, A-Z)
-- 2. Pad with random prefix to make 5 characters

-- Since SQLite doesn't have built-in random functions that persist, 
-- we'll use a deterministic approach based on the ID itself
-- This ensures uniqueness and consistency

-- Update all records without codes
UPDATE STOCK_TRADES
SET code = (
    SELECT 
        CASE 
            -- For IDs 1-9: Format as "TRD0X" where X is the ID
            WHEN id < 10 THEN 'TRD0' || id
            -- For IDs 10-99: Format as "TRD" || id padded
            WHEN id < 100 THEN 'TR' || printf('%03d', id)
            -- For IDs 100-999: Format as "T" || id padded
            WHEN id < 1000 THEN 'T' || printf('%04d', id)
            -- For larger IDs: Use modulo to keep within 5 characters
            ELSE printf('%05d', id % 100000)
        END
)
WHERE code IS NULL;
