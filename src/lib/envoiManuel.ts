/**
 * ENVOYER À LA MAIN LES SMS J-30 / J-15 — à des patientes absentes des listes ORTHOP
 * (2026-09-23, demande du client : « qu'on puisse en rajouter plusieurs à la fois, et que
 * ça soit user friendly »).
 *
 * Trois temps, et chacun passe par le serveur :
 *
 *   1. verifier   `facturation-ajout-manuel`  — numéro, date, doublon déjà en base. N'écrit rien.
 *   2. apercu     `facturation-send-sms`       — le TEXTE EXACT, rendu par le workflow d'envoi
 *                                               lui-même (`dry_run` + `apercu_lignes`).
 *   3. ajouter    `facturation-ajout-manuel`  — insère les lignes, sans rien envoyer ;
 *      envoyer    `facturation-send-sms`       — puis envoie CES ids, par le même chemin que
 *                                               les boutons existants.
 *
 * ⚠️ Aucun texte de SMS n'est écrit ici : les modèles vivent dans `Preparer Envois` et
 * nulle part ailleurs. Un aperçu qui ne viendrait pas de lui pourrait mentir.
 * ⚠️ Rien n'est cru de la vérification : l'ajout refait tous les contrôles côté serveur.
 */
import type { Palier } from '../types';
import { parseFrDate } from './format';
import type { ResultatEnvoi } from '../views/FacturationView';

const API_BASE = 'https://n8n.srv778935.hstgr.cloud';

/** Une ligne telle que l'opératrice la saisit. `fin` au format AAAA-MM-JJ. */
export interface LigneSaisie { nom: string; prenom: string; telephone: string; fin: string }

export type StatutLigne = 'pret' | 'deja' | 'invalide';

export interface LigneVerifiee {
  idx: number;
  nom: string;
  prenom: string;
  /** Normalisé par le serveur (+33…). C'est lui qui partira. */
  telephone: string;
  fin_location: string;
  /** « Applicable du » = fin de location + 1 jour. */
  date_echeance: string | null;
  statut: StatutLigne;
  raison: string | null;
  /** Pour un J-15 : le premier avertissement est-il parti ? Décide du texte (« RAPPEL »). */
  sms1_parti: boolean;
  /**
   * La ligne déjà dans la liste pour cette patiente (même numéro, même palier, échéance à
   * ±7 jours). Avec un statut `pret`, c'est SA ligne qui partira : son SMS n'était pas
   * encore parti (2026-09-23). Sa date fait alors foi, et `date_echeance` la porte déjà.
   */
  existant?: { id: number; sms_statut: string | null; sms_le: string | null; date_echeance: string | null } | null;
}

export interface Apercu { message: string; segments: number }

type R<T> = { ok: true; data: T } | { ok: false; erreur: string };

