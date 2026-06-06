-- Run once if org_rules already exists without Walrus column
ALTER TABLE org_rules ADD COLUMN IF NOT EXISTS walrus_blob_id TEXT;
