-- 入金上限: per-account deposit cap shown/edited in the 帳戶設定 table.
-- NULL = no limit set. Stored on the USERS row (per account/year), edited
-- via the account edit dialog like start_date / operation_mode.
ALTER TABLE USERS ADD COLUMN deposit_limit REAL;
