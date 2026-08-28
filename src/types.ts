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
  role: 'admin' | 'conseillere' | 'recouvrement' | 'facturation';
}

export interface DashboardUser {
  id: string;
  username: string;
  nom: string;
  email: string;
  role: 'admin' | 'conseillere' | 'recouvrement' | 'facturation';
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
  // « Raccroché » = quelqu'un a décroché puis coupé pendant l'annonce, sans parler.
  // Distinct de « Répondeur » : le transcript est identique, seul termination_reason
  // (ElevenLabs) permet de trancher — c'est W3 qui l'applique de façon déterministe.
  statut: 'À appeler' | 'Non répondu' | 'Répondeur' | 'Raccroché' | 'Répondu SMS' | 'Répondu transfert';
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
  // Suivi d'envoi du SMS ordonnance :
  //   'envoye'      → W3 : Brevo a accepté l'envoi (messageId reçu), en attente du rapport
  //   'echec_envoi' → W3 : l'appel API Brevo a échoué (aucun messageId)
  //   'livre'       → W8 : Brevo confirme la livraison
  //   'echec'       → W8 : bounce / rejet
  //   null          → aucun SMS tenté (fixe, statut non éligible) OU panne silencieuse d'envoi
  sms_statut?: 'envoye' | 'echec_envoi' | 'livre' | 'echec' | null;
  sms_le?: string | null;
  // Email de relance ordonnance (colonne « Email » de l'export ORTHOP)
  email?: string | null;
  // Progression, alimentée par W3 à l'envoi puis par W19 (événements Brevo) :
  // envoye → livre → ouvert → clique. Un événement ne fait jamais régresser l'état.
  email_statut?: 'envoye' | 'echec_envoi' | 'livre' | 'ouvert' | 'clique' | 'echec' | null;
  email_le?: string | null;
  email_ouvert_le?: string | null;
  email_clic_le?: string | null;
  // Dernier lien cliqué — distingue « envoie son ordonnance » de « veut rendre le matériel »
  email_clic_url?: string | null;
  // Le message vocal a-t-il réellement été déposé sur la messagerie ?
  //   'depose_el'      → ElevenLabs a joué son champ voicemail_message (détection réussie)
  //   'depose_agent'   → Amélie a récité le message après l'annonce
  //   'non_applicable' → serveur de filtrage : aucun message n'est attendu
  //   'non_depose'     → ⚠️ messagerie atteinte et AUCUN message laissé
  //   null             → l'appel n'est pas tombé sur une messagerie
  vocal_statut?: 'depose_el' | 'depose_agent' | 'non_applicable' | 'non_depose' | null;
  // Call failure tracking — W12 sets 'Échec déclenchement' on trigger failure, W3 sets 'Appel échoué' on technical call failure; cleared on success
  echec_motif?: string | null;
  dernier_echec?: string | null;
  // Patiente a signalé pendant l'appel avoir déjà envoyé son ordonnance (détecté par W3) — à vérifier
  ordonnance_deja_envoyee?: boolean | null;
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

// ─── Facturation : relances préventives par SMS avant échéance ────────────────
// Table PostgreSQL `facturation`, volontairement DISTINCTE de `relances` : l'index unique
// de `relances` porte sur `orthop_prescription` seul, donc y insérer un palier J-30
// bloquerait ensuite le J-15 ET l'extraction recouvrement du jour J, en silence.
// Ici la clé de déduplication est (orthop_prescription, palier).

/** J-30 et J-15 sont deux paliers distincts : le message envoyé n'est pas le même. */
export type Palier = 'J30' | 'J15';

export interface Facturation {
  id: number;
  palier: Palier;
  nom: string | null;
  prenom: string | null;
  telephone: string | null;
  email: string | null;
  /** « Applicable du » visée par le palier — la date d'échéance de l'ordonnance. */
  date_echeance: string | null;
  /** Suivi d'envoi. NULL pour l'instant : l'envoi de SMS n'est pas encore branché. */
  sms_statut?: 'envoye' | 'echec_envoi' | 'livre' | 'echec' | null;
  sms_le?: string | null;
  sms_message_id?: string | null;
  batch_id?: string | null;
  batch_label?: string | null;
  orthop_prescription?: string | null;
  orthop_dossier?: string | null;
  orthop_benef?: string | null;
  importe_le?: string | null;
  updated_at?: string | null;
}

export interface PalierStats {
  total: number;
  a_envoyer: number;
  envoye: number;
  livre: number;
  echec: number;
}

export interface FacturationStats extends PalierStats {
  j30: PalierStats;
  j15: PalierStats;
}

/** Un lot = une extraction (équivalent des campagnes du recouvrement). */
export interface FacturationLot extends PalierStats {
  batch_id: string;
  batch_label: string | null;
  palier: Palier;
  date_echeance: string | null;
  date_import: string;
}

export interface FacturationData {
  ok: boolean;
  facturations: Facturation[];
  stats: FacturationStats;
  lots: FacturationLot[];
}
