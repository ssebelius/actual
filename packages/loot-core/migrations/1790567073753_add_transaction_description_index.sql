BEGIN TRANSACTION;

CREATE INDEX IF NOT EXISTS trans_description ON transactions(description);

COMMIT;