async function poster<T>(chemin: string, token: string, corps: object, delai: number): Promise<R<T>> {
  try {
    const r = await fetch(`${API_BASE}/webhook/${chemin}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(delai),
    });
    // ⚠️ 200 à corps VIDE = la chaîne n8n est morte avant `Respond` (session expirée,
    // droits, paramètre refusé). Ce n'est jamais un succès.
    const txt = await r.text();
    if (!txt.trim()) return { ok: false, erreur: `réponse vide (HTTP ${r.status}) — session expirée, droits insuffisants, ou saisie refusée par le serveur` };
    if (!r.ok) return { ok: false, erreur: `le serveur a répondu ${r.status}` };
    const j = JSON.parse(txt);
    const un = Array.isArray(j) ? j[0] : j;
    if (!un || un.ok === false) return { ok: false, erreur: String(un?.erreur || 'refusé par le serveur') };
    return { ok: true, data: un as T };
  } catch (e) {
    const nom = e instanceof Error ? e.name : '';
    return { ok: false, erreur: nom === 'TimeoutError' ? 'délai dépassé' : 'serveur injoignable' };
  }
}

const versServeur = (l: LigneSaisie) => ({ nom: l.nom, prenom: l.prenom, telephone: l.telephone, fin_location: l.fin });

export async function verifierLignes(token: string, palier: Palier, lignes: LigneSaisie[]): Promise<R<LigneVerifiee[]>> {
  const r = await poster<{ lignes: LigneVerifiee[] }>('facturation-ajout-manuel', token,
    { action: 'verifier', palier, lignes: lignes.map(versServeur) }, 20000);
  return r.ok ? { ok: true, data: r.data.lignes } : r;
}

/**
 * La clé d'un texte : deux lignes de même clé reçoivent EXACTEMENT le même SMS (le
 * message ne contient que la date, jamais le nom).
 */
export function cleMessage(palier: Palier, l: Pick<LigneVerifiee, 'date_echeance' | 'sms1_parti'>): string {
  return palier + '|' + (palier === 'J15' && l.sms1_parti ? 'rappel' : 'premier') + '|' + l.date_echeance;
}

/**
 * Le texte exact de chaque message distinct, rendu par le workflow d'envoi.
 *
 * ⚠️ Un appel PAR MESSAGE distinct, avec une ligne représentative : le serveur ne renvoie
 * que trois aperçus par appel, et le texte ne dépend que du palier, de la date et du
 * premier avertissement. Une saisie courante n'en compte qu'un ou deux.
 */
export async function apercusMessages(token: string, palier: Palier, prets: LigneVerifiee[]): Promise<R<Map<string, Apercu>>> {
  const reps = new Map<string, LigneVerifiee>();
  for (const l of prets) { const k = cleMessage(palier, l); if (!reps.has(k)) reps.set(k, l); }
  const sortie = new Map<string, Apercu>();
  for (const [k, l] of reps) {
    const r = await poster<ResultatEnvoi>('facturation-send-sms', token, {
      dry_run: true,
      apercu_lignes: [{ palier, nom: l.nom, prenom: l.prenom, telephone: l.telephone, date_echeance: l.date_echeance, sms1_parti: l.sms1_parti }],
    }, 20000);
    if (!r.ok) return r;
    const a = r.data.apercu?.[0];
    if (!a?.message) return { ok: false, erreur: 'le serveur n’a pas rendu le texte du message' };
    sortie.set(k, { message: a.message, segments: a.segments ?? 1 });
  }
  return { ok: true, data: sortie };
}

export interface ResultatAjout {
  batch_label: string | null;
  /** `existante` : déjà dans la liste, SMS pas encore parti — c'est sa ligne qui est envoyée. */
  lignes: { idx: number; id: number | null; statut: 'ajoutee' | 'existante' | 'non_ajoutee'; raison: string | null }[];
  ids: number[];
}

export function ajouterLignes(token: string, palier: Palier, lignes: LigneSaisie[]): Promise<R<ResultatAjout>> {
  return poster<ResultatAjout>('facturation-ajout-manuel', token, { action: 'ajouter', palier, lignes: lignes.map(versServeur) }, 30000);
}

/** L'envoi réel, par le chemin des boutons existants — ids précis, jamais tout un palier. */
export function envoyerIds(token: string, ids: number[]): Promise<R<ResultatEnvoi>> {
  return poster<ResultatEnvoi>('facturation-send-sms', token, { ids }, 300000);
}

// ─────────────────────────────────────────────────────────────────────────────
// LE COPIER-COLLER DEPUIS EXCEL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transforme des lignes copiées dans Excel (ou un tableur) en lignes de saisie.
 *
 * ⚠️ L'ORDRE DES COLONNES N'EST PAS IMPOSÉ : on reconnaît le téléphone (9 chiffres au
 * moins) et la date (jj/mm/aaaa, aaaa-mm-jj, ou numéro de série Excel) à leur forme, et
 * les autres cases, dans l'ordre, deviennent le nom puis le prénom. Une ligne d'en-tête
 * (« Nom », « Téléphone »…) est ignorée. Séparateurs acceptés : tabulation (Excel) et « ; ».
 */
export function lignesDepuisCollage(texte: string): LigneSaisie[] {
  const sortie: LigneSaisie[] = [];
  for (const brute of texte.split(/\r?\n/)) {
    if (!brute.trim()) continue;
    const cases = brute.split(/\t|;/).map(c => c.trim()).filter(c => c !== '');
    if (cases.length === 0) continue;
    const chiffres = (c: string) => c.replace(/\D/g, '').length;
    const estTel = (c: string) => /^[+\d\s.\-()]+$/.test(c) && chiffres(c) >= 9 && !parseFrDate(c);
    const iTel = cases.findIndex(estTel);
    const iDate = cases.findIndex((c, i) => i !== iTel && Boolean(parseFrDate(/^\d+$/.test(c) ? Number(c) : c)));
    const textes = cases.filter((_, i) => i !== iTel && i !== iDate);
    // En-tête : aucun téléphone reconnu et des mots comme « nom » ou « téléphone ».
    if (iTel < 0 && iDate < 0 && /nom|t[ée]l[ée]phone|pr[ée]nom|date/i.test(brute)) continue;
    const date = iDate >= 0 ? parseFrDate(/^\d+$/.test(cases[iDate]) ? Number(cases[iDate]) : cases[iDate]) : '';
    sortie.push({
      nom: textes[0] ?? '', prenom: textes.slice(1).join(' '),
      telephone: iTel >= 0 ? cases[iTel] : '', fin: date,
    });
  }
  return sortie;
}
