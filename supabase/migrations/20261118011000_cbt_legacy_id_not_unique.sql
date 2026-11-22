-- legacy_id points at the old kairo.questions row whose (Claude-written) explanation a question borrows.
-- Two re-transcriptions of the same question can borrow the same one, so it is not an identity.
alter table cbt.questions drop constraint questions_legacy_id_key;
create index questions_legacy_id_idx on cbt.questions (legacy_id) where legacy_id is not null;
