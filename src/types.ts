export interface KPIs {
  total_week: number;
  anomalies_week: number;
  avg_duration: number;
  rappels_pending: number;
  total_today: number;
}

export interface CallByDay {
  date: string;
  total: number;
  anomalies: number;
}

export interface MotifItem     { name: string; count: number; }
export interface SentimentItem { name: string; count: number; }
export interface ActionItem    { name: string; count: number; }

export interface Rappel {
  date: string;       // "DD/MM" display
  date_full?: string; // "YYYY-MM-DD" for sorting
  heure: string;
  phone: string;
  conv_id: string;
  motif: string;
  priorite: 'URGENT' | 'NORMAL';
  statut?: 'PENDING' | 'DONE';
  transcript?: string;
  rappele_le?: string;  // "DD/MM/YYYY HH:MM" — filled by W10 on mark done
  rappele_par?: string; // nom of the user who marked it
  remarque?: string;    // optional note left by the user who called back
}

export interface RecentCall {
  date: string;       // "DD/MM" display
  date_full?: string; // "YYYY-MM-DD" for filtering/sorting
  heure: string;
  phone?: string;
  duration: number;
  motif_ia: string;
  action: string;
  sentiment: 'positif' | 'neutre' | 'negatif';
  anomalie: 'OUI' | 'NON';
  transcript?: string;
  conv_id?: string;
}

export interface AuthUser {
  token: string;
  username: string;
  nom: string;
  role: 'admin' | 'conseillere';
}

export interface DashboardUser {
  id: string;
  username: string;
  nom: string;
  email: string;
  role: 'admin' | 'conseillere';
  actif: boolean;
  created_at: string;
  last_login: string;
}

export interface DashboardData {
  kpis: KPIs;
  calls_by_day: CallByDay[];
  motifs: MotifItem[];
  sentiment: SentimentItem[];
  actions: ActionItem[];
  rappels: Rappel[];
  recent_calls: RecentCall[];
}
