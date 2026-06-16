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
  role: 'admin' | 'conseillere' | 'recouvrement';
}

export interface DashboardUser {
  id: string;
  username: string;
  nom: string;
  email: string;
  role: 'admin' | 'conseillere' | 'recouvrement';
  actif: boolean;
  created_at: string;
  last_login: string;
}

export interface Relance {
  id: number;
  nom: string | null;
  prenom?: string | null;             // optional first name (split from nom if absent)
  telephone: string | null;
  date_echeance: string | null;
  date_debut_location?: string | null; // date de début de location (YYYY-MM-DD)
  statut: 'À appeler' | 'Non répondu' | 'Répondeur' | 'Répondu SMS' | 'Répondu transfert';
  nb_tentatives: number;
  dernier_appel: string | null;
  resultat: string | null;
  conv_id: string | null;
  importe_le: string | null;
  notes: string | null;
  updated_at: string | null;
  // Post-call enrichment (populated by W3 outbound branch)
  transcript?: string | null;
  duree_sec?: number | null;
  sentiment?: string | null;
  resultat_ia?: string | null;
  // Batch / campaign tracking
  batch_id?: string | null;
  batch_label?: string | null;
  // SMS failure flag (set by W8 when Brevo delivery fails for an outbound SMS)
  sms_echec?: boolean | null;
}

export interface BatchGroup {
  batch_id: string;
  batch_label: string | null;
  date_import: string;
  total: number;
  repondu_sms: number;
  repondu_transfert: number;
  repondeur: number;
  non_repondu: number;
  a_appeler: number;
}

export interface RelancesStats {
  total: number;
  a_appeler: number;
  non_repondu: number;
  repondeur: number;
  repondu_sms: number;
  repondu_transfert: number;
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
