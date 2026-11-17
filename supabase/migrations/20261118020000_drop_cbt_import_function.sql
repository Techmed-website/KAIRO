-- The one-time import (tools/question-import/upload.py) is done: remove the temporary entry point and
-- its secret. A future import (e.g. the re-scraped 2001-2025 files) re-creates both with a fresh secret.
drop function public.cbt_import_questions(text, jsonb);
drop table cbt.import_secret;
