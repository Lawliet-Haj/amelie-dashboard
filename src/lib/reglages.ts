/**
 * INTERRUPTEURS D'EXPLOITATION — la pause par module.
 *
 * ⚠️⚠️ CE QUE LA PAUSE COUPE, ET CE QU'ELLE NE COUPE PAS.
 * Elle arrête les **contacts sortants automatiques** du module : appels, SMS, mails lancés
 * par les crons. Elle ne touche **JAMAIS** à l'extraction ORTHOP, et c'est délibéré :
 *   • en facturation, chaque jour vise une date de fin de location différente (jour + 30 et
 *     jour + 15) — sauter une extraction ne prévient jamais les patientes concernées, et
 *     aucun rattrapage n'existe. Le trou serait définitif ;
 *   • en recouvrement, une cohorte n'est extraite qu'une seule fois, le jour de son
 *     échéance, et c'est aussi l'extraction qui relève le signal de résolution.
 * Une pause ne doit jamais détruire de donnée : elle suspend l'action, pas la collecte.
 *
 * ⚠️ Les boutons MANUELS du dashboard restent actifs pendant une pause. C'est le même
 * principe que la règle d'arrêt sur contact écrit : « un humain peut toujours décider
 * d'appeler ». La pause vise l'automate.
 */

const API_BASE = 'https://n8n.srv778935.hstgr.cloud';

/** Les modules qui portent un interrupteur. Doit rester aligné sur la table `reglages`. */
export type CleReglage = 'recouvrement' | 'facturation';

/**
 * `bool` → c'est `en_pause` qui fait foi. `nombre` / `texte` → c'est `valeur`.
 * ⚠️ Sans ce champ, un lecteur ne saurait pas laquelle des deux colonnes lire.
 */
export type TypeReglage = 'bool' | 'nombre' | 'texte';

export interface Reglage {
  cle: CleReglage | string;
  type: TypeReglage;
  /** N'a de sens que pour `type: 'bool'`. */
  en_pause: boolean;
  /** N'a de sens que pour `nombre` et `texte`. Toujours transporté en TEXTE. */
  valeur: string;
  libelle: string;
  aide: string;
  /** `null` = pas de borne. ⚠️ Ne pas remplacer par 0 : ce serait une borne réelle. */
  mini: number | null;
  maxi: number | null;
  unite: string;
  /** Périmètre : `recouvrement`, `facturation`, ou vide = réservé à l'admin. */
  module: string;
  rang: number;
  motif: string;
  modifie_par: string;
  /** Horodatage en TEXTE, tel que renvoyé par Postgres (UTC naïf) — passer par `parseUtc`. */
  modifie_le: string;
}

export interface ReponseReglages {
  ok: boolean;
  reglages: Reglage[];
  /** Renseigné quand l'appel a échoué : à afficher, jamais à avaler en silence. */
  erreur?: string;
}

async function appeler(token: string, corps: object): Promise<ReponseReglages> {
  try {
    const r = await fetch(`${API_BASE}/webhook/dashboard-reglages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(15000),
    });
    // ⚠️ Un webhook n8n répond 200 avec un corps VIDE quand la chaîne meurt avant le nœud
    // `Respond` — un jeton refusé, par exemple. Un 200 n'est donc PAS une preuve de succès.
    const txt = await r.text();
    if (!txt.trim()) {
      return { ok: false, reglages: [], erreur: `réponse vide (HTTP ${r.status}) — jeton refusé, ou erreur du workflow` };
    }
    if (!r.ok) return { ok: false, reglages: [], erreur: `le serveur a répondu ${r.status}` };
    const j = JSON.parse(txt);
    const un = Array.isArray(j) ? j[0] : j;
    if (!un || un.ok !== true || !Array.isArray(un.reglages)) {
      return { ok: false, reglages: [], erreur: 'réponse inattendue du serveur' };
    }
    return { ok: true, reglages: un.reglages as Reglage[] };
  } catch (e) {
    const nom = e instanceof Error ? e.name : '';
    return {
      ok: false, reglages: [],
      erreur: nom === 'TimeoutError' ? 'délai dépassé' : 'serveur injoignable',
    };
  }
}

export function lireReglages(token: string) {
  return appeler(token, { action: 'lire' });
}

/**
 * Bascule l'interrupteur d'un module.
 *
 * ⚠️ L'écriture est cloisonnée PAR RÔLE côté serveur : un jeton `recouvrement` reçoit un
 * 403 s'il tente de mettre la facturation en pause. Ne pas s'appuyer sur le seul masquage
 * des boutons pour garantir ce cloisonnement.
 */
export function basculerReglage(token: string, cle: CleReglage, enPause: boolean, motif = '') {
  return appeler(token, { action: 'basculer', cle, en_pause: enPause, motif });
}

/**
 * Règle la valeur d'un paramètre.
 *
 * ⚠️⚠️ UN REFUS SE LIT SUR `reglages`, PAS SUR `ok`. Les gardes vivent en SQL (périmètre du
 * rôle, type, bornes) : quand l'un d'eux bloque, la requête ne met à jour aucune ligne et
 * renvoie donc un tableau VIDE avec `ok: true`. Traiter `ok` seul comme un succès afficherait
 * une valeur qui n'est jamais entrée en base.
 */
export async function reglerReglage(
  token: string, cle: string, valeur: string,
): Promise<ReponseReglages> {
  const r = await appeler(token, { action: 'regler', cle, valeur });
  if (r.ok && r.reglages.length === 0) {
    return { ok: false, reglages: [], erreur: 'refusé : valeur hors bornes, mauvais format, ou paramètre hors de votre périmètre' };
  }
  return r;
}

/** Le périmètre d'un paramètre : ce rôle peut-il le modifier ? */
export function peutRegler(reglage: Reglage, role: string): boolean {
  if (role === 'admin') return true;
  // ⚠️ Un `module` vide est réservé à l'admin — refus par défaut, jamais élargissement.
  return reglage.module !== '' && reglage.module === role;
}
