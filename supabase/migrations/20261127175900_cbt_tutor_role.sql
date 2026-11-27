-- Tutors: staff who take attendance and follow students, without question-editing rights (editors) or founder analytics (admin).
alter type cbt.user_role add value if not exists 'tutor';
