-- Backfill codes for existing options trades
-- This migration generates 5-character uppercase alphanumeric codes for all existing options without codes
-- Codes must not conflict with existing stock trade codes

-- We'll use a deterministic approach based on the ID with an 'O' prefix to distinguish from stock trades
-- Format: O + 4-digit padded ID for option trades

-- Update all records without codes
UPDATE OPTIONS
SET code = (
    SELECT 
        CASE 
            -- For IDs 1-9: Format as "OPT0X" where X is the ID
            WHEN id < 10 THEN 'OPT0' || id
            -- For IDs 10-99: Format as "OPT" || id padded
            WHEN id < 100 THEN 'OP' || printf('%03d', id)
            -- For IDs 100-999: Format as "O" || id padded
            WHEN id < 1000 THEN 'O' || printf('%04d', id)
            -- For larger IDs: Use modulo to keep within 5 characters
            ELSE printf('O%04d', id % 10000)
        END
)
WHERE code IS NULL;
