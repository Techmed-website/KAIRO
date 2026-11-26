import type { SubjectCode } from '../../lib/types';
import { IcAtom, IcDna, IcFlask, IcLanguage, IcSigma } from '../../ui/icons';

export const SUBJECT_ICONS: Record<SubjectCode, typeof IcAtom> = { ENG: IcLanguage, MTH: IcSigma, PHY: IcAtom, CHM: IcFlask, BIO: IcDna };
