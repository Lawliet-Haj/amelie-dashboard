/**
 * TESTER UN RAIL — client de `/webhook/rail-test`.
 *
 * Avant, « tester un rail » voulait dire : réactiver dans n8n un déclencheur manuel
 * dépourvu d'authentification, y poster `{"phase":"appels","dry_run":true}`, puis penser à
 * le redésactiver. Et les rails pas encore en service n'étaient pas testables du tout.
 *
 * Trois questions, trois actions :
 *
 *   selection   qui serait appelé sur cette étape — et **pourquoi pas les autres**
 *   appel_test  un appel réel avec l'agent du rail, vers VOTRE numéro
 *   transcript  l'agent a-t-il dit tout le message, ou seulement l'accueil ?
 *
 * ⚠️⚠️ POURQUOI UN APPEL DE TEST N'ÉCRIT RIEN — propriété vérifiée dans les workflows, pas
 * supposée. Un appel de test porte un `conv_id` qui ne correspond à AUCUNE ligne
 * `relances` ; or les deux post-call s'arrêtent d'eux-mêmes dans ce cas :
 *   • rail J+7 : `relance_id = 0` → les nœuds SMS et journal renvoient `[]` ;
 *   • rail J+1 : le CTE renvoie `telephone = ''` et `email = ''` → les nœuds SMS et mail
 *     renvoient `[]` (téléphone vide, adresse invalide).
 * Donc aucun SMS, aucun mail, aucun statut, aucun journal — mais le prompt, le premier
 * message, la détection répondeur, le routage du post-call et l'analyse GPT sont bien
 * exercés. C'est exactement ce qu'on veut éprouver.
 *
 * ⚠️ Le serveur REFUSE un numéro déjà présent dans `relances` (comparaison sur les neuf
 * derniers chiffres, les formats étant mélangés en base). On ne peut donc pas « tester »
 * sur une patiente par distraction.
 *
 * ⚠️⚠️ L'ÉCART EST ENVOYÉ PAR NOUS, ET C'EST VOLONTAIRE. Le seul endroit qui sait qu'un
 * rail J+N tire sur `date_echeance + (N − 1)` est `ecartEcheance()` dans `rails.ts`. Le
 * serveur n'en garde aucune copie : il applique l'écart reçu et **renvoie la date qu'il a
 * réellement interrogée**, que l'appelant peut alors recouper. Une quatrième copie de
 * cette table serait une divergence de plus à entretenir.
 */

const API_BASE = 'https://n8n.srv778935.hstgr.cloud';

/** Le jugement porté sur une ligne : `appelable`, ou la PREMIÈRE raison qui bloque. */
export interface LigneJugee {
  id: number;
  nom: string;
  prenom: string;
  telephone: string;
  statut: string;
  nb_tentatives: number;
  sms_statut: string;
  email_statut: string;
  /** Horodatage TEXTE tel que renvoyé par Postgres (UTC naïf) — passer par `parseUtc`. */
  dernier_appel: string | null;
  suivi_orthop: boolean;
  verdict: string;
}

export interface Selection {
  rail: string | null;
  ecart: number;
  /** La date que le SERVEUR a interrogée. À recouper avec sa propre prévision. */
  date_visee: string;
  /**
   * ⚠️ `sur_etape` INCLUT les dossiers résolus — comme `dansLeRail` dans `rails.ts`, et
   * pour la même raison : un rail décrit une population, pas une file de travail.
   */
  sur_etape: number;
  /** Encore dans le parcours : ordonnance non renouvelée. */
  actifs: number;
  appelables: number;
  /** ⚠️ Ce que le cron prendrait au PROCHAIN PASSAGE : le `LIMIT` est un débit. */
  au_prochain_passage: number;
  reglages: { plafond_tentatives: number; delai_rappel_minutes: number; appels_par_passage: number };
  pause: { en_pause: boolean; motif: string };
  par_verdict: { verdict: string; n: number }[];
  lignes: LigneJugee[];
  tronque: boolean;
}

