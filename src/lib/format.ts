/**
 * Helpers de formatage et de normalisation partagés par les vues.
 *
 * Extraits de RecouvrementView le 2026-08-27, à l'arrivée de la vue Facturation :
 * dupliquer la logique de fuseau horaire aurait été le meilleur moyen de voir les deux
 * copies diverger. Tout ce qui touche aux dates vit ici, et nulle part ailleurs.
 */

export const TZ = 'Europe/Paris';

/**
 * Interprète un horodatage venu de PostgreSQL comme de l'UTC.
 *
 * ⚠️ La base tourne en UTC (`SHOW timezone` = UTC) et les colonnes sont des `TIMESTAMP`
 * SANS fuseau : l'API renvoie donc « 2026-08-27 10:31:00 », qui est de l'heure UTC.
 * Or JavaScript parse cette forme comme une heure LOCALE — l'écran affichait donc deux
 * heures de retard en été. On force l'interprétation en UTC, le rendu se faisant ensuite
 * explicitement en heure de Paris.
 */
export function parseUtc(s: string | null | undefined): Date | null {
  if (!s) return null;
  let v = String(s).trim();
  const aDejaUnFuseau = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(v);
  if (!aDejaUnFuseau) v = v.replace(' ', 'T') + 'Z';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date seule (colonne DATE, sans heure) : aucune conversion de fuseau à faire. */
export function formatDate(s: string | null) {
  if (!s) return '—';
  const d = new Date(String(s).slice(0, 10) + 'T12:00:00Z');   // midi UTC : jamais de bascule de jour
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ });
}

/** Date seule en version longue : « samedi 26 septembre 2026 ». */
export function formatDateLongue(s: string | null) {
  if (!s) return '—';
  const d = new Date(String(s).slice(0, 10) + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
}

/** Horodatage complet, rendu en heure de Paris. */
export function formatDateTime(s: string | null) {
  if (!s) return '—';
  const d = parseUtc(s);
  if (!d) return s;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: TZ })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export function formatDuration(sec: number | null | undefined) {
  if (!sec || sec === 0) return '—';
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m${sec % 60 > 0 ? String(sec % 60).padStart(2, '0') + 's' : ''}`;
}

/**
 * Jour PARISIEN d'un horodatage UTC, au format YYYY-MM-DD — comparable à un <input type="date">.
 * Le fuseau compte ici : un appel à 23h30 heure de Paris est stocké 21h30 UTC, mais
 * appartient bien au jour parisien courant.
 */
export function jourLocal(s: string | null | undefined): string {
  const d = parseUtc(s);
  return d ? d.toLocaleDateString('sv-SE', { timeZone: TZ }) : '';
}

/** Aujourd'hui, jour parisien, au format YYYY-MM-DD. */
export function aujourdhuiIso(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

/**
 * Décale une date ISO (YYYY-MM-DD) d'un nombre de jours calendaires.
 *
 * ⚠️ On repart de MIDI UTC pour ne jamais basculer de jour au passage : partir de minuit
 * fait franchir la frontière du jour dès que le fuseau local est à l'ouest de Greenwich.
 * C'est le même calcul que celui appliqué côté n8n (`Auth + Params`) — les deux doivent
 * donner le même résultat, sinon l'écran annonce une échéance différente de l'extraction.
 */
export function decalerJours(iso: string, jours: number): string {
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().substring(0, 10);
}

export function isEcheancePassed(s: string | null) {
  if (!s) return false;
  try { return new Date(s + 'T00:00:00') < new Date(); } catch { return false; }
}

/** Normalise un numéro français au format E.164 +33XXXXXXXXX */
export function normalizePhoneFr(v: string | null | undefined): string {
  if (v === null || v === undefined) return '';
  let p = String(v).replace(/[\s.\-()]/g, '').trim();
  if (!p) return '';
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return '+' + p.slice(2);
  if (p.startsWith('0')) return '+33' + p.slice(1);
  if (p.startsWith('33') && p.length >= 11) return '+' + p;
  return '+33' + p;
}

/** Nettoie une adresse email (l'export ORTHOP les écrit souvent en MAJUSCULES). Renvoie '' si invalide. */
export function normalizeEmail(v: string | null | undefined): string {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : '';
}

/** Met un nom tout en majuscules en casse de titre : "MEZOUAR-CHABANE" → "Mezouar-Chabane" */
export function titleCaseName(s: string): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(^|[\s'’.\-])([a-zà-ÿ])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

/** Convertit une date FR (Date, sérial Excel, "DD/MM/YYYY", "DD-MM-YYYY") en ISO "YYYY-MM-DD" pour <input type=date>. */
export function parseFrDate(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  // ⚠️ Ne PAS utiliser toISOString() directement : la conversion de sérial Excel par la lib
  // renvoie parfois 23:59:39 la veille (arrondi) — le 22/08 devenait 21/08. On arrondit donc
  // l'heure locale au jour le plus proche, ce qui absorbe aussi le décalage de fuseau.
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    const localMs = v.getTime() - v.getTimezoneOffset() * 60000;
    return new Date(Math.round(localMs / 86400000) * 86400000).toISOString().substring(0, 10);
  }
  // Sérial Excel brut (si la cellule n'est pas formatée en date) : 25569 = 1970-01-01.
  // Plage 20000–60000 ≈ 1954–2064 : évite de transformer un nombre quelconque en date absurde.
  if (typeof v === 'number' && Number.isFinite(v) && v >= 20000 && v <= 60000) {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().substring(0, 10);
  }
  const s = String(v).trim();
  const fr = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (fr) {
    let [, d, mo, y] = fr;
    if (y.length === 2) y = '20' + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return '';
}

/** Numéro fixe français (01-05, 09) — ne peut pas recevoir de SMS */
export function isFixe(tel: string | null | undefined): boolean {
  if (!tel) return false;
  let t = String(tel).replace(/[\s.\-()]/g, '');
  if (t.startsWith('+33')) t = '0' + t.slice(3);
  else if (t.startsWith('0033')) t = '0' + t.slice(4);
  return /^0[1-59]/.test(t);
}
