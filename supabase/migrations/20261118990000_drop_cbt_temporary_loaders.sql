-- Applied 18 Nov 2026 (run by Wisdom in the Supabase SQL editor).
-- Removes the temporary content entry points and their one-time secret once content loading moves to
-- the /admin screens. A later import (e.g. the re-scraped 2001-2025 files) re-creates them with a fresh
-- secret. The pg_cron job 'kairo-daily-quiz-publish' stays: it is part of the daily quiz.
drop function public.cbt_import_questions(text, jsonb);
drop function public.cbt_load_daily_week(text, jsonb);
drop table cbt.import_secret;
