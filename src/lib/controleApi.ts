/**
 * LE CONTRÔLE — client de `/webhook/dashboard-controle` (workflow `a90KLBtcYW5Xq1ma`).
 *
 *   traiter      consigner un geste de l'équipe de contrôle : qui, quand, commentaire
 *   traitements  les gestes déjà posés sur une journée contrôlée
 *   historique   tout ce qui a été fait à une patiente, quelle que soit sa date d'entrée
 *   sortir       arrêter toute relance vers une patiente (réversible par `reintegrer`)
 *
 * ⚠️⚠️ AUCUN CONTACT SORTANT : rien ici n'appelle une patiente, ni ne lui envoie un SMS ou
 * un mail. C'est la condition posée par le client pour l'écran de contrôle (2026-09-17).
 *
 * ⚠️ « Traité par » n'est PAS envoyé par le navigateur : le serveur le lit dans le jeton,
 * signé par W-Login. Un nom venu du corps de la requête pourrait être n'importe lequel.
 */
const API_BASE = 'https://n8n.srv778935.hstgr.cloud';

/** Un geste de l'équipe de contrôle sur une ligne de l'écran. */
export interface Traitement {
  id: number;
  relance_id: number;
  /** La JOURNÉE CONTRÔLÉE (AAAA-MM-JJ), pas le jour du clic. */
  jour: string;
  /** Code du rail affiché à l'écran au moment du geste (`R3`, `R4`…). */
  etape: string | null;
  /** Ce que l'écran demandait (`rien-tente`, `quota`…). */
  action_code: string | null;
  verif_orthop: 'recue' | 'pas_recue' | null;
  commentaire: string | null;
  traite_par: string;
  /** Horodatage TEXTE, UTC naïf — passer par `parseUtc`. */
  traite_le: string;
}

/** Une entrée de `relances.call_history`, écrite par les post-call. */
export interface EntreeAppel {
  ts: string;
  conv_id?: string | null;
  duree?: number | null;
  statut?: string | null;
  sentiment?: string | null;
  resultat?: string | null;
  transcript?: string | null;
  rail?: string | null;
}

/** Une ligne de `relance_evenements`, telle que le serveur la renvoie. */
export interface EvenementRelance {
  id: number;
  relance_id: number;
  rail: string | null;
  canal: string;
  evenement: string;
  conv_id: string | null;
  statut: string | null;
  /** Texte libre — pour `canal = 'archive'`, un objet JSON encodé. */
  detail: string | null;
  cree_le: string;
}

/**
 * Une ligne `relances` complète : ce que la liste du dashboard ne charge pas (l'historique
 * des appels, les identifiants ORTHOP) arrive ici, à la demande, pour une seule patiente.
 */
export interface LigneParcours {
  id: number;
  nom: string | null;
  prenom: string | null;
  telephone: string | null;
  email: string | null;
  date_echeance: string | null;
  statut: string | null;
  nb_tentatives: number | null;
  dernier_appel: string | null;
  importe_le: string | null;
  updated_at: string | null;
  notes: string | null;
  resultat_ia: string | null;
  sentiment: string | null;
  transcript: string | null;
  duree_sec: number | null;
  conv_id: string | null;
  batch_label: string | null;
  sms_statut: string | null;
  sms_le: string | null;
  email_statut: string | null;
  email_le: string | null;
  email_ouvert_le: string | null;
  email_clic_le: string | null;
  vocal_statut: string | null;
  echec_motif: string | null;
  dernier_echec: string | null;
  ordonnance_deja_envoyee: boolean | null;
  resolu_le: string | null;
  fin_application: string | null;
  orthop_prescription: string | null;
  orthop_dossier: string | null;
  orthop_benef: string | null;
  /** Sortie MANUELLE du parcours — horodatage texte UTC naïf, `null` si elle y est. */
  sorti_le?: string | null;
  sorti_par?: string | null;
  sorti_motif?: string | null;
  call_history: EntreeAppel[];
}

