-- Batch 2 (1/2): a new assessment type for prize challenges and competitions.
-- Kept in its own migration because a new enum value cannot be used in the transaction that adds it.
alter type cbt.assessment_type add value if not exists 'challenge';
