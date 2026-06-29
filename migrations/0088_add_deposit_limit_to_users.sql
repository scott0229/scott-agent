-- 入金上限: per-account deposit cap shown/edited in the 帳戶設定 table.
-- Value is in 萬 (ten-thousands) — e.g. 50 means 50萬 = 500,000. NULL = no
-- limit set. Stored on the USERS row (per account/year), edited via the
-- account edit dialog like start_date / operation_mode.
ALTER TABLE USERS ADD COLUMN deposit_limit REAL;
