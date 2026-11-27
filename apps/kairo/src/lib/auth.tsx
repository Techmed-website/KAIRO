import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { cbt, supabase } from './supabase';
import { track } from './analytics';
import type { SubjectCode } from './types';

export interface Profile {
  id: string; full_name: string; email: string | null; phone: string | null;
  exam_year: number | null; subjects: number[]; track: string | null; role?: 'student' | 'editor' | 'admin';
}
interface AuthState {
  session: Session | null; profile: Profile | null; loading: boolean;
  subjectCodes: SubjectCode[]; refreshProfile: () => Promise<void>;
  recovery: boolean; endRecovery: () => void;
  saveProfile: (p: Partial<Pick<Profile, 'full_name' | 'phone' | 'exam_year' | 'track'>> & { subjectCodes?: SubjectCode[] }) => Promise<void>;
}
const Ctx = createContext<AuthState>(null as never);
export const useAuth = () => useContext(Ctx);

let subjectIds: Record<string, number> | null = null;
async function subjectMap() {
  if (subjectIds) return subjectIds;
  const { data } = await cbt().from('subjects').select('id,code');
  subjectIds = Object.fromEntries((data ?? []).map((r: { id: number; code: string }) => [r.code, r.id]));
  return subjectIds;
}

const PROFILE_KEY = 'kairo-profile';
const cachedProfile = (): Profile | null => { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch { return null; } };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(cachedProfile);
  const [codes, setCodes] = useState<SubjectCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);

  const loadProfile = async (s: Session | null) => {
    if (!s) { setProfile(null); return; }
    try {
      const name = (s.user.user_metadata?.full_name || s.user.user_metadata?.name || '') as string;
      const { data, error } = await cbt().rpc('ensure_profile', { p_full_name: name || null });
      if (error) throw error;
      const p = data as Profile;
      setProfile(p);
      try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
      const m = await subjectMap();
      const byId = Object.fromEntries(Object.entries(m).map(([c, id]) => [id, c]));
      setCodes((p.subjects ?? []).map((id) => byId[id] as SubjectCode).filter(Boolean));
    } catch { /* offline: keep the cached profile */ }
  };

  // A guest who becomes a real account keeps the same user id: remember the guest id so the switch is counted once.
  const noteGuest = (s: Session | null) => {
    try {
      if (!s) return;
      if (s.user.is_anonymous) { localStorage.setItem('kairo-guest-uid', s.user.id); return; }
      if (localStorage.getItem('kairo-guest-uid') === s.user.id) { localStorage.removeItem('kairo-guest-uid'); track('guest_converted'); }
    } catch { /* storage blocked */ }
  };

  useEffect(() => {
    let lastUid: string | undefined;
    supabase.auth.getSession().then(async ({ data }) => {
      lastUid = data.session?.user.id;
      noteGuest(data.session);
      setSession(data.session);
      setLoading(false);
      loadProfile(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evt, s) => {
      noteGuest(s);
      setSession(s);
      if (evt === 'PASSWORD_RECOVERY') setRecovery(true); // came back from a "reset password" email
      if (evt === 'SIGNED_IN' || evt === 'SIGNED_OUT') loadProfile(s);
      // A real sign-in (not a token refresh or the same user coming back to the tab), never for guests.
      if (evt === 'SIGNED_IN' && s && s.user.id !== lastUid && !s.user.is_anonymous) track('user_login');
      if (evt === 'SIGNED_IN' || evt === 'SIGNED_OUT') lastUid = s?.user.id;
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!profile || codes.length) return;
    subjectMap().then((m) => {
      const byId = Object.fromEntries(Object.entries(m).map(([c, id]) => [id, c]));
      setCodes((profile.subjects ?? []).map((id) => byId[id] as SubjectCode).filter(Boolean));
    }).catch(() => {});
  }, [profile, codes.length]);

  const saveProfile: AuthState['saveProfile'] = async ({ subjectCodes, ...rest }) => {
    if (!session) return;
    const patch: Record<string, unknown> = { ...rest };
    if (subjectCodes) {
      const m = await subjectMap();
      patch.subjects = subjectCodes.map((c) => m[c]).filter(Boolean);
    }
    const { data, error } = await cbt().from('profiles').update(patch).eq('id', session.user.id).select().single();
    if (error) throw error;
    setProfile(data as Profile);
    if (subjectCodes) setCodes(subjectCodes);
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  };

  return (
    <Ctx.Provider value={{ session, profile, loading, subjectCodes: codes, refreshProfile: () => loadProfile(session), saveProfile, recovery, endRecovery: () => setRecovery(false) }}>
      {children}
    </Ctx.Provider>
  );
}
