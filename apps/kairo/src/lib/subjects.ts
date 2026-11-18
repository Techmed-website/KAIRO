import type { SubjectCode } from './types';
export const SUBJECT_NAMES: Record<SubjectCode, string> = {
  ENG: 'English', MTH: 'Mathematics', PHY: 'Physics', CHM: 'Chemistry', BIO: 'Biology',
};
export const SHORT: Record<SubjectCode, string> = { ENG: 'Eng', MTH: 'Maths', PHY: 'Phy', CHM: 'Chem', BIO: 'Bio' };
export const ELECTIVES: SubjectCode[] = ['MTH', 'PHY', 'CHM', 'BIO'];
export const subjectName = (c: string) => SUBJECT_NAMES[c as SubjectCode] ?? c;
