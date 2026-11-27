-- Pin search_path on the small Founder Intelligence helpers (Supabase advisor: function_search_path_mutable).
alter function cbt._fi_event_names() set search_path = cbt, pg_temp;
alter function cbt._fi_features() set search_path = cbt, pg_temp;
alter function cbt._fi_meaningful() set search_path = cbt, pg_temp;
alter function cbt._fi_clean_props(jsonb) set search_path = cbt, pg_temp;
alter function cbt._fi_day(timestamptz) set search_path = cbt, pg_temp;
alter function cbt._fi_ts(date) set search_path = cbt, pg_temp;
alter function cbt._fi_feature(cbt.assessment_type, boolean, text) set search_path = cbt, pg_temp;
alter function cbt._fi_category(text) set search_path = cbt, pg_temp;
alter function cbt._fi_code(uuid, boolean) set search_path = cbt, pg_temp;
alter function cbt._fi_check_range(date, date) set search_path = cbt, pg_temp;