export interface HistoriquePatiente {
  lignes: LigneParcours[];
  evenements: EvenementRelance[];
  traitements: Traitement[];
}

export type Reponse<T> = { ok: true; data: T } | { ok: false; erreur: string };

async function appeler<T>(token: string, corps: object, delai = 15000): Promise<Reponse<T>> {
  try {
    const r = await fetch(`${API_BASE}/webhook/dashboard-controle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(delai),
    });
    // ⚠️ Un webhook n8n répond 200 avec un corps VIDE quand la chaîne meurt avant `Respond`
    // (jeton refusé, paramètre invalide). Un 200 n'est donc PAS une preuve de succès.
    const txt = await r.text();
    if (!txt.trim()) return { ok: false, erreur: `réponse vide (HTTP ${r.status}) — session expirée, droits insuffisants, ou erreur du serveur` };
    if (!r.ok) return { ok: false, erreur: `le serveur a répondu ${r.status}` };
    const un = JSON.parse(txt);
    if (!un || un.ok !== true) return { ok: false, erreur: String(un?.erreur || 'refusé par le serveur') };
    return { ok: true, data: un as T };
  } catch (e) {
    const nom = e instanceof Error ? e.name : '';
    return { ok: false, erreur: nom === 'TimeoutError' ? 'délai dépassé' : 'serveur injoignable' };
  }
}

export interface DemandeTraitement {
  relance_id: number;
  jour: string;
  etape: string | null;
  action_code: string | null;
  commentaire: string;
  /** Présent seulement pour une vérification ORTHOP : lève aussi la déclaration. */
  verif_orthop?: 'recue' | 'pas_recue';
}

export interface ResultatTraitement {
  traitement: Traitement;
  /** Les notes du dossier après ajout de la ligne datée — seulement pour une vérification. */
  notes: string | null;
  declaration_levee: boolean;
}

export function traiterLigne(token: string, d: DemandeTraitement) {
  return appeler<ResultatTraitement>(token, { action: 'traiter', ...d });
}

export async function traitementsDuJour(token: string, jour: string): Promise<Reponse<Traitement[]>> {
  const r = await appeler<{ traitements: Traitement[] }>(token, { action: 'traitements', jour });
  return r.ok ? { ok: true, data: r.data.traitements || [] } : r;
}

/** Ce que le serveur a écrit sur chaque dossier sorti ou remis. */
export interface LigneSortie {
  id: number;
  sorti_le: string | null;
  sorti_par: string | null;
  sorti_motif: string | null;
  notes: string | null;
}

/**
 * SORTIR UNE PATIENTE DU PARCOURS (2026-09-25) — plus aucun appel, SMS ni mail de relance,
 * automatique ou manuel. Ce n'est PAS un contact sortant : c'est l'inverse, on en arrête.
 * ⚠️ Toutes ses lignes à la fois, et le motif est obligatoire (le serveur le refuse vide).
 * ⚠️ « Sorti par » vient du jeton, comme « traité par ».
 */
export async function sortirDuParcours(token: string, ids: number[], motif: string): Promise<Reponse<LigneSortie[]>> {
  const r = await appeler<{ lignes: LigneSortie[] }>(token, { action: 'sortir', ids, motif });
  return r.ok ? { ok: true, data: r.data.lignes || [] } : r;
}

/** L'inverse : la patiente redevient appelable par les étapes qu'elle atteint. */
export async function remettreDansLeParcours(token: string, ids: number[], motif = ''): Promise<Reponse<LigneSortie[]>> {
  const r = await appeler<{ lignes: LigneSortie[] }>(token, { action: 'reintegrer', ids, motif });
  return r.ok ? { ok: true, data: r.data.lignes || [] } : r;
}

export async function historiquePatiente(token: string, ids: number[]): Promise<Reponse<HistoriquePatiente>> {
  const r = await appeler<HistoriquePatiente>(token, { action: 'historique', ids }, 20000);
  return r.ok
    ? { ok: true, data: { lignes: r.data.lignes || [], evenements: r.data.evenements || [], traitements: r.data.traitements || [] } }
    : r;
}