export interface AppelTest {
  refuse?: boolean;
  rail: string;
  agent?: string;
  telephone: string;
  date_echeance_annoncee?: string;
  conversation_id: string | null;
  /** Les dossiers qui portent ce numéro, quand le garde-fou refuse. */
  dossiers?: { id: number; qui: string; echeance: string }[];
  sans_effet?: string;
  suite?: string | null;
}

export interface TranscriptTest {
  conv_id: string;
  statut_el: string | null;
  duree_sec: number;
  raison_fin: string | null;
  detection_repondeur: boolean;
  tours_agent: number;
  tours_interlocuteur: number;
  premiere_parole: string | null;
  /** LE symptôme à guetter sur le rail J+7 : la patiente n'a entendu que l'accueil. */
  accueil_seul: boolean;
  message_principal_detecte: boolean;
  reperes_trouves: string;
  verdict_test: string;
  transcript: { qui: string; texte: string }[];
  note: string;
}

export type Reponse<T> = { ok: true; data: T } | { ok: false; erreur: string };

async function appeler<T>(token: string, corps: object, delai = 30000): Promise<Reponse<T>> {
  try {
    const r = await fetch(`${API_BASE}/webhook/rail-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(delai),
    });
    // ⚠️ Un webhook n8n répond 200 avec un corps VIDE quand la chaîne meurt avant le nœud
    // `Respond` — jeton refusé, écart hors bornes, action inconnue. Un 200 n'est donc PAS
    // une preuve de succès, et c'est le piège qui a déjà fait passer cinq journées de
    // pannes pour un fonctionnement normal.
    const txt = await r.text();
    if (!txt.trim()) {
      return { ok: false, erreur: `réponse vide (HTTP ${r.status}) — jeton refusé, paramètre invalide, ou erreur du workflow` };
    }
    if (!r.ok) return { ok: false, erreur: `le serveur a répondu ${r.status}` };
    const j = JSON.parse(txt);
    const un = Array.isArray(j) ? j[0] : j;
    if (!un) return { ok: false, erreur: 'réponse inattendue du serveur' };
    // Les refus MÉTIER arrivent en `ok: false` AVEC une explication — ils passent
    // volontairement par `Respond`, et non par une exception, pour que la raison atteigne
    // l'écran au lieu de finir dans les journaux n8n.
    if (un.ok !== true) return { ok: false, erreur: String(un.erreur || 'refusé par le serveur'), ...(un as object) } as Reponse<T>;
    return { ok: true, data: un as T };
  } catch (e) {
    const nom = e instanceof Error ? e.name : '';
    return { ok: false, erreur: nom === 'TimeoutError' ? 'délai dépassé' : 'serveur injoignable' };
  }
}

/**
 * Qui serait appelé sur l'étape, et pourquoi pas les autres. Lecture seule.
 *
 * `ecart` vient de `ecartEcheance(rail)` — jamais de `rail.jour` nu.
 */
export function selectionRail(token: string, rail: string, ecart: number) {
  return appeler<Selection>(token, { action: 'selection', rail, ecart });
}

/**
 * Passe UN appel réel avec l'agent du rail, vers le numéro fourni.
 *
 * ⚠️ `confirme: true` est exigé par le serveur : un appel de test compose un vrai numéro.
 * ⚠️ Le serveur refuse un numéro présent dans `relances` (voir l'en-tête du fichier).
 */
export function appelTestRail(
  token: string, rail: string, ecart: number, telephone: string,
  prenom?: string, nom?: string,
) {
  return appeler<AppelTest>(
    token,
    { action: 'appel_test', rail, ecart, telephone, prenom, nom, confirme: true },
    60000,
  );
}

/**
 * Relit la conversation chez ElevenLabs.
 *
 * ⚠️ Elle n'existe qu'une fois l'appel **terminé et analysé** : compter quelques dizaines
 * de secondes. Un échec ici n'est donc pas forcément une panne.
 *
 * ⚠️ Les indicateurs renvoyés sont propres au TEST. Le statut de production
 * (`Répondeur` / `Répondu SMS` / `Raccroché`) est calculé par le post-call et **n'est pas
 * recalculé ici** : une copie divergerait, et rendrait le test menteur.
 */
export function transcriptTest(token: string, convId: string) {
  return appeler<TranscriptTest>(token, { action: 'transcript', conv_id: convId });
}
