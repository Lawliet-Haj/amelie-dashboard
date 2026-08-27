import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { read, utils } from 'xlsx';
import {
  Upload, RefreshCw, Edit2, X, CheckCircle, FileText, AlertCircle,
  Phone, TrendingUp, PhoneCall, CheckSquare, Trash2, Download,
  MessageSquare, History, Play, Pause, ChevronRight,
  UserCheck, PhoneOff, ChevronLeft, Layers, Voicemail, ArrowRightCircle, CloudDownload, Send,
} from 'lucide-react';
import type { AuthUser, Relance, RelancesStats, BatchGroup } from '../types';

const API_BASE = 'https://n8n.srv778935.hstgr.cloud';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const BATCH_NOTES_KEY = 'amelie_batch_notes';

// ─── Batch notes (localStorage per batch_id) ─────────────────────────────────
function loadBatchNote(batch_id: string): string {
  try { return JSON.parse(localStorage.getItem(BATCH_NOTES_KEY) || '{}')[batch_id] || ''; } catch { return ''; }
}
function saveBatchNote(batch_id: string, note: string) {
  try { const m = JSON.parse(localStorage.getItem(BATCH_NOTES_KEY) || '{}'); m[batch_id] = note; localStorage.setItem(BATCH_NOTES_KEY, JSON.stringify(m)); } catch { /* noop */ }
}

/**
 * Rend les overlays (modals, panneaux latéraux) directement dans <body>.
 *
 * ⚠️ NE PAS retirer. Un élément `position: fixed` n'est PAS positionné par rapport à la
 * fenêtre dès qu'un ancêtre porte un `transform`, un `filter` ou un `will-change` : cet
 * ancêtre devient son bloc conteneur. Les vues sont enveloppées dans `.animate-fade-up`
 * (animation `fadeUp`, qui manipule `transform`), et le conteneur de scroll est `<main>` :
 * les modals et panneaux se retrouvaient donc positionnés par rapport au haut de la liste
 * et non de l'écran — invisibles sans scroller dès que la liste était longue.
 * Le portail supprime le problème à la racine, quel que soit le style des ancêtres.
 */
function Portal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body);
}

// ─── Status config ────────────────────────────────────────────────────────────
const STATUT_CONFIG: Record<string, { color: string; bg: string; hex: string; stripe: string }> = {
  'À appeler':         { color: '#1d4ed8', bg: '#eff6ff', hex: '#3b82f6', stripe: '#bfdbfe' },
  'Non répondu':       { color: '#92400e', bg: '#fffbeb', hex: '#f59e0b', stripe: '#fde68a' },
  'Répondeur':         { color: '#5b21b6', bg: '#f5f3ff', hex: '#8b5cf6', stripe: '#c4b5fd' },
  // A décroché puis coupé sans parler : joignable, mais n'a pas entendu le message.
  'Raccroché':         { color: '#9f1239', bg: '#fff1f2', hex: '#f43f5e', stripe: '#fda4af' },
  'Répondu SMS':       { color: '#065f46', bg: '#ecfdf5', hex: '#10b981', stripe: '#6ee7b7' },
  'Répondu transfert': { color: '#0e7490', bg: '#ecfeff', hex: '#06b6d4', stripe: '#a5f3fc' },
};

const SENTIMENT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  positif: { label: '😊 Positif', color: '#15803d', bg: '#dcfce7' },
  neutre:  { label: '😐 Neutre',  color: '#d97706', bg: '#fef3c7' },
  negatif: { label: '😞 Négatif', color: '#dc2626', bg: '#fef2f2' },
};

// ─── Utility ──────────────────────────────────────────────────────────────────
function priorityScore(r: Relance): number {
  if (r.statut === 'Répondu SMS' || r.statut === 'Répondu transfert') return 0;
  let s = r.statut === 'À appeler' ? 4 : r.statut === 'Non répondu' ? 3 : 2; // Répondeur = 2
  if (r.date_echeance && new Date(r.date_echeance + 'T00:00:00') < new Date()) s += 5;
  if (r.nb_tentatives === 0) s += 3;
  if (r.nb_tentatives >= 3) s -= 2;
  return Math.max(0, s);
}

const TZ = 'Europe/Paris';

/**
 * Interprète un horodatage venu de PostgreSQL comme de l'UTC.
 *
 * ⚠️ La base tourne en UTC (`SHOW timezone` = UTC) et les colonnes sont des `TIMESTAMP`
 * SANS fuseau : l'API renvoie donc « 2026-08-27 10:31:00 », qui est de l'heure UTC.
 * Or JavaScript parse cette forme comme une heure LOCALE — l'écran affichait donc deux
 * heures de retard en été. On force l'interprétation en UTC, le rendu se faisant ensuite
 * explicitement en heure de Paris.
 */
function parseUtc(s: string | null | undefined): Date | null {
  if (!s) return null;
  let v = String(s).trim();
  const aDejaUnFuseau = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(v);
  if (!aDejaUnFuseau) v = v.replace(' ', 'T') + 'Z';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date seule (colonne DATE, sans heure) : aucune conversion de fuseau à faire. */
function formatDate(s: string | null) {
  if (!s) return '—';
  const d = new Date(String(s).slice(0, 10) + 'T12:00:00Z');   // midi UTC : jamais de bascule de jour
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ });
}

/** Horodatage complet, rendu en heure de Paris. */
function formatDateTime(s: string | null) {
  if (!s) return '—';
  const d = parseUtc(s);
  if (!d) return s;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: TZ })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

function formatDuration(sec: number | null | undefined) {
  if (!sec || sec === 0) return '—';
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m${sec % 60 > 0 ? String(sec % 60).padStart(2, '0') + 's' : ''}`;
}


/**
 * Jour PARISIEN d'un horodatage UTC, au format YYYY-MM-DD — comparable à un <input type="date">.
 * Le fuseau compte ici : un appel à 23h30 heure de Paris est stocké 21h30 UTC, mais
 * appartient bien au jour parisien courant.
 */
function jourLocal(s: string | null | undefined): string {
  const d = parseUtc(s);
  return d ? d.toLocaleDateString('sv-SE', { timeZone: TZ }) : '';
}

function isEcheancePassed(s: string | null) {
  if (!s) return false;
  try { return new Date(s + 'T00:00:00') < new Date(); } catch { return false; }
}

/** Normalise un numéro français au format E.164 +33XXXXXXXXX */
function normalizePhoneFr(v: string | null | undefined): string {
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
function normalizeEmail(v: string | null | undefined): string {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : '';
}

/** Met un nom tout en majuscules en casse de titre : "MEZOUAR-CHABANE" → "Mezouar-Chabane" */
function titleCaseName(s: string): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(^|[\s'’.\-])([a-zà-ÿ])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

/** Convertit une date FR (Date, sérial Excel, "DD/MM/YYYY", "DD-MM-YYYY") en ISO "YYYY-MM-DD" pour <input type=date>. */
function parseFrDate(v: unknown): string {
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
function isFixe(tel: string | null | undefined): boolean {
  if (!tel) return false;
  let t = String(tel).replace(/[\s.\-()]/g, '');
  if (t.startsWith('+33')) t = '0' + t.slice(3);
  else if (t.startsWith('0033')) t = '0' + t.slice(4);
  return /^0[1-59]/.test(t);
}

/**
 * État d'acheminement du SMS ordonnance.
 * Source : relances.sms_statut (écrit par W3 à l'envoi, par W8 sur rapport Brevo).
 * « aucun » est volontairement visible : c'est le cas d'une panne silencieuse d'envoi.
 */
type SmsEtat = 'livre' | 'envoye' | 'echec' | 'fixe' | 'aucun' | 'na';

const SMS_ETAT_CONFIG: Record<SmsEtat, { label: string; bg: string; color: string; border: string; title: string }> = {
  livre:  { label: 'SMS livré',       bg: '#ecfdf5',     color: '#047857', border: '#a7f3d0',     title: 'Brevo confirme la livraison du SMS' },
  envoye: { label: 'SMS envoyé',      bg: '#eff6ff',     color: '#1d4ed8', border: '#bfdbfe',     title: 'Brevo a accepté l’envoi — en attente du rapport de livraison' },
  echec:  { label: 'SMS non livré',   bg: '#fef2f2',     color: '#b91c1c', border: '#fecaca',     title: 'Le SMS n’est pas arrivé (bounce, rejet, ou échec d’envoi)' },
  fixe:   { label: 'Fixe · sans SMS', bg: '#f1f5f9',     color: '#475569', border: '#cbd5e1',     title: 'Numéro fixe : aucun SMS n’est envoyé' },
  aucun:  { label: 'Aucun SMS ⚠',     bg: '#fffbeb',     color: '#b45309', border: '#fde68a',     title: 'Un SMS était attendu mais aucun envoi n’a été enregistré — à vérifier' },
  na:     { label: '—',               bg: 'transparent', color: '#94a3b8', border: 'transparent', title: 'Aucun SMS attendu à ce stade' },
};

function smsEtat(r: Relance): SmsEtat {
  const s = String(r.sms_statut || '').toLowerCase();
  if (s === 'livre') return 'livre';
  if (s === 'echec' || s === 'echec_envoi') return 'echec';
  if (s === 'envoye') return 'envoye';
  if (r.sms_echec) return 'echec';                                    // lignes antérieures à sms_statut
  if (isFixe(r.telephone)) return 'fixe';
  // Un SMS était dû (patiente atteinte, messagerie, ou raccrochage) mais rien n'a été
  // tracé → anomalie à rendre visible. Mêmes statuts que la condition d'envoi de W3.
  if (r.statut === 'Répondu SMS' || r.statut === 'Répondeur' || r.statut === 'Raccroché') return 'aucun';
  return 'na';
}

function SmsChip({ r }: { r: Relance }) {
  const etat = smsEtat(r);
  const c = SMS_ETAT_CONFIG[etat];
  if (etat === 'na') return <span style={{ color: c.color, fontSize: 12 }}>{c.label}</span>;
  return (
    <span
      title={r.sms_le ? `${c.title} — ${formatDateTime(r.sms_le)}` : c.title}
      style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: c.bg, color: c.color, border: `1px solid ${c.border}`, whiteSpace: 'nowrap' }}
    >
      {c.label}
    </span>
  );
}

/**
 * État du mail de relance (template Brevo 353). Progression écrite par W3 à l'envoi
 * puis par W19 sur les événements Brevo : envoyé → livré → ouvert → cliqué.
 * Rien n'est affiché si la relance n'a pas d'adresse email.
 */
const MAIL_ETAT_CONFIG: Record<string, { label: string; bg: string; color: string; border: string; title: string }> = {
  clique:      { label: 'Mail cliqué',    bg: '#dcfce7', color: '#15803d', border: '#86efac', title: 'La patiente a cliqué un lien du mail' },
  ouvert:      { label: 'Mail ouvert',    bg: '#ecfdf5', color: '#047857', border: '#a7f3d0', title: 'Le mail a été ouvert, sans clic pour l’instant' },
  livre:       { label: 'Mail livré',     bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe', title: 'Mail arrivé dans la boîte, pas encore ouvert' },
  envoye:      { label: 'Mail envoyé',    bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', title: 'Brevo a accepté l’envoi — en attente du rapport' },
  echec:       { label: 'Mail non livré', bg: '#fef2f2', color: '#b91c1c', border: '#fecaca', title: 'Le mail n’est pas arrivé (bounce, blocage ou spam)' },
  echec_envoi: { label: 'Mail non livré', bg: '#fef2f2', color: '#b91c1c', border: '#fecaca', title: 'Brevo a refusé l’envoi — vérifier l’adresse et l’expéditeur' },
};

function MailChip({ r }: { r: Relance }) {
  if (!r.email) return null;
  const s = String(r.email_statut || '').toLowerCase();
  const cfg = MAIL_ETAT_CONFIG[s] ?? { label: 'Mail en attente', bg: '#f8fafc', color: '#64748b', border: '#e2e8f0', title: 'Adresse connue, mail pas encore envoyé (part au prochain appel)' };
  // Brevo n'expose pas le lien clique sur ce compte (champ `link` toujours vide) :
  // on affiche donc le fait qu'il y a eu un clic, sans chercher lequel.
  const quand = r.email_clic_le || r.email_ouvert_le || r.email_le;
  return (
    <span
      title={`${cfg.title} · ${r.email}${quand ? ` — ${formatDateTime(quand)}` : ''}`}
      style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, whiteSpace: 'nowrap' }}
    >
      {cfg.label}
    </span>
  );
}

/**
 * Le message vocal a-t-il réellement été déposé sur la messagerie ?
 * Rien n'est affiché si l'appel n'est pas tombé sur une machine (vocal_statut null).
 * `non_depose` est le cas à surveiller : messagerie atteinte, aucun message laissé.
 */
const VOCAL_CONFIG: Record<string, { label: string; bg: string; color: string; border: string; title: string }> = {
  depose_el:      { label: 'Vocal déposé',      bg: '#ecfdf5', color: '#047857', border: '#a7f3d0', title: 'Message vocal déposé par ElevenLabs (détection de messagerie réussie)' },
  depose_agent:   { label: 'Vocal déposé',      bg: '#ecfdf5', color: '#047857', border: '#a7f3d0', title: 'Message vocal récité par Amélie après l’annonce' },
  non_applicable: { label: 'Filtrage · sans msg', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', title: 'Serveur de filtrage d’appels : aucun message n’est attendu, personne ne l’écouterait' },
  non_depose:     { label: 'Vocal NON déposé ⚠', bg: '#fef2f2', color: '#b91c1c', border: '#fecaca', title: 'Messagerie atteinte mais AUCUN message laissé — la patiente n’a été touchée que par le SMS et le mail' },
};

function VocalChip({ r }: { r: Relance }) {
  const cfg = r.vocal_statut ? VOCAL_CONFIG[r.vocal_statut] : null;
  if (!cfg) return null;
  return (
    <span
      title={cfg.title}
      style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, whiteSpace: 'nowrap' }}
    >
      {cfg.label}
    </span>
  );
}

/** Le lien ordonnance n'est jamais arrivé : échec Brevo, ou envoi jamais enregistré. */
function smsNonRecu(r: Relance): boolean {
  const e = smsEtat(r);
  return e === 'echec' || e === 'aucun';
}

/**
 * Aucun contact ABOUTI, sur aucun des trois canaux. C'est la définition de « À traiter ».
 *
 * ⚠️ Le nombre de tentatives n'entre PAS dans le calcul : une patiente appelée sept fois
 * sans jamais décrocher, et dont ni le SMS ni le mail ne sont arrivés, reste entièrement
 * à traiter. Ce qui compte est ce qui lui est parvenu, pas l'effort déjà dépensé.
 *
 * Un canal compte comme abouti si :
 *   voix  — elle a parlé (Répondu SMS / transfert) OU un message vocal a été déposé
 *   SMS   — Brevo confirme la livraison
 *   mail  — livré, ouvert ou cliqué ; « envoyé » n'est PAS une preuve de réception
 */
function aucunContact(r: Relance): boolean {
  const jointeVocalement = r.statut === 'Répondu SMS' || r.statut === 'Répondu transfert'
    || ['depose_el', 'depose_agent'].includes(String(r.vocal_statut || ''));
  if (jointeVocalement) return false;
  if (smsEtat(r) === 'livre') return false;
  if (['livre', 'ouvert', 'clique'].includes(String(r.email_statut || ''))) return false;
  return true;
}


/*
 * Note : la liste « À traiter » ne repose plus sur le statut de l'appel mais sur ce qui est
 * RÉELLEMENT parvenu à la patiente — voir `aucunContact()`. Un statut « Répondeur » dont le
 * SMS a échoué et dont le mail n'est jamais arrivé reste donc à traiter, alors que l'ancienne
 * logique par statut le considérait comme réglé.
 */

/**
 * Filtres rapides de la liste. Ils remplacent les anciennes cartes KPI, l'onglet
 * « Suivi » et le bouton « À appeler » : une seule barre, cliquable, qui filtre le tableau.
 * `alerte` = pastille rouge quand le compte est non nul (il y a quelque chose à traiter).
 */
type VueFiltre = 'a_traiter' | 'a_appeler' | 'messagerie' | 'raccroche' | 'sms_non_livre' | 'echec_appel' | 'deja_envoyee' | 'mail_clique' | 'vocal_manquant' | 'tout';

const VUES: { id: VueFiltre; label: string; match: (r: Relance) => boolean; alerte?: boolean; title: string }[] = [
  { id: 'a_traiter',     label: 'À traiter',     match: aucunContact,                      title: 'Jamais appelées, aucun SMS livré, aucun mail reçu — rien ne leur est parvenu' },
  { id: 'a_appeler',     label: 'À appeler',     match: r => r.statut === 'À appeler',     title: 'Jamais encore appelées' },
  { id: 'messagerie',    label: 'Messagerie',    match: r => r.statut === 'Répondeur',     title: 'Message vocal laissé — le SMS est le seul vrai point de contact' },
  { id: 'raccroche',     label: 'Raccroché',     match: r => r.statut === 'Raccroché',     title: 'A décroché puis coupé sans écouter — SMS et mail envoyés, à rappeler si besoin' },
  { id: 'sms_non_livre', label: 'SMS non reçu',  match: smsNonRecu,        alerte: true,   title: 'Le lien ordonnance n’est jamais arrivé' },
  { id: 'echec_appel',   label: 'En échec',      match: r => !!r.echec_motif, alerte: true, title: 'L’appel n’a pas pu être lancé' },
  { id: 'deja_envoyee',  label: 'Déjà envoyée',  match: r => !!r.ordonnance_deja_envoyee, alerte: true, title: 'La patiente affirme avoir déjà transmis son ordonnance — à vérifier' },
  { id: 'mail_clique',   label: 'Mail cliqué',   match: r => r.email_statut === 'clique',  title: 'A cliqué un lien du mail — le signal d’engagement le plus fiable' },
  { id: 'vocal_manquant', label: 'Vocal manquant', match: r => r.vocal_statut === 'non_depose', alerte: true, title: 'Messagerie atteinte mais aucun message vocal laissé — seuls le SMS et le mail sont partis' },
  { id: 'tout',          label: 'Tout',          match: () => true,                        title: 'Toutes les relances' },
];

function FixeBadge() {
  return <span title="Numéro fixe : ne peut pas recevoir de SMS" style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 8, background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', whiteSpace: 'nowrap' }}>📞 Fixe · pas de SMS</span>;
}

function parseTranscript(raw: string | null | undefined): { role: 'agent' | 'patient'; text: string }[] {
  if (!raw) return [];
  return raw.split('\n')
    .filter(l => l.trim())
    .map(l => {
      const m = l.match(/^\[(Amélie|Agent)\]\s*(.*)/) || l.match(/^\[Patient\]\s*(.*)/);
      if (!m) return null;
      const isAgent = l.startsWith('[Amélie]') || l.startsWith('[Agent]');
      return { role: (isAgent ? 'agent' : 'patient') as 'agent' | 'patient', text: (isAgent ? l.replace(/^\[Amélie\]\s*|\[Agent\]\s*/, '') : l.replace(/^\[Patient\]\s*/, '')).trim() };
    })
    .filter(Boolean) as { role: 'agent' | 'patient'; text: string }[];
}

function generateBatchId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return 'batch_' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '_' + pad(now.getHours()) + pad(now.getMinutes());
}

function defaultBatchLabel(): string {
  const s = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1); // "Mercredi 28 mai 2026"
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function fetchRelances(token: string): Promise<{ relances: Relance[]; stats: RelancesStats; batches: BatchGroup[] } | null> {
  try { const r = await fetch(`${API_BASE}/webhook/dashboard-relances-data`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }); if (!r.ok) return null; return r.json(); } catch { return null; }
}
async function importRelances(token: string, rows: object[], batch_id: string, batch_label: string | null): Promise<{ ok: boolean; inserted?: number; batch_id?: string }> {
  try { const r = await fetch(`${API_BASE}/webhook/dashboard-import-relances`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ rows, batch_id, batch_label }), signal: AbortSignal.timeout(20000) }); return r.json(); } catch { return { ok: false }; }
}
/** Résultat de l'extraction ORTHOP (W-ORTHOP-Extraction). */
export interface OrthopResult {
  ok?: boolean;
  mode?: string;
  date?: string;
  batch_label?: string | null;
  dossiers_trouves?: number;
  ecartes_sans_ligne_a_renouveler?: number;
  eligibles?: number;
  inseres?: number;
  deja_presents?: number;
  erreur?: string;
}
/**
 * Extraction directe depuis ORTHOP (API SOAP Must G5), sans passer par un export Excel.
 * L'appel enchaîne 3 requêtes SOAP côté n8n (~10 s pour une centaine de dossiers), d'où
 * le délai d'attente généreux. L'opération est idempotente : relancer la même date
 * n'insère rien de nouveau (index unique sur le n° de prescription ORTHOP).
 */
async function extractOrthop(token: string, date: string): Promise<OrthopResult> {
  try {
    const r = await fetch(`${API_BASE}/webhook/orthop-extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ date }),
      signal: AbortSignal.timeout(180000),
    });
    if (!r.ok) return { ok: false, erreur: `Le serveur a répondu ${r.status}` };
    const j = await r.json();
    return Array.isArray(j) ? (j[0] ?? { ok: false, erreur: 'Réponse vide' }) : j;
  } catch (e) {
    const nom = e instanceof Error ? e.name : '';
    return { ok: false, erreur: nom === 'TimeoutError' ? 'Délai dépassé — l’extraction est peut-être encore en cours côté ORTHOP.' : 'Serveur indisponible.' };
  }
}
/**
 * Envoie le SMS et le mail de relance à une patiente, SANS passer d'appel.
 * Sert aux dossiers injoignables : après plusieurs tentatives infructueuses, le SMS et le
 * mail restent les seuls canaux. Rien n'est envoyé automatiquement — uniquement sur clic.
 * Les numéros fixes sont écartés côté serveur (ils ne peuvent pas recevoir de SMS).
 */
async function sendRelance(token: string, id: number): Promise<{ ok: boolean; sms?: string; mail?: string; erreur?: string }> {
  try {
    const r = await fetch(`${API_BASE}/webhook/dashboard-send-relance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return { ok: false, erreur: `Le serveur a répondu ${r.status}` };
    const j = await r.json();
    return Array.isArray(j) ? (j[0] ?? { ok: false, erreur: 'Réponse vide' }) : j;
  } catch { return { ok: false, erreur: 'Serveur indisponible.' }; }
}
async function triggerOutboundCall(token: string, relance: Relance): Promise<{ ok: boolean; conversation_id?: string }> {
  try { const r = await fetch(`${API_BASE}/webhook/dashboard-trigger-call`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ id: relance.id, telephone: relance.telephone, nom: relance.nom, prenom: relance.prenom, date_echeance: relance.date_echeance, date_debut_location: relance.date_debut_location }), signal: AbortSignal.timeout(15000) }); return r.json(); } catch { return { ok: false }; }
}
async function updateRelance(token: string, id: number, fields: object): Promise<boolean> {
  try { const r = await fetch(`${API_BASE}/webhook/dashboard-update-relance`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ id, ...fields }), signal: AbortSignal.timeout(8000) }); const j = await r.json(); return j.ok; } catch { return false; }
}
async function deleteRelance(token: string, id: number): Promise<boolean> {
  return updateRelance(token, id, { action: 'delete' });
}
// Suppression groupée : un seul appel (DELETE ... WHERE id IN (...)) côté W-Update-Relance.
async function deleteRelancesBulk(token: string, ids: number[]): Promise<{ ok: boolean; count: number }> {
  try {
    const r = await fetch(`${API_BASE}/webhook/dashboard-update-relance`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ ids, action: 'delete' }), signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    return { ok: !!j.ok, count: j.deleted_count ?? ids.length };
  } catch { return { ok: false, count: 0 }; }
}
// Statut live d'un appel sortant (via W18 → API ElevenLabs). Renvoie null si indisponible.
async function fetchCallStatus(token: string, convId: string): Promise<string | null> {
  try {
    const r = await fetch(`${API_BASE}/webhook/dashboard-call-status?conv_id=${encodeURIComponent(convId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d.status || null;
  } catch { return null; }
}

// Attend la fin RÉELLE d'un appel (libère le slot du pool). Sonde toutes les 5 s.
// Fallback temps si l'endpoint de statut est indisponible, et cap de sécurité.
async function waitCallEnd(token: string, convId: string, shouldCancel: () => boolean): Promise<void> {
  const start = Date.now();
  const HARD_MAX = 10 * 60 * 1000;   // 10 min : cap absolu
  const FALLBACK = 120 * 1000;        // 2 min : si le statut reste introuvable, on libère
  const ACTIVE = ['initiated', 'in-progress', 'in_progress'];
  let gotStatus = false;
  while (!shouldCancel()) {
    await sleep(5000);
    const s = await fetchCallStatus(token, convId);
    if (s && s !== 'unknown') { gotStatus = true; if (!ACTIVE.includes(s)) return; }
    const elapsed = Date.now() - start;
    if (!gotStatus && elapsed >= FALLBACK) return;
    if (elapsed >= HARD_MAX) return;
  }
}

async function fetchCallHistory(token: string, telephone: string): Promise<Relance[]> {
  try { const r = await fetch(`${API_BASE}/webhook/dashboard-call-history?telephone=${encodeURIComponent(telephone)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }); if (!r.ok) return []; const d = await r.json(); return d.history || []; } catch { return []; }
}

// ─── Import / Manual Modal ────────────────────────────────────────────────────
interface EditableRow { _id: number; nom: string; prenom: string; telephone: string; email: string; date_echeance: string; }
let _rowSeq = 0;
function newRow(p?: Partial<EditableRow>): EditableRow { return { _id: ++_rowSeq, nom: '', prenom: '', telephone: '', email: '', date_echeance: '', ...p }; }
function parseToEditable(rawRows: object[]): EditableRow[] {
  return rawRows.map(r => {
    const row = r as Record<string, unknown>;
    const nom = String(row.nom ?? row.Nom ?? row['Nom de famille'] ?? row.NAME ?? row.name ?? '');
    const prenom = String(row.prenom ?? row.Prenom ?? row.Prénom ?? row['Prénom'] ?? row.firstname ?? row.firstName ?? '');
    const telephone = normalizePhoneFr(String(row.telephone ?? row.tel ?? row.phone ?? row.Telephone ?? row['Téléphone'] ?? row.numero ?? row.Numero ?? ''));
    const email = normalizeEmail(String(row.email ?? row.Email ?? row.EMAIL ?? row.mail ?? row.Mail ?? row['E-mail'] ?? row['Adresse email'] ?? ''));
    const date_echeance = parseFrDate(row.date_echeance ?? row.dateEcheance ?? row['Date échéance'] ?? row["Date d'échéance"] ?? row['date echeance'] ?? row.date ?? '');
    return newRow({ nom, prenom, telephone, email, date_echeance });
  });
}

/**
 * Détecte et parse le format d'export ORTHOP « Demande de renouvellement » :
 *   lignes méta en tête, puis une ligne d'en-tête « Bénéficiaire | Applicable du | M. »,
 *   puis des lignes « 128791 - KUMESO KENZA | 06/06/2024 | 06.44.04.88.86 ».
 * Découpe « ID - NOM PRÉNOM » (dernier mot = prénom), « Applicable du » → date_echeance.
 * Renvoie null si le fichier n'est pas au format ORTHOP (→ fallback parseToEditable).
 */
function parseOrthop(aoa: unknown[][]): EditableRow[] | null {
  if (!Array.isArray(aoa) || !aoa.length) return null;
  const headerIdx = aoa.findIndex(row => Array.isArray(row)
    && row.some(c => /b[ée]n[ée]ficiaire/i.test(String(c)))
    && row.some(c => /applicable/i.test(String(c))));
  if (headerIdx < 0) return null;
  const hdr = (aoa[headerIdx] as unknown[]).map(c => String(c).trim());
  const benefCol = hdr.findIndex(c => /b[ée]n[ée]ficiaire/i.test(c));
  const dateCol = hdr.findIndex(c => /applicable/i.test(c));
  if (benefCol < 0 || dateCol < 0) return null;
  const phoneLike = (v: unknown) => /(?:\+?\d[\s.\-]?){8,}/.test(String(v));
  let phoneCol = hdr.findIndex(c => /^m\.?$|mobile|t[ée]l|num[ée]ro|portable/i.test(c));
  if (phoneCol < 0) {
    outer: for (let i = headerIdx + 1; i < Math.min(aoa.length, headerIdx + 6); i++) {
      const row = aoa[i]; if (!Array.isArray(row)) continue;
      for (let c = 0; c < row.length; c++) { if (c !== benefCol && c !== dateCol && phoneLike(row[c])) { phoneCol = c; break outer; } }
    }
  }
  // Colonne email : en-tête explicite, sinon première colonne contenant un « @ ».
  const mailLike = (v: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());
  let emailCol = hdr.findIndex(c => /e[-\s]?mail|courriel|adresse\s*mail/i.test(c));
  if (emailCol < 0) {
    outerMail: for (let i = headerIdx + 1; i < Math.min(aoa.length, headerIdx + 6); i++) {
      const row = aoa[i]; if (!Array.isArray(row)) continue;
      for (let c = 0; c < row.length; c++) { if (mailLike(row[c])) { emailCol = c; break outerMail; } }
    }
  }
  const out: EditableRow[] = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i]; if (!Array.isArray(row)) continue;
    const benefRaw = String(row[benefCol] ?? '').trim();
    const phoneRaw = phoneCol >= 0 ? String(row[phoneCol] ?? '').trim() : '';
    // Garde uniquement les vraies lignes bénéficiaire : préfixe « ID - » OU un numéro présent (ignore notes/pieds de page)
    if (!/^\s*\d{3,}\s*[-–—]/.test(benefRaw) && !phoneLike(phoneRaw)) continue;
    const name = benefRaw.replace(/^\s*\d+\s*[-–—]\s*/, '').trim();
    const parts = name.split(/\s+/).filter(Boolean);
    let nom = '', prenom = '';
    if (parts.length === 1) nom = parts[0];
    else if (parts.length > 1) { prenom = parts[parts.length - 1]; nom = parts.slice(0, -1).join(' '); }
    out.push(newRow({
      nom: titleCaseName(nom),
      prenom: titleCaseName(prenom),
      telephone: normalizePhoneFr(phoneRaw),
      email: emailCol >= 0 ? normalizeEmail(String(row[emailCol] ?? '')) : '',
      date_echeance: parseFrDate(row[dateCol]),
    }));
  }
  return out.length ? out : null;
}
const cellInput: React.CSSProperties = { width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12.5, outline: 'none', color: 'var(--text)', fontFamily: 'inherit', background: 'white', boxSizing: 'border-box' };

/**
 * Extraction ORTHOP — remplace le mode opératoire manuel (écran Suivi → Demande de
 * renouvellement → export Excel → import ici) par un seul bouton.
 * La date demandée est « Applicable du », qui correspond à J+1 par rapport au champ
 * « Fin loc. » de l'écran ORTHOP : pour la liste du jour, on prend donc aujourd'hui.
 */
function OrthopModal({ token, onClose, onSuccess }: { token: string; onClose: () => void; onSuccess: (n: number) => void }) {
  // 'sv-SE' donne YYYY-MM-DD ; le fuseau Paris évite le décalage de date en soirée.
  const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const [date, setDate] = useState(aujourdhui);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<OrthopResult | null>(null);

  async function lancer() {
    setLoading(true); setRes(null);
    const r = await extractOrthop(token, date);
    setLoading(false); setRes(r);
    if (!r.erreur) onSuccess(r.inseres ?? 0);
  }

  const ligne = (label: string, valeur: React.ReactNode, fort = false) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}>
      <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontSize: fort ? 16 : 13, fontWeight: fort ? 800 : 600, color: fort ? '#047857' : 'var(--text)', fontFamily: 'Lexend,sans-serif' }}>{valeur}</span>
    </div>
  );

  return (
    <Portal>
      <div className="panel-overlay animate-fade-in" onClick={loading ? undefined : onClose} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'white', borderRadius: 16, padding: 26, width: 480, maxHeight: '88vh', overflow: 'auto', zIndex: 1001, boxShadow: '0 20px 60px rgba(0,0,0,.15)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h2 style={{ fontFamily: 'Lexend,sans-serif', fontSize: 17, fontWeight: 800, color: 'var(--text)', margin: 0 }}>Extraire depuis ORTHOP</h2>
          {!loading && <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex' }}><X size={18} /></button>}
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 18px', lineHeight: 1.5 }}>
          Récupère directement la liste des renouvellements, sans export Excel. Les patientes déjà présentes ne sont jamais ajoutées deux fois.
        </p>

        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'Lexend,sans-serif', display: 'block', marginBottom: 6 }}>
          Ordonnances applicables du
        </label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={loading}
          style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13.5, color: 'var(--text)', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }} />
        {date === aujourdhui && <p style={{ fontSize: 11.5, color: '#047857', margin: '6px 0 0' }}>✓ Liste du jour</p>}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, marginTop: 18 }}>
            <RefreshCw size={16} style={{ color: '#1d4ed8', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
            <p style={{ fontSize: 12.5, color: '#1e40af', margin: 0 }}>Interrogation d'ORTHOP… comptez une dizaine de secondes.</p>
          </div>
        )}

        {res?.erreur && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, marginTop: 18 }}>
            <AlertCircle size={15} style={{ color: '#b91c1c', flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 12.5, color: '#991b1b', margin: 0 }}>{res.erreur}</p>
          </div>
        )}

        {res && !res.erreur && (
          <div style={{ marginTop: 18, padding: '14px 16px', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10 }}>
            {ligne('Dossiers trouvés dans ORTHOP', res.dossiers_trouves ?? '—')}
            {ligne('Écartés (aucune ligne à renouveler)', res.ecartes_sans_ligne_a_renouveler ?? '—')}
            {ligne('Éligibles', res.eligibles ?? '—')}
            {ligne('Déjà dans les relances', res.deja_presents ?? '—')}
            {ligne('Ajoutés', res.inseres ?? 0, true)}
            {res.batch_label && <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '10px 0 0' }}>Campagne : <strong>{res.batch_label}</strong></p>}
            {res.inseres === 0 && (res.eligibles ?? 0) > 0 && (
              <p style={{ fontSize: 11.5, color: '#b45309', margin: '8px 0 0' }}>Cette liste avait déjà été importée — rien n'a été dupliqué.</p>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>{res && !res.erreur ? 'Fermer' : 'Annuler'}</button>
          <button className="btn btn-primary" onClick={lancer} disabled={loading || !date}>
            {loading ? <RefreshCw size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <CloudDownload size={14} />}
            {loading ? 'Extraction…' : res && !res.erreur ? 'Relancer' : 'Extraire'}
          </button>
        </div>
      </div>
    </Portal>
  );
}

function ImportModal({ token, mode, onClose, onSuccess }: { token: string; mode: 'import' | 'manual'; onClose: () => void; onSuccess: (n: number) => void }) {
  const [step, setStep] = useState<1 | 2>(mode === 'manual' ? 2 : 1);
  const [rows, setRows] = useState<EditableRow[]>(mode === 'manual' ? [newRow()] : []);
  const [filename, setFilename] = useState('');
  const [batchLabel, setBatchLabel] = useState(defaultBatchLabel);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  function handleFile(f: File) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = read(e.target?.result as ArrayBuffer, { type: 'array', cellDates: true });
        // Toutes les feuilles sont lues et concaténées : les exports ORTHOP arrivent souvent
        // avec une feuille par jour (« Liste 21.08 », « Liste 22.08 »…).
        const parsed: EditableRow[] = [];
        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          if (!ws) continue;
          const aoa = utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];
          const sheetRows = parseOrthop(aoa) ?? parseToEditable(utils.sheet_to_json(ws, { defval: '' }) as object[]);
          // Ignore les lignes vides des feuilles annexes (notes, totaux, onglets de garde)
          parsed.push(...sheetRows.filter(r => r.nom.trim() || r.prenom.trim() || r.telephone.trim()));
        }
        setRows(parsed.length ? parsed : [newRow()]);
        setFilename(f.name);
        setStep(2);
      } catch { setError('Format invalide (.xlsx, .xls, .csv)'); }
    };
    reader.readAsArrayBuffer(f);
  }
  function upd(id: number, k: keyof Omit<EditableRow, '_id'>, v: string) { setRows(p => p.map(r => r._id === id ? { ...r, [k]: v } : r)); }
  const valid = rows.filter(r => r.nom.trim() || r.prenom.trim() || r.telephone.trim());
  async function save() {
    if (!valid.length) { setError('Au moins une ligne valide.'); return; }
    setLoading(true);
    const batch_id = generateBatchId();
    const batch_label_val = batchLabel.trim() || null;
    const res = await importRelances(token, valid.map(({ _id: _, ...rest }) => rest), batch_id, batch_label_val);
    setLoading(false);
    if (res.ok) onSuccess(res.inserted ?? valid.length); else setError('Erreur. Réessayez.');
  }
  return (
    <Portal>
      <div className="panel-overlay animate-fade-in" onClick={onClose} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'white', borderRadius: 16, padding: 28, width: step === 2 ? 720 : 580, maxHeight: '88vh', overflow: 'auto', zIndex: 1001, boxShadow: '0 20px 60px rgba(0,0,0,.15)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'Lexend,sans-serif', fontSize: 17, fontWeight: 800, color: 'var(--text)', margin: 0 }}>{mode === 'manual' ? 'Ajouter des numéros' : 'Import Excel — Relances'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex' }}><X size={18} /></button>
        </div>
        {step === 1 && (
          <>
            <div onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }} onDragOver={e => e.preventDefault()} onClick={() => fileRef.current?.click()} style={{ border: '2px dashed var(--border)', borderRadius: 12, padding: '32px 20px', textAlign: 'center', cursor: 'pointer', marginBottom: 16, background: 'var(--bg)' }}>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
              <Upload size={28} style={{ color: 'var(--muted)', marginBottom: 10 }} />
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', margin: '0 0 4px' }}>Déposez votre fichier ici</p>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>.xlsx · .xls · .csv — ou cliquez</p>
            </div>
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 16 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>Colonnes attendues :</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['nom', 'prenom', 'telephone', 'email', 'date_echeance'].map(c => <code key={c} style={{ fontSize: 11, background: 'var(--blue-light)', color: 'var(--blue)', padding: '2px 6px', borderRadius: 4 }}>{c}</code>)}
              </div>
              <p style={{ fontSize: 11, color: 'var(--muted)', margin: '8px 0 0' }}>✨ Export ORTHOP « Demande de renouvellement » (<code style={{ fontSize: 10 }}>Bénéficiaire</code> / <code style={{ fontSize: 10 }}>Applicable du</code> / <code style={{ fontSize: 10 }}>M.</code>) détecté automatiquement.</p>
            </div>
            {error && <div style={{ padding: '8px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#dc2626' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-ghost" onClick={onClose}>Annuler</button></div>
          </>
        )}
        {step === 2 && (
          <>
            {mode === 'import' && <button onClick={() => { setStep(1); setRows([]); }} style={{ fontSize: 12, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 5 }}>← Changer de fichier</button>}
            {filename && <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{filename} · {rows.length} ligne(s)</p>}
            {/* Campaign label */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'Lexend,sans-serif', display: 'block', marginBottom: 6 }}>
                Nom de la campagne <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optionnel)</span>
              </label>
              <input
                value={batchLabel}
                onChange={e => setBatchLabel(e.target.value)}
                placeholder="Ex : Mai 2026 — Échéances proches"
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, color: 'var(--text)', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }}
              />
            </div>
            <div style={{ overflowY: 'auto', maxHeight: '48vh', marginBottom: 14 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ background: '#f8fafc' }}>{['#', 'Nom', 'Prénom', 'Téléphone *', 'Email', 'Date échéance', ''].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 11, color: 'var(--text)', letterSpacing: '.3px', textTransform: 'uppercase', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
                <tbody>{rows.map((r, i) => (
                  <tr key={r._id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '5px 10px', color: 'var(--muted)', fontSize: 11, width: 28 }}>{i + 1}</td>
                    <td style={{ padding: '4px 6px' }}><input style={cellInput} value={r.nom} onChange={e => upd(r._id, 'nom', e.target.value)} placeholder="Nom de famille" /></td>
                    <td style={{ padding: '4px 6px' }}><input style={cellInput} value={r.prenom} onChange={e => upd(r._id, 'prenom', e.target.value)} placeholder="Prénom" /></td>
                    <td style={{ padding: '4px 6px' }}><input style={{ ...cellInput, borderColor: !r.telephone.trim() ? '#fca5a5' : 'var(--border)' }} value={r.telephone} onChange={e => upd(r._id, 'telephone', e.target.value)} placeholder="+33612345678" /></td>
                    <td style={{ padding: '4px 6px' }}><input style={cellInput} value={r.email} onChange={e => upd(r._id, 'email', e.target.value)} type="email" placeholder="prenom.nom@mail.com" /></td>
                    <td style={{ padding: '4px 6px' }}><input style={cellInput} value={r.date_echeance} onChange={e => upd(r._id, 'date_echeance', e.target.value)} type="date" /></td>
                    <td style={{ padding: '4px 6px', width: 32 }}><button onClick={() => setRows(p => p.filter(x => x._id !== r._id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', display: 'flex', padding: 4 }}><X size={14} /></button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <button onClick={() => setRows(p => [...p, newRow()])} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--blue)', background: 'var(--blue-faint)', border: '1px dashed var(--blue)', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', marginBottom: 14 }}>+ Ajouter une ligne</button>
            {error && <div style={{ padding: '8px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 14, fontSize: 12, color: '#dc2626' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>{valid.length} valide(s) sur {rows.length}</p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
                <button className="btn btn-primary" disabled={!valid.length || loading} onClick={save}>
                  {loading ? <RefreshCw size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <CheckCircle size={14} />}
                  {loading ? 'Enregistrement…' : `Enregistrer ${valid.length} ligne${valid.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Portal>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────
function EditModal({ relance, token, onClose, onSaved }: { relance: Relance; token: string; onClose: () => void; onSaved: (u: Partial<Relance>) => void }) {
  const [statut, setStatut] = useState<Relance['statut']>(relance.statut);
  const [notes, setNotes] = useState(relance.notes || '');
  const [resultat, setResultat] = useState(relance.resultat || '');
  const [nb, setNb] = useState(relance.nb_tentatives ?? 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setLoading(true);
    const ok = await updateRelance(token, relance.id, { statut, notes: notes || null, resultat: resultat || null, nb_tentatives: nb });
    setLoading(false);
    if (ok) onSaved({ statut, notes: notes || null, resultat: resultat || null, nb_tentatives: nb }); else setError('Erreur. Réessayez.');
  }
  return (
    <Portal>
      <div className="panel-overlay animate-fade-in" onClick={onClose} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'white', borderRadius: 16, padding: 28, width: 480, zIndex: 1001, boxShadow: '0 20px 60px rgba(0,0,0,.15)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontFamily: 'Lexend,sans-serif', fontSize: 16, fontWeight: 800, color: 'var(--text)', margin: 0 }}>{relance.nom || '—'}</h2>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '3px 0 0', fontFamily: 'monospace' }}>{relance.telephone}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'Lexend,sans-serif', display: 'block', marginBottom: 8 }}>Statut</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(STATUT_CONFIG).map(([s, c]) => (
                <button key={s} onClick={() => setStatut(s as Relance['statut'])} style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: statut === s ? `2px solid ${c.color}` : '2px solid transparent', background: statut === s ? c.bg : '#f1f5f9', color: statut === s ? c.color : 'var(--muted)', transition: 'all .15s' }}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'Lexend,sans-serif', display: 'block', marginBottom: 8 }}>Nb tentatives</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => setNb(Math.max(0, nb - 1))} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}>−</button>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', minWidth: 28, textAlign: 'center', fontFamily: 'Lexend,sans-serif' }}>{nb}</span>
              <button onClick={() => setNb(nb + 1)} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}>+</button>
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'Lexend,sans-serif', display: 'block', marginBottom: 6 }}>Résultat</label>
            <input value={resultat} onChange={e => setResultat(e.target.value)} placeholder="Résumé de l'appel…" style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, color: 'var(--text)', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'Lexend,sans-serif', display: 'block', marginBottom: 6 }}>Notes internes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, color: 'var(--text)', resize: 'vertical', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }} />
          </div>
        </div>
        {error && <div style={{ padding: '8px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginTop: 14, fontSize: 12, color: '#dc2626' }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={save} disabled={loading}>
            {loading ? <RefreshCw size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <CheckCircle size={14} />}
            {loading ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </Portal>
  );
}

// ─── Transcript Panel ─────────────────────────────────────────────────────────
function TranscriptPanel({ relance, onClose }: { relance: Relance; onClose: () => void }) {
  const messages = parseTranscript(relance.transcript);
  const hasSentiment = relance.sentiment && SENTIMENT_CONFIG[relance.sentiment];
  useEffect(() => {
    const main = document.querySelector('main') as HTMLElement | null;
    if (main) { main.style.overflow = 'hidden'; return () => { main.style.overflow = 'auto'; }; }
  }, []);
  return (
    <Portal>
      <div className="panel-overlay animate-fade-in" onClick={onClose} style={{ zIndex: 1000 }} />
      <div style={{ position: 'fixed', top: 20, right: 16, maxHeight: '75vh', width: 460, background: 'white', zIndex: 1001, boxShadow: '0 8px 40px rgba(0,0,0,.18)', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'slideInRight .25s ease' }}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h3 style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 800, fontSize: 15, color: 'var(--text)', margin: 0 }}>Transcript</h3>
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>{relance.nom || relance.telephone} · {formatDateTime(relance.dernier_appel)} · {formatDuration(relance.duree_sec)}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex' }}><X size={18} /></button>
        </div>
        {(hasSentiment || relance.resultat_ia) && (
          <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', background: '#fafafa', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
            {hasSentiment && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: SENTIMENT_CONFIG[relance.sentiment!].bg, color: SENTIMENT_CONFIG[relance.sentiment!].color }}>{SENTIMENT_CONFIG[relance.sentiment!].label}</span>}
            {relance.resultat_ia && <span style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>{relance.resultat_ia}</span>}
          </div>
        )}
        <div style={{ overflowY: 'auto', overscrollBehavior: 'contain', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>
              <MessageSquare size={28} strokeWidth={1.5} style={{ opacity: .4, marginBottom: 8 }} />
              <p style={{ fontSize: 13 }}>Transcript non disponible</p>
              <p style={{ fontSize: 11, marginTop: 4 }}>L'analyse post-appel n'a pas encore été traitée.</p>
            </div>
          ) : messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'agent' ? 'flex-start' : 'flex-end' }}>
              <div style={{ maxWidth: '80%', padding: '8px 12px', borderRadius: m.role === 'agent' ? '4px 14px 14px 14px' : '14px 4px 14px 14px', background: m.role === 'agent' ? '#eef2ff' : '#f0fdf4', color: 'var(--text)', fontSize: 13, lineHeight: 1.5 }}>
                <span style={{ display: 'block', fontSize: 10, fontWeight: 700, color: m.role === 'agent' ? '#6366f1' : '#16a34a', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.5px' }}>{m.role === 'agent' ? 'Amélie' : 'Patient'}</span>
                {m.text}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Portal>
  );
}

// ─── History Panel ────────────────────────────────────────────────────────────
function HistoryPanel({ telephone, token, onClose }: { telephone: string; token: string; onClose: () => void }) {
  const [history, setHistory] = useState<Relance[]>([]);
  const [loading, setLoading] = useState(true);
  const [transcriptEntry, setTranscriptEntry] = useState<Relance | null>(null);
  useEffect(() => {
    fetchCallHistory(token, telephone).then(h => { setHistory(h); setLoading(false); });
  }, [telephone, token]);
  useEffect(() => {
    const main = document.querySelector('main') as HTMLElement | null;
    if (main) { main.style.overflow = 'hidden'; return () => { main.style.overflow = 'auto'; }; }
  }, []);
  return (
    <Portal>
      <div className="panel-overlay animate-fade-in" onClick={onClose} style={{ zIndex: 1000 }} />
      <div style={{ position: 'fixed', top: 20, right: 16, maxHeight: '75vh', width: 440, background: 'white', zIndex: 1001, boxShadow: '0 8px 40px rgba(0,0,0,.18)', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'slideInRight .25s ease' }}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h3 style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 800, fontSize: 15, color: 'var(--text)', margin: 0 }}>Historique des appels</h3>
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0', fontFamily: 'monospace' }}>{telephone}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex' }}><X size={18} /></button>
        </div>
        <div style={{ overflowY: 'auto', overscrollBehavior: 'contain', padding: '16px 20px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}><RefreshCw size={20} style={{ animation: 'spin .8s linear infinite', color: 'var(--blue)', marginBottom: 8 }} /><p style={{ fontSize: 13 }}>Chargement…</p></div>
          ) : history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}><History size={28} strokeWidth={1.5} style={{ opacity: .4, marginBottom: 8 }} /><p style={{ fontSize: 13 }}>Aucun historique trouvé</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
              <div style={{ position: 'absolute', left: 11, top: 20, bottom: 0, width: 2, background: 'var(--border)', zIndex: 0 }} />
              {history.map((h, i) => {
                const cfg = STATUT_CONFIG[h.statut] || STATUT_CONFIG['Sans suite'];
                const sentCfg = h.sentiment ? SENTIMENT_CONFIG[h.sentiment] : null;
                return (
                  <div key={h.id} style={{ display: 'flex', gap: 14, marginBottom: i < history.length - 1 ? 20 : 0, position: 'relative', zIndex: 1 }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: cfg.hex, border: '3px solid white', boxShadow: '0 0 0 2px ' + cfg.hex, flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1, background: '#f9fafb', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, alignItems: 'flex-start' }}>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color }}>{h.statut}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{formatDateTime(h.dernier_appel || h.updated_at)}</span>
                          {h.transcript && (
                            <button onClick={() => setTranscriptEntry(h)} title="Voir le transcript" style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid #c7d2fe', background: '#eef2ff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <MessageSquare size={11} style={{ color: '#6366f1' }} />
                            </button>
                          )}
                        </div>
                      </div>
                      {h.resultat_ia && <p style={{ fontSize: 12, color: 'var(--text)', margin: '0 0 4px', fontStyle: 'italic' }}>{h.resultat_ia}</p>}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {h.duree_sec ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>⏱ {formatDuration(h.duree_sec)}</span> : null}
                        {sentCfg && <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: sentCfg.bg, color: sentCfg.color }}>{sentCfg.label}</span>}
                        {h.nb_tentatives > 0 && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{h.nb_tentatives} tentative(s)</span>}
                        {h.batch_label && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8, background: '#eef2ff', color: '#6366f1' }}>📂 {h.batch_label}</span>}
                        {h.sms_echec && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 8, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>⚠ SMS non livré</span>}
                      </div>
                      {h.notes && <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0', borderTop: '1px solid var(--border)', paddingTop: 5 }}>📝 {h.notes}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {transcriptEntry && (
        <TranscriptPanel relance={transcriptEntry} onClose={() => setTranscriptEntry(null)} />
      )}
    </Portal>
  );
}

// ─── Batch Progress Modal ─────────────────────────────────────────────────────
interface BatchState { done: number; total: number; currentName: string; errors: number; finished: boolean; active: number; }
function BatchModal({ batch, onClose, onCancel }: { batch: BatchState; onClose: () => void; onCancel: () => void }) {
  const pct = batch.total > 0 ? Math.round((batch.done / batch.total) * 100) : 0;
  return (
    <Portal>
      <div className="panel-overlay animate-fade-in" style={{ zIndex: 1000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'white', borderRadius: 16, padding: 28, width: 440, zIndex: 1001, boxShadow: '0 20px 60px rgba(0,0,0,.15)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          {batch.finished
            ? <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CheckCircle size={18} style={{ color: '#16a34a' }} /></div>
            : <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><PhoneCall size={18} style={{ color: '#6366f1', animation: 'pulse 1.5s infinite' }} /></div>}
          <div>
            <h3 style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 800, fontSize: 15, color: 'var(--text)', margin: 0 }}>{batch.finished ? 'Batch terminé' : 'Appels en cours…'}</h3>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0' }}>{batch.done} / {batch.total} contacts{!batch.finished && batch.active > 0 ? ` · ${batch.active} en ligne` : ''}</p>
          </div>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: '#f1f5f9', overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: batch.finished ? '#22c55e' : '#6366f1', borderRadius: 4, transition: 'width .3s ease' }} />
        </div>
        {!batch.finished && batch.currentName && (
          <p style={{ fontSize: 13, color: 'var(--text)', margin: '0 0 16px', textAlign: 'center' }}>
            📞 <strong>{batch.currentName}</strong>
          </p>
        )}
        {batch.finished && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <div style={{ flex: 1, padding: '10px 14px', background: '#f0fdf4', borderRadius: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#16a34a', fontFamily: 'Lexend,sans-serif' }}>{batch.done - batch.errors}</div>
              <div style={{ fontSize: 11, color: '#15803d' }}>Lancés</div>
            </div>
            {batch.errors > 0 && (
              <div style={{ flex: 1, padding: '10px 14px', background: '#fef2f2', borderRadius: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#dc2626', fontFamily: 'Lexend,sans-serif' }}>{batch.errors}</div>
                <div style={{ fontSize: 11, color: '#dc2626' }}>Échecs</div>
              </div>
            )}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          {!batch.finished && <button className="btn btn-ghost" onClick={onCancel}><Pause size={13} /> Annuler</button>}
          {batch.finished && <button className="btn btn-primary" onClick={onClose}><CheckCircle size={13} /> Fermer</button>}
        </div>
      </div>
    </Portal>
  );
}

// ─── Campagnes View ───────────────────────────────────────────────────────────
function CampagnesView({ batches, relances, token, onRelanceUpdate, onRelanceDelete }: {
  batches: BatchGroup[];
  relances: Relance[];
  token: string;
  onRelanceUpdate: (id: number, updates: Partial<Relance>) => void;
  onRelanceDelete: (id: number) => void;
}) {
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [editingNote, setEditingNote] = useState(false);
  const [callingId, setCallingId] = useState<number | null>(null);
  const [callMsg, setCallMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [historyPhone, setHistoryPhone] = useState<string | null>(null);
  const [filterStatut, setFilterStatut] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [transcriptTarget, setTranscriptTarget] = useState<Relance | null>(null);
  const [editTarget, setEditTarget] = useState<Relance | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  useEffect(() => {
    if (selectedBatch) { setNote(loadBatchNote(selectedBatch)); setFilterStatut(''); setFilterSearch(''); }
  }, [selectedBatch]);

  const batchRelances = selectedBatch ? relances.filter(r => r.batch_id === selectedBatch) : [];
  const selectedData = selectedBatch ? batches.find(b => b.batch_id === selectedBatch) : null;

  async function handleCall(r: Relance) {
    if (!r.telephone) return;
    setCallingId(r.id);
    setCallMsg(null);
    const res = await triggerOutboundCall(token, r);
    if (res.ok) setCallMsg({ type: 'success', text: `✅ Appel lancé — ${r.nom || r.telephone}` });
    else setCallMsg({ type: 'error', text: `❌ Échec. Vérifiez le numéro.` });
    setCallingId(null);
    setTimeout(() => setCallMsg(null), 7000);
  }

  async function quickOutcome(r: Relance, statut: Relance['statut']) {
    const ok = await updateRelance(token, r.id, { statut });
    if (ok) onRelanceUpdate(r.id, { statut });
  }

  async function handleDelete(id: number) {
    const ok = await deleteRelance(token, id);
    if (ok) onRelanceDelete(id);
    setDeleteConfirm(null);
  }

  // ── Drill-down view ──────────────────────────────────────────────────────────
  if (selectedBatch && selectedData) {
    const repondus = selectedData.repondu_sms + selectedData.repondu_transfert;
    const rappelPct = selectedData.total > 0 ? Math.round((repondus / selectedData.total) * 100) : 0;
    const smsFail = batchRelances.filter(r => r.sms_echec).length;
    const filtered = batchRelances
      .filter(r => !filterStatut || r.statut === filterStatut)
      .filter(r => {
        if (!filterSearch) return true;
        const q = filterSearch.toLowerCase();
        return (r.nom || '').toLowerCase().includes(q) || (r.telephone || '').replace(/\s/g, '').includes(q.replace(/\s/g, ''));
      });

    return (
      <div className="animate-fade-up">
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <button onClick={() => setSelectedBatch(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: 'white', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, fontWeight: 600, color: 'var(--muted)', cursor: 'pointer' }}>
            <ChevronLeft size={13} /> Campagnes
          </button>
          <ChevronRight size={13} style={{ color: 'var(--muted)' }} />
          <h2 style={{ fontFamily: 'Lexend,sans-serif', fontSize: 16, fontWeight: 800, color: 'var(--text)', margin: 0 }}>
            {selectedData.batch_label || selectedBatch}
          </h2>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>· Importé le {formatDate(selectedData.date_import)}</span>
        </div>

        {/* KPI row — 5 cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
          {[
            { label: 'Total', value: selectedData.total, sub: `${rappelPct}% traité`, color: '#4338ca', bg: '#eef2ff' },
            { label: 'Répondu SMS', value: selectedData.repondu_sms, sub: 'Ordonnance traitée', color: '#065f46', bg: '#ecfdf5' },
            { label: 'Répondu transfert', value: selectedData.repondu_transfert, sub: 'Transféré', color: '#0e7490', bg: '#ecfeff' },
            { label: 'Non répondus', value: selectedData.non_repondu, sub: 'À relancer', color: '#92400e', bg: '#fffbeb' },
            { label: 'Répondeurs', value: selectedData.repondeur, sub: 'Messagerie', color: '#5b21b6', bg: '#f5f3ff' },
          ].map(c => (
            <div key={c.label} style={{ background: 'white', borderRadius: 12, padding: '12px 14px', border: '1px solid var(--border)', borderTop: `3px solid ${c.color}`, boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 5 }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: c.color, fontFamily: 'Lexend,sans-serif', lineHeight: 1, marginBottom: 3 }}>{c.value}</div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{c.sub}</div>
            </div>
          ))}
        </div>

        {/* Progress bar + SMS failure summary */}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid var(--border)', padding: '12px 16px', marginBottom: 12, boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'Lexend,sans-serif' }}>Progression</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {smsFail > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', padding: '2px 9px', borderRadius: 8 }}>
                  ⚠ {smsFail} SMS non livré{smsFail > 1 ? 's' : ''}
                </span>
              )}
              <span style={{ fontSize: 13, fontWeight: 700, color: rappelPct === 100 ? '#16a34a' : '#6366f1', fontFamily: 'Lexend,sans-serif' }}>{rappelPct}%</span>
            </div>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: '#f1f5f9', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${rappelPct}%`, background: rappelPct === 100 ? '#22c55e' : '#6366f1', borderRadius: 4, transition: 'width .4s ease' }} />
          </div>
        </div>

        {/* Notes */}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid var(--border)', padding: '12px 16px', marginBottom: 14, boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: editingNote ? 8 : 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'Lexend,sans-serif' }}>📝 Notes de campagne</span>
            {!editingNote && <button onClick={() => setEditingNote(true)} style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Modifier</button>}
          </div>
          {editingNote ? (
            <div>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} autoFocus placeholder="Notes internes sur cette campagne…" style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, color: 'var(--text)', resize: 'vertical', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit', marginTop: 4 }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn btn-ghost" onClick={() => setEditingNote(false)}>Annuler</button>
                <button className="btn btn-primary" onClick={() => { saveBatchNote(selectedBatch, note); setEditingNote(false); }}><CheckCircle size={13} /> Enregistrer</button>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: note ? 'var(--text)' : 'var(--muted)', margin: note ? '6px 0 0' : 0, fontStyle: note ? 'normal' : 'italic' }}>
              {note || 'Aucune note — cliquez sur Modifier pour en ajouter.'}
            </p>
          )}
        </div>

        {/* Call toast */}
        {callMsg && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: callMsg.type === 'success' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${callMsg.type === 'success' ? '#86efac' : '#fecaca'}`, borderRadius: 8, marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: callMsg.type === 'success' ? '#15803d' : '#dc2626', margin: 0 }}>{callMsg.text}</p>
            <button onClick={() => setCallMsg(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex' }}><X size={12} /></button>
          </div>
        )}

        {/* Filter toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {filtered.length} contact{filtered.length !== 1 ? 's' : ''}{(filterStatut || filterSearch) ? ` / ${batchRelances.length}` : ''}
          </span>
          <div style={{ flex: 1 }} />
          <select value={filterStatut} onChange={e => setFilterStatut(e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text)', background: 'white', cursor: 'pointer', outline: 'none' }}>
            <option value="">Tous les statuts</option>
            {Object.keys(STATUT_CONFIG).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div style={{ position: 'relative' }}>
            <input value={filterSearch} onChange={e => setFilterSearch(e.target.value)} placeholder="Nom / téléphone…" style={{ padding: '6px 10px 6px 28px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text)', width: 175, outline: 'none' }} />
            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 12, pointerEvents: 'none' }}>🔍</span>
          </div>
        </div>

        {/* Contacts table */}
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
              <FileText size={24} strokeWidth={1.5} style={{ opacity: .4, marginBottom: 8 }} />
              <p style={{ fontSize: 13 }}>{filterStatut || filterSearch ? 'Aucun résultat.' : 'Aucun contact.'}</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid var(--border)' }}>
                    {['Nom', 'Téléphone', 'Échéance', 'Statut', 'Appels', 'Dernier appel', 'Résultat', '', ''].map((h, i) => (
                      <th key={i} style={{ padding: '10px 10px', textAlign: 'left', fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 11, color: 'var(--text)', letterSpacing: '.4px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => {
                    const echeanceOld = r.statut !== 'Répondu SMS' && r.statut !== 'Répondu transfert' && isEcheancePassed(r.date_echeance);
                    const confirmingDelete = deleteConfirm === r.id;
                    return (
                      <tr key={r.id} style={{ borderBottom: i < filtered.length - 1 ? '1px solid #f1f5f9' : 'none', borderLeft: `3px solid ${STATUT_CONFIG[r.statut]?.hex || '#e2e8f0'}` }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#f9fafb'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                        <td style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text)', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nom || '—'}</td>
                        <td style={{ padding: '8px 10px' }}>
                          {r.telephone ? (
                            <button onClick={() => setHistoryPhone(r.telephone!)} style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline dotted', display: 'flex', alignItems: 'center', gap: 4 }}>
                              {r.telephone}<ChevronRight size={11} style={{ color: 'var(--muted)' }} />
                            </button>
                          ) : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          <span style={{ color: echeanceOld ? '#dc2626' : 'var(--muted)', fontWeight: echeanceOld ? 700 : 400, fontSize: 12 }}>{echeanceOld ? '⚠ ' : ''}{formatDate(r.date_echeance)}</span>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                            <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 20, fontSize: 11.5, fontWeight: 700, fontFamily: 'Lexend,sans-serif', background: STATUT_CONFIG[r.statut]?.bg || '#f3f4f6', color: STATUT_CONFIG[r.statut]?.color || '#6b7280' }}>
                              {r.statut}
                            </span>
                            {r.sms_echec && (
                              <span title="SMS non livré — relance manuelle requise" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', whiteSpace: 'nowrap' }}>
                                ⚠ SMS non livré
                              </span>
                            )}
                            {isFixe(r.telephone) && <FixeBadge />}
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: r.nb_tentatives > 0 ? 'var(--blue)' : 'var(--muted)', fontSize: 13 }}>
                          {r.nb_tentatives ?? 0}
                          {r.duree_sec ? <span style={{ fontSize: 10, marginLeft: 4, color: '#9ca3af', fontWeight: 400 }}>{formatDuration(r.duree_sec)}</span> : null}
                        </td>
                        <td style={{ padding: '8px 10px', color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>{formatDateTime(r.dernier_appel)}</td>
                        <td style={{ padding: '8px 10px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12 }} title={r.resultat_ia || r.resultat || ''}>
                          {r.resultat_ia || r.resultat || '—'}
                        </td>
                        {/* Quick outcomes */}
                        <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 3 }}>
                            {r.statut !== 'Non répondu' && (
                              <button onClick={() => quickOutcome(r, 'Non répondu')} title="Non répondu" style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid #fde68a', background: '#fffbeb', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <PhoneOff size={12} style={{ color: '#92400e' }} />
                              </button>
                            )}
                            {r.statut !== 'Répondeur' && (
                              <button onClick={() => quickOutcome(r, 'Répondeur')} title="Répondeur" style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid #c4b5fd', background: '#f5f3ff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Voicemail size={12} style={{ color: '#5b21b6' }} />
                              </button>
                            )}
                            {r.statut !== 'Répondu SMS' && (
                              <button onClick={() => quickOutcome(r, 'Répondu SMS')} title="Répondu SMS" style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid #6ee7b7', background: '#ecfdf5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <UserCheck size={12} style={{ color: '#065f46' }} />
                              </button>
                            )}
                            {r.statut !== 'Répondu transfert' && (
                              <button onClick={() => quickOutcome(r, 'Répondu transfert')} title="Répondu transfert" style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid #a5f3fc', background: '#ecfeff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <ArrowRightCircle size={12} style={{ color: '#0e7490' }} />
                              </button>
                            )}
                            {r.dernier_appel && (
                              <button onClick={() => r.transcript ? setTranscriptTarget(r) : undefined} title={r.transcript ? 'Voir le transcript' : 'Transcript en cours…'} style={{ width: 26, height: 26, borderRadius: 7, border: `1px solid ${r.transcript ? '#c7d2fe' : '#e5e7eb'}`, background: r.transcript ? '#eef2ff' : '#f9fafb', cursor: r.transcript ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: r.transcript ? 1 : 0.45 }}>
                                <MessageSquare size={12} style={{ color: r.transcript ? '#6366f1' : '#9ca3af' }} />
                              </button>
                            )}
                          </div>
                        </td>
                        {/* Call + Edit + Delete */}
                        <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => handleCall(r)} disabled={!r.telephone || callingId === r.id || r.statut === 'Répondu SMS' || r.statut === 'Répondu transfert'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', background: callingId === r.id ? '#fffbeb' : '#4338ca', color: callingId === r.id ? '#b45309' : 'white', border: callingId === r.id ? '1px solid #fde68a' : 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: (!r.telephone || r.statut === 'Répondu SMS' || r.statut === 'Répondu transfert') ? 0.3 : 1, transition: 'all .15s', boxShadow: (!r.telephone || r.statut === 'Répondu SMS' || r.statut === 'Répondu transfert' || callingId === r.id) ? 'none' : '0 2px 6px rgba(67,56,202,.3)', whiteSpace: 'nowrap' }}>
                              {callingId === r.id ? <RefreshCw size={11} style={{ animation: 'spin .8s linear infinite' }} /> : <Phone size={11} />}
                              {callingId === r.id ? '…' : 'Appeler'}
                            </button>
                            <button onClick={() => setEditTarget(r)} style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 8px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', color: '#64748b' }}>
                              <Edit2 size={11} />
                            </button>
                            {confirmingDelete ? (
                              <div style={{ display: 'flex', gap: 3 }}>
                                <button onClick={() => handleDelete(r.id)} style={{ fontSize: 11, padding: '3px 8px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', color: '#dc2626', fontWeight: 700 }}>Oui</button>
                                <button onClick={() => setDeleteConfirm(null)} style={{ fontSize: 11, padding: '3px 8px', background: 'white', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--muted)' }}>Non</button>
                              </div>
                            ) : (
                              <button onClick={() => setDeleteConfirm(r.id)} title="Supprimer" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', display: 'flex', padding: 4, borderRadius: 6, opacity: 0.7 }} onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}>
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {historyPhone && <HistoryPanel telephone={historyPhone} token={token} onClose={() => setHistoryPhone(null)} />}
        {transcriptTarget && <TranscriptPanel relance={transcriptTarget} onClose={() => setTranscriptTarget(null)} />}
        {editTarget && <EditModal relance={editTarget} token={token} onClose={() => setEditTarget(null)} onSaved={u => { onRelanceUpdate(editTarget.id, u); setEditTarget(null); }} />}
      </div>
    );
  }

  // ── Campaign grid ─────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-up">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
          {batches.length} campagne{batches.length !== 1 ? 's' : ''} · {relances.length} contact{relances.length !== 1 ? 's' : ''} au total
        </p>
      </div>
      {batches.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>
          <Layers size={32} strokeWidth={1.5} style={{ opacity: .3, marginBottom: 12 }} />
          <p style={{ fontSize: 13, fontWeight: 600 }}>Aucune campagne</p>
          <p style={{ fontSize: 12, marginTop: 4 }}>Importez un fichier Excel pour créer votre première campagne.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {batches.map(b => {
            const rappelPct = b.total > 0 ? Math.round(((b.repondu_sms + b.repondu_transfert) / b.total) * 100) : 0;
            const hasNote = !!loadBatchNote(b.batch_id);
            const batchSmsFail = relances.filter(r => r.batch_id === b.batch_id && r.sms_echec).length;
            return (
              <div
                key={b.batch_id}
                onClick={() => setSelectedBatch(b.batch_id)}
                style={{ cursor: 'pointer', background: 'white', borderRadius: 14, border: '1px solid #e8edf2', borderTop: `3px solid ${rappelPct === 100 ? '#10b981' : '#4338ca'}`, padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,.05)', transition: 'box-shadow .15s, border-color .15s', position: 'relative' }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 24px rgba(67,56,202,.13)'; (e.currentTarget as HTMLDivElement).style.borderColor = '#c7d2fe'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(0,0,0,.05)'; (e.currentTarget as HTMLDivElement).style.borderColor = '#e8edf2'; }}
              >
                <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 5, alignItems: 'center' }}>
                  {batchSmsFail > 0 && <span title={`${batchSmsFail} SMS non livré(s)`} style={{ fontSize: 10.5, fontWeight: 700, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', padding: '1px 6px', borderRadius: 6 }}>⚠ {batchSmsFail}</span>}
                  {hasNote && <span style={{ fontSize: 13, opacity: .6 }} title="Note disponible">📝</span>}
                </div>
                <div style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 800, fontSize: 14, color: 'var(--text)', marginBottom: 3, paddingRight: 44 }}>
                  {b.batch_label || 'Campagne sans nom'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{formatDate(b.date_import)}</span>
                  <span>·</span>
                  <span>{b.total} contact{b.total !== 1 ? 's' : ''}</span>
                </div>
                {/* Progress bar */}
                <div style={{ height: 6, borderRadius: 3, background: '#f1f5f9', overflow: 'hidden', marginBottom: 12 }}>
                  <div style={{ height: '100%', width: `${rappelPct}%`, background: rappelPct === 100 ? '#22c55e' : '#6366f1', borderRadius: 3, transition: 'width .4s ease' }} />
                </div>
                {/* Stats pills */}
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                  {[
                    { label: 'Répondu SMS', count: b.repondu_sms, ...STATUT_CONFIG['Répondu SMS'] },
                    { label: 'Répondu transfert', count: b.repondu_transfert, ...STATUT_CONFIG['Répondu transfert'] },
                    { label: 'Non répondu', count: b.non_repondu, ...STATUT_CONFIG['Non répondu'] },
                    { label: 'Répondeur', count: b.repondeur, ...STATUT_CONFIG['Répondeur'] },
                    { label: 'À appeler', count: b.a_appeler, ...STATUT_CONFIG['À appeler'] },
                  ].filter(s => s.count > 0).map(s => (
                    <span key={s.label} style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.color, fontWeight: 600 }}>
                      {s.count} {s.label}
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: rappelPct === 100 ? '#16a34a' : '#6366f1' }}>{rappelPct}% traité</span>
                  <ChevronRight size={14} style={{ color: 'var(--muted)' }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────
export function RecouvrementView({ user }: { user: AuthUser }) {
  const [relances, setRelances]             = useState<Relance[]>([]);
  const [stats, setStats]                   = useState<RelancesStats>({ total: 0, a_appeler: 0, non_repondu: 0, repondeur: 0, repondu_sms: 0, repondu_transfert: 0 });
  const [batches, setBatches]               = useState<BatchGroup[]>([]);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState('');
  const [activeTab, setActiveTab]           = useState<'relances' | 'campagnes'>('relances');
  const [showImport, setShowImport]         = useState(false);
  const [showManual, setShowManual]         = useState(false);
  const [showOrthop, setShowOrthop]         = useState(false);
  const [editTarget, setEditTarget]         = useState<Relance | null>(null);
  const [filterStatut, setFilterStatut]     = useState('');
  const [vue, setVue]                       = useState<VueFiltre>('a_traiter');
  // Date observée par le bandeau d'activité — par défaut aujourd'hui (heure de Paris).
  const [jourFiltre, setJourFiltre]         = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }));
  const [search, setSearch]                 = useState('');
  const [sortByPriority, setSortByPriority] = useState(false);
  const [successMsg, setSuccessMsg]         = useState('');
  const [callMsg, setCallMsg]               = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [callingId, setCallingId]           = useState<number | null>(null);
  const [sendingId, setSendingId]           = useState<number | null>(null);
  const [bulkSend, setBulkSend]             = useState<{ total: number; done: number; sms: number; mail: number; echecs: number } | null>(null);
  // Batch calling
  const [selected, setSelected]             = useState<Set<number>>(new Set());
  const [batchSize, setBatchSize]           = useState(10);
  const [batch, setBatch]                   = useState<BatchState | null>(null);
  const cancelBatchRef                      = useRef(false);
  // Panels
  const [transcriptTarget, setTranscriptTarget] = useState<Relance | null>(null);
  const [historyPhone, setHistoryPhone]     = useState<string | null>(null);
  // Confirm delete
  const [deleteConfirm, setDeleteConfirm]   = useState<number | null>(null);
  // Bulk delete (sélection → suppression groupée)
  const [bulkDel, setBulkDel]               = useState<'idle' | 'confirm' | 'deleting'>('idle');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchRelances(user.token);
    setLoading(false);
    if (res) { setRelances(res.relances); setStats(res.stats); setBatches(res.batches || []); setError(''); }
    else setError('Impossible de charger les relances.');
  }, [user.token]);

  useEffect(() => { load(); }, [load]);

  // Le bandeau d'activité porte sur la date choisie (par défaut aujourd'hui).
  const aujourdhuiIso = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const vueMatch = (VUES.find(v => v.id === vue) ?? VUES[0]).match;

  /**
   * PÉRIMÈTRE DE L'ÉCRAN : la journée choisie, au sens de la DATE DU DERNIER APPEL —
   * « ce qui a été fait ce jour-là ». Tout en découle : compteurs du bandeau, pastilles de
   * filtre, tableau et bandeaux d'action.
   *
   * ⚠️ Cas des relances JAMAIS appelées : elles n'ont aucune date d'appel. Un cadrage strict
   * les ferait disparaître de l'écran — donc impossible de lancer une campagne juste après
   * l'avoir importée. Elles restent visibles sur AUJOURD'HUI uniquement, où elles
   * représentent le travail en cours ; sur une date passée, l'écran ne montre que ce qui a
   * réellement été fait ce jour-là.
   *
   * `jourFiltre` vide = aucune restriction de date (bouton « toutes dates »).
   */
  const scope = !jourFiltre ? relances : relances.filter(r => {
    const jour = jourLocal(r.dernier_appel);
    return jour ? jour === jourFiltre : jourFiltre === aujourdhuiIso;
  });

  const filtered = scope
    // La barre de filtres rapides pilote la liste ; le menu « Statut » affine en plus (ET).
    .filter(vueMatch)
    .filter(r => !filterStatut || r.statut === filterStatut)
    .filter(r => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (r.nom || '').toLowerCase().includes(q) || (r.telephone || '').replace(/\s/g, '').includes(q.replace(/\s/g, ''));
    })
    .sort((a, b) => {
      if (sortByPriority) return priorityScore(b) - priorityScore(a);
      return 0;
    });

  const repondus = stats.repondu_sms + stats.repondu_transfert;
  const tauxRappel = stats.total > 0 ? Math.round((repondus / stats.total) * 100) : 0;

  // Activité de la journée affichée. « appelées » exclut les relances jamais tentées
  // (visibles sur aujourd'hui au titre du travail restant, mais pas comptees comme faites).
  const duJour = scope;
  const jour = {
    appeles:    duJour.filter(r => (r.nb_tentatives ?? 0) > 0).length,
    repondu:    duJour.filter(r => r.statut === 'Répondu SMS' || r.statut === 'Répondu transfert').length,
    messagerie: duJour.filter(r => r.statut === 'Répondeur').length,
    raccroche:  duJour.filter(r => r.statut === 'Raccroché').length,
    nonRepondu: duJour.filter(r => r.statut === 'Non répondu').length,
    smsLivres:  duJour.filter(r => smsEtat(r) === 'livre').length,
    smsRates:   duJour.filter(smsNonRecu).length,
    // Messageries atteintes sans message laissé — le trou que l'agent laisse quand
    // la détection EL échoue et qu'il ne récite pas le message lui-même.
    vocalManquant: duJour.filter(r => r.vocal_statut === 'non_depose').length,
  };
  // Clics sur les liens du mail, parmi les patientes appelées ce jour-là. Le clic arrive
  // souvent plusieurs jours après l'appel : on compte donc la COHORTE du jour, quelle que
  // soit la date du clic — « sur les 163 appelées ce jour-là, 61 ont cliqué depuis ».
  const mailsCliques = duJour.filter(r => r.email_statut === 'clique').length;
  // Bandeaux d'action : n'apparaissent que s'il y a réellement quelque chose à faire,
  // et uniquement sur le périmètre de la journée affichée.
  const aVerifier = scope.filter(r => r.ordonnance_deja_envoyee);
  const enEchec   = scope.filter(r => r.echec_motif);
  const batchCandidates = filtered.filter(r => selected.has(r.id) && r.telephone && r.statut !== 'Répondu SMS' && r.statut !== 'Répondu transfert');
  // Envoi SMS + mail : toute ligne selectionnee disposant d'au moins un canal.
  const sendCandidates  = filtered.filter(r => selected.has(r.id) && (r.email || r.telephone));

  function toggleSelect(id: number) { setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  // Sélectionne TOUTES les lignes affichées (filtrées). Sert à l'appel en lot (re-filtré
  // sur les appelables via batchCandidates) ET à la suppression groupée (« vider la liste »).
  function selectAll() {
    setSelected(new Set(filtered.map(r => r.id)));
  }
  function clearSelect() { setSelected(new Set()); setBulkDel('idle'); }

  // Lance tous les contacts sélectionnés avec AU PLUS `batchSize` appels actifs à la fois.
  // Concurrence PRÉCISE : chaque slot attend la FIN RÉELLE de son appel (statut EL) avant
  // d'en lancer un nouveau → dès qu'un appel se termine, le suivant part immédiatement.
  async function runBatch() {
    const candidates = batchCandidates;
    if (candidates.length === 0) return;
    cancelBatchRef.current = false;
    const total = candidates.length;
    setBatch({ done: 0, total, currentName: '', errors: 0, finished: false, active: 0 });
    let done = 0, errors = 0, active = 0, idx = 0;
    const concurrency = Math.min(batchSize, candidates.length);
    async function worker() {
      while (!cancelBatchRef.current) {
        const myIdx = idx++;
        if (myIdx >= candidates.length) return;
        const r = candidates[myIdx];
        active++;
        setBatch(p => p ? { ...p, active, currentName: r.nom || r.telephone || '…' } : p);
        const res = await triggerOutboundCall(user.token, r);
        if (res.ok) {
          setRelances(prev => prev.filter(x => x.id !== r.id));
          // garde le slot occupé jusqu'à la fin réelle de l'appel
          if (res.conversation_id) await waitCallEnd(user.token, res.conversation_id, () => cancelBatchRef.current);
        } else {
          errors++;
        }
        active--;
        done++;
        setBatch(p => p ? { ...p, active, done, errors } : p);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    setBatch(p => p ? { ...p, finished: true } : p);
    setSelected(new Set());
  }

  async function handleCall(r: Relance) {
    if (!r.telephone) return;
    setCallingId(r.id);
    setCallMsg(null);
    const res = await triggerOutboundCall(user.token, r);
    if (res.ok) {
      setRelances(prev => prev.filter(x => x.id !== r.id));
      setCallMsg({ type: 'success', text: `✅ Appel lancé — ${r.nom || r.telephone}` });
    } else {
      setCallMsg({ type: 'error', text: `❌ Échec du déclenchement — voir « À suivre » après actualisation.` });
    }
    setCallingId(null);
    setTimeout(() => setCallMsg(null), 8000);
  }

  async function quickOutcome(r: Relance, statut: Relance['statut']) {
    const ok = await updateRelance(user.token, r.id, { statut });
    if (ok) setRelances(prev => prev.map(x => x.id === r.id ? { ...x, statut } : x));
  }

  // Relance tous les appels d'une liste (ex. erreurs de lancement de la dernière campagne), séquentiellement.
  async function recallAll(list: Relance[]) {
    for (const r of list) { if (!r.telephone) continue; await handleCall(r); }
  }

  // « Marquer vérifié » : l'équipe a contrôlé le dossier → on lève le flag ordonnance_deja_envoyee.
  /**
   * Envoi SMS + mail en lot sur la sélection. Concurrence volontairement basse (4) :
   * chaque envoi déclenche deux appels API Brevo, inutile de les saturer — et une
   * centaine de lignes passe malgré tout en moins d'une minute.
   */
  async function sendBulk() {
    const cibles = filtered.filter(r => selected.has(r.id) && (r.email || r.telephone));
    if (!cibles.length) return;
    setBulkSend({ total: cibles.length, done: 0, sms: 0, mail: 0, echecs: 0 });
    let i = 0, sms = 0, mail = 0, echecs = 0, done = 0;
    const worker = async () => {
      while (i < cibles.length) {
        const r = cibles[i++];
        const res = await sendRelance(user.token, r.id);
        if (!res.ok) echecs++;
        else {
          if (res.sms === 'envoye') sms++;
          if (res.mail === 'envoye') mail++;
          if (res.sms === 'echec_envoi' || res.mail === 'echec_envoi') echecs++;
        }
        done++;
        setBulkSend({ total: cibles.length, done, sms, mail, echecs });
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, cibles.length) }, worker));
    setBulkSend(null);
    clearSelect();
    setCallMsg({
      type: echecs ? 'error' : 'success',
      text: `${done} relance(s) traitée(s) : ${sms} SMS, ${mail} mail(s)` + (echecs ? `, ${echecs} échec(s).` : '.'),
    });
    load();
  }

  // Envoi manuel du SMS + mail, sans appel. Utile après plusieurs tentatives infructueuses.
  async function handleSend(r: Relance) {
    setSendingId(r.id);
    const res = await sendRelance(user.token, r.id);
    setSendingId(null);
    if (!res.ok) { setCallMsg({ type: 'error', text: res.erreur || 'Envoi impossible.' }); return; }
    const parts: string[] = [];
    if (res.sms === 'envoye') parts.push('SMS envoyé');
    else if (res.sms === 'echec_envoi') parts.push('SMS refusé par Brevo');
    else if (res.sms === 'non_applicable') parts.push('pas de SMS (numéro fixe)');
    if (res.mail === 'envoye') parts.push('mail envoyé');
    else if (res.mail === 'echec_envoi') parts.push('mail refusé par Brevo');
    else if (res.mail === 'non_applicable') parts.push('pas de mail (adresse absente)');
    const echec = res.sms === 'echec_envoi' || res.mail === 'echec_envoi';
    setCallMsg({ type: echec ? 'error' : 'success', text: `${r.prenom || ''} ${r.nom || ''}`.trim() + ' : ' + parts.join(', ') + '.' });
    load();
  }

  async function markOrdoVerified(r: Relance) {
    const ok = await updateRelance(user.token, r.id, { ordonnance_deja_envoyee: false });
    if (ok) setRelances(prev => prev.map(x => x.id === r.id ? { ...x, ordonnance_deja_envoyee: false } : x));
  }

  async function handleDelete(id: number) {
    const ok = await deleteRelance(user.token, id);
    if (ok) { setRelances(prev => prev.filter(r => r.id !== id)); setSelected(p => { const n = new Set(p); n.delete(id); return n; }); }
    setDeleteConfirm(null);
  }

  async function handleBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkDel('deleting');
    const res = await deleteRelancesBulk(user.token, ids);
    if (res.ok) {
      const del = new Set(ids);
      setRelances(prev => prev.filter(r => !del.has(r.id)));
      clearSelect();
      setSuccessMsg(`${res.count || ids.length} relance(s) supprimée(s).`);
      setTimeout(() => setSuccessMsg(''), 4000);
      load();
    } else {
      setError('Échec de la suppression groupée.');
      setBulkDel('idle');
    }
  }

  function exportCSV() {
    const cols: (keyof Relance)[] = ['id', 'nom', 'telephone', 'date_echeance', 'statut', 'nb_tentatives', 'dernier_appel', 'resultat_ia', 'sentiment', 'notes', 'batch_label'];
    const header = ['ID', 'Nom', 'Téléphone', 'Échéance', 'Statut', 'Tentatives', 'Dernier appel', 'Résultat IA', 'Sentiment', 'Notes', 'Campagne'].join(';');
    const rows = filtered.map(r => cols.map(c => { const v = r[c]; if (v === null || v === undefined) return ''; const s = String(v); return s.includes(';') || s.includes('"') ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';'));
    const csv = '﻿' + [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `relances_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  function handleEditSaved(id: number, updates: Partial<Relance>) {
    setRelances(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
    setEditTarget(null); load();
  }

  const noneSelected = selected.size === 0;

  return (
    <div className="animate-fade-up">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>Gestion des relances · Agent sortant Amélie</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={exportCSV} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: 'white', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>
            <Download size={13} /> Export CSV
          </button>
          <button className="btn btn-ghost" onClick={load} disabled={loading} style={{ padding: '7px 12px' }}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualiser
          </button>
          <button onClick={() => setShowManual(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'white', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>
            + Ajouter
          </button>
          <button onClick={() => setShowImport(true)} title="Importer un fichier Excel exporté depuis ORTHOP" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'white', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>
            <Upload size={14} /> Importer Excel
          </button>
          <button className="btn btn-primary" onClick={() => setShowOrthop(true)} title="Récupérer la liste directement depuis ORTHOP, sans export Excel">
            <CloudDownload size={14} /> Extraire depuis ORTHOP
          </button>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 12, padding: 4, gap: 2 }}>
          {([
            { id: 'relances' as const, label: 'Relances', count: relances.length },
            { id: 'campagnes' as const, label: 'Campagnes', count: batches.length, icon: <Layers size={13} /> },
          ]).map(tab => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '7px 18px', background: active ? 'white' : 'transparent',
                  border: 'none', borderRadius: 9, fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  color: active ? '#4338ca' : '#64748b',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                  transition: 'all .18s', fontFamily: 'Lexend,sans-serif',
                  boxShadow: active ? '0 1px 4px rgba(0,0,0,.1)' : 'none',
                }}
              >
                {tab.icon}
                {tab.label}
                {tab.count > 0 && (
                  <span style={{
                    fontSize: 10.5, fontWeight: 700, fontFamily: 'inherit',
                    background: active ? '#ede9fe' : '#e2e8f0',
                    color: active ? '#4338ca' : '#64748b',
                    padding: '1px 7px', borderRadius: 10,
                  }}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Campagnes tab ───────────────────────────────────────────────────── */}
      {activeTab === 'campagnes' && (
        <CampagnesView
          batches={batches}
          relances={relances}
          token={user.token}
          onRelanceUpdate={(id, u) => setRelances(prev => prev.map(r => r.id === id ? { ...r, ...u } : r))}
          onRelanceDelete={id => setRelances(prev => prev.filter(r => r.id !== id))}
        />
      )}

      {/* ── Relances tab ────────────────────────────────────────────────────── */}
      {activeTab === 'relances' && (
        <>
          {/* ── Aujourd'hui : une seule ligne pour piloter la campagne en cours ── */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: '11px 16px', marginBottom: 12, boxShadow: 'var(--shadow-sm)' }}>
            {/* Date observée : par défaut aujourd'hui, modifiable pour revoir une journée passée. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 16, marginRight: 16, borderRight: '1px solid #eef2f6' }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.5px', fontFamily: 'Lexend,sans-serif' }}>
                {!jourFiltre ? 'Toutes dates' : jourFiltre === aujourdhuiIso ? "Aujourd'hui" : 'Appels du'}
              </span>
              <input
                type="date"
                value={jourFiltre}
                onChange={e => setJourFiltre(e.target.value)}
                title="Journée affichée — date du dernier appel. Les relances jamais appelées restent visibles sur aujourd'hui."
                style={{ padding: '3px 7px', borderRadius: 7, border: '1px solid var(--border)', fontSize: 11.5, color: 'var(--text)', background: 'white', outline: 'none', fontFamily: 'inherit', cursor: 'pointer' }}
              />
              {jourFiltre && jourFiltre !== aujourdhuiIso && (
                <button onClick={() => setJourFiltre(aujourdhuiIso)} title="Revenir à aujourd'hui"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--blue)', fontSize: 11, fontWeight: 700, padding: 0 }}>
                  aujourd'hui
                </button>
              )}
              {/* Échappatoire : sans elle, on n'aurait plus accès à l'ensemble des relances. */}
              <button onClick={() => setJourFiltre(jourFiltre ? '' : aujourdhuiIso)}
                title={jourFiltre ? 'Afficher toutes les relances, sans filtre de date' : 'Revenir à une seule journée'}
                style={{ background: !jourFiltre ? '#eef2ff' : 'none', border: !jourFiltre ? '1px solid #c7d2fe' : '1px solid var(--border)', borderRadius: 7, cursor: 'pointer', color: !jourFiltre ? '#4338ca' : 'var(--muted)', fontSize: 10.5, fontWeight: 700, padding: '3px 8px' }}>
                {jourFiltre ? 'toutes dates' : 'une journée'}
              </button>
            </div>
            {/* Chaque compteur est cliquable : il applique le filtre correspondant au tableau. */}
            {([
              { label: 'appelées',      value: jour.appeles,    color: '#334155', vue: 'tout' as VueFiltre,          statut: '' },
              { label: 'répondu',       value: jour.repondu,    color: '#047857', vue: 'tout' as VueFiltre,          statut: 'Répondu SMS' },
              { label: 'messagerie',    value: jour.messagerie, color: '#6d28d9', vue: 'messagerie' as VueFiltre,    statut: '' },
              { label: 'raccroché',     value: jour.raccroche,  color: '#9f1239', vue: 'raccroche' as VueFiltre,     statut: '' },
              { label: 'sans réponse',  value: jour.nonRepondu, color: '#b45309', vue: 'tout' as VueFiltre,          statut: 'Non répondu' },
              { label: 'SMS livrés',    value: jour.smsLivres,  color: '#1d4ed8', vue: 'tout' as VueFiltre,          statut: '' },
              { label: 'SMS non reçus', value: jour.smsRates,   color: '#b91c1c', vue: 'sms_non_livre' as VueFiltre, statut: '' },
              { label: 'vocaux manquants', value: jour.vocalManquant, color: '#b91c1c', vue: 'vocal_manquant' as VueFiltre, statut: '' },
            ]).map((k, i, arr) => (
              <button
                key={k.label}
                onClick={() => { setVue(k.vue); setFilterStatut(k.statut); }}
                title={`Afficher : ${k.label}`}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: 6, paddingRight: 16, marginRight: 16,
                  borderRight: i < arr.length - 1 ? '1px solid #eef2f6' : 'none',
                  background: 'none', border: 'none', borderRadius: 0, cursor: 'pointer',
                  padding: '2px 16px 2px 0', font: 'inherit', textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 21, fontWeight: 800, color: k.color, fontFamily: 'Lexend,sans-serif', lineHeight: 1 }}>{k.value}</span>
                <span style={{ fontSize: 11.5, color: '#64748b', textDecoration: 'underline', textDecorationColor: '#e2e8f0', textUnderlineOffset: 3 }}>{k.label}</span>
              </button>
            ))}
            <button
              onClick={() => { setVue('mail_clique'); setFilterStatut(''); }}
              title="Patientes ayant cliqué un lien du mail de relance (toutes campagnes — un clic arrive souvent plusieurs jours après l'appel)"
              style={{ display: 'flex', alignItems: 'baseline', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 2, font: 'inherit' }}
            >
              <span style={{ fontSize: 21, fontWeight: 800, color: '#15803d', fontFamily: 'Lexend,sans-serif', lineHeight: 1 }}>{mailsCliques}</span>
              <span style={{ fontSize: 11.5, color: '#64748b', textDecoration: 'underline', textDecorationColor: '#e2e8f0', textUnderlineOffset: 3 }}>mails cliqués</span>
            </button>
            <div style={{ flex: 1, minWidth: 12 }} />
            <span style={{ fontSize: 11.5, color: '#94a3b8', whiteSpace: 'nowrap' }}>
              {scope.length} relance{scope.length !== 1 ? 's' : ''}{jourFiltre ? ' ce jour' : ''}
              {!jourFiltre && ` · ${tauxRappel}% résolues`}
            </span>
          </div>

          {/* ── Filtres rapides : remplacent les cartes KPI et l'onglet « Suivi » ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {VUES.map(v => {
              const n = scope.filter(v.match).length;   // comptes sur la journée affichée
              const active = vue === v.id;
              const alerte = !!v.alerte && n > 0;
              return (
                <button key={v.id} onClick={() => setVue(v.id)} title={v.title} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 13px',
                  borderRadius: 20, fontSize: 12.5, fontWeight: active ? 700 : 500, cursor: 'pointer',
                  fontFamily: 'Lexend,sans-serif', transition: 'all .15s',
                  background: active ? (alerte ? '#b91c1c' : '#4338ca') : 'white',
                  color: active ? 'white' : (alerte ? '#b91c1c' : 'var(--text)'),
                  border: `1px solid ${active ? 'transparent' : (alerte ? '#fecaca' : 'var(--border)')}`,
                }}>
                  {v.label}
                  <span style={{
                    fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 9,
                    background: active ? 'rgba(255,255,255,.22)' : (alerte ? '#fef2f2' : '#f1f5f9'),
                    color: active ? 'white' : (alerte ? '#b91c1c' : '#64748b'),
                  }}>{n}</span>
                </button>
              );
            })}
          </div>

          {/* ── Bandeaux d'action : visibles uniquement s'il y a à faire ────── */}
          {aVerifier.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <AlertCircle size={15} style={{ color: '#b45309', flexShrink: 0 }} />
              <p style={{ fontSize: 12.5, color: '#92400e', margin: 0, flex: 1 }}>
                <strong>{aVerifier.length}</strong> patiente{aVerifier.length > 1 ? 's affirment' : ' affirme'} avoir déjà envoyé son ordonnance — à vérifier avant de relancer.
              </p>
              <button onClick={() => setVue('deja_envoyee')} style={{ padding: '5px 12px', background: 'white', border: '1px solid #fde68a', borderRadius: 7, fontSize: 12, fontWeight: 700, color: '#b45309', cursor: 'pointer' }}>Voir la liste</button>
            </div>
          )}
          {enEchec.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <AlertCircle size={15} style={{ color: '#b91c1c', flexShrink: 0 }} />
              <p style={{ fontSize: 12.5, color: '#991b1b', margin: 0, flex: 1 }}>
                <strong>{enEchec.length}</strong> appel{enEchec.length > 1 ? 's' : ''} n'{enEchec.length > 1 ? 'ont' : 'a'} pas pu être lancé{enEchec.length > 1 ? 's' : ''}.
              </p>
              <button onClick={() => recallAll(enEchec)} style={{ padding: '5px 12px', background: '#b91c1c', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, color: 'white', cursor: 'pointer' }}>Tout relancer</button>
              <button onClick={() => setVue('echec_appel')} style={{ padding: '5px 12px', background: 'white', border: '1px solid #fecaca', borderRadius: 7, fontSize: 12, fontWeight: 700, color: '#b91c1c', cursor: 'pointer' }}>Voir</button>
            </div>
          )}

          {/* ── Toasts ─────────────────────────────────────────────────────── */}
          {successMsg && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, marginBottom: 12 }}>
              <CheckCircle size={14} style={{ color: '#16a34a', flexShrink: 0 }} />
              <p style={{ fontSize: 12, color: '#15803d', margin: 0 }}>{successMsg}</p>
              <button onClick={() => setSuccessMsg('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#86efac', display: 'flex' }}><X size={12} /></button>
            </div>
          )}
          {callMsg && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: callMsg.type === 'success' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${callMsg.type === 'success' ? '#86efac' : '#fecaca'}`, borderRadius: 8, marginBottom: 12 }}>
              <p style={{ fontSize: 12, color: callMsg.type === 'success' ? '#15803d' : '#dc2626', margin: 0 }}>{callMsg.text}</p>
              <button onClick={() => setCallMsg(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex' }}><X size={12} /></button>
            </div>
          )}
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 12 }}>
              <AlertCircle size={14} style={{ color: '#dc2626', flexShrink: 0 }} /><p style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{error}</p>
            </div>
          )}

          {/* ── Toolbar ────────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            {!noneSelected ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: '#eef2ff', borderRadius: 10, border: '1px solid #c7d2fe', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#4f46e5' }}>{selected.size} sélectionné(s)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <label style={{ fontSize: 11, color: '#4f46e5' }}>Max simultanés :</label>
                  <select value={batchSize} onChange={e => setBatchSize(Number(e.target.value))} title="Nombre maximum d'appels actifs en parallèle. Un nouvel appel part dès qu'un précédent se termine. Mettre 1 pour tester un appel à la fois." style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, border: '1px solid #c7d2fe', background: 'white', color: '#4f46e5', cursor: 'pointer', outline: 'none' }}>
                    <option value={1}>1 (test)</option>
                    <option value={2}>2</option>
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={15}>15</option>
                    <option value={20}>20</option>
                  </select>
                </div>
                <button onClick={runBatch} disabled={batchCandidates.length === 0} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', background: '#4f46e5', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, color: 'white', cursor: 'pointer' }}>
                  <Play size={11} /> Appeler {batchCandidates.length} (≤{batchSize} actifs)
                </button>
                {/* Envoi SMS + mail en lot, sans appel. */}
                <button onClick={sendBulk} disabled={!!bulkSend || sendCandidates.length === 0}
                  title="Envoyer le SMS et le mail de relance aux lignes sélectionnées, sans passer d'appel"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', background: bulkSend ? '#fffbeb' : 'white', border: `1px solid ${bulkSend ? '#fde68a' : '#c7d2fe'}`, borderRadius: 7, fontSize: 12, fontWeight: 700, color: bulkSend ? '#b45309' : '#4338ca', cursor: 'pointer', opacity: sendCandidates.length === 0 ? 0.4 : 1 }}>
                  {bulkSend
                    ? <><RefreshCw size={11} style={{ animation: 'spin .8s linear infinite' }} /> {bulkSend.done}/{bulkSend.total}</>
                    : <><Send size={11} /> SMS + mail ({sendCandidates.length})</>}
                </button>
                {bulkDel === 'confirm' ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 700 }}>Supprimer {selected.size} définitivement ?</span>
                    <button onClick={handleBulkDelete} style={{ padding: '5px 10px', background: '#dc2626', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, color: 'white', cursor: 'pointer' }}>Oui, supprimer</button>
                    <button onClick={() => setBulkDel('idle')} style={{ padding: '5px 10px', background: 'white', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>Annuler</button>
                  </span>
                ) : (
                  <button onClick={() => setBulkDel('confirm')} disabled={bulkDel === 'deleting'} title="Supprimer définitivement les relances sélectionnées" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, fontSize: 12, fontWeight: 700, color: '#dc2626', cursor: 'pointer' }}>
                    <Trash2 size={12} /> {bulkDel === 'deleting' ? 'Suppression…' : `Supprimer ${selected.size}`}
                  </button>
                )}
                <button onClick={clearSelect} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4f46e5', display: 'flex' }}><X size={14} /></button>
              </div>
            ) : (
              <button onClick={selectAll} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: 'white', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>
                <CheckSquare size={13} /> Tout sélectionner
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={() => setSortByPriority(p => !p)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: sortByPriority ? '#eef2ff' : 'white', border: `1px solid ${sortByPriority ? '#c7d2fe' : 'var(--border)'}`, borderRadius: 8, fontSize: 12, fontWeight: 600, color: sortByPriority ? '#4f46e5' : 'var(--text)', cursor: 'pointer' }}>
              <TrendingUp size={13} /> Priorité
            </button>
            <select value={filterStatut} onChange={e => setFilterStatut(e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, color: 'var(--text)', background: 'white', cursor: 'pointer', outline: 'none' }}>
              <option value="">À traiter (par défaut)</option>
              {Object.keys(STATUT_CONFIG).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div style={{ position: 'relative' }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nom / téléphone…" style={{ padding: '6px 10px 6px 30px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, color: 'var(--text)', width: 190, outline: 'none' }} />
              <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 13, pointerEvents: 'none' }}>🔍</span>
            </div>
          </div>

          {/* Count */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {!loading && <>{filtered.length} relance{filtered.length !== 1 ? 's' : ''}{filtered.length !== relances.length ? ` / ${relances.length} total` : ''}</>}
            </span>
          </div>

          {/* ── Table ──────────────────────────────────────────────────────── */}
          <div style={{ background: 'white', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>
                <RefreshCw size={24} style={{ animation: 'spin .8s linear infinite', color: 'var(--blue)', marginBottom: 10 }} />
                <p style={{ fontSize: 13 }}>Chargement…</p>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>
                <FileText size={28} strokeWidth={1.5} style={{ opacity: .4, marginBottom: 10 }} />
                <p style={{ fontSize: 13 }}>{filterStatut || search || vue !== 'a_traiter' ? 'Aucune relance pour ces filtres.' : relances.length > 0 ? 'Tout est traité 🎉 — cliquez « Tout » pour revoir l’ensemble.' : 'Aucune relance — importez un fichier Excel.'}</p>
                {!filterStatut && !search && vue === 'a_traiter' && relances.length === 0 && <button className="btn btn-primary" onClick={() => setShowImport(true)} style={{ marginTop: 12 }}><Upload size={14} /> Importer</button>}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e8edf2' }}>
                      {['', 'Pri.', 'Nom', 'Téléphone', 'Échéance', 'Statut', 'SMS / Mail / Vocal', 'Appels', 'Dernier appel', 'Résultat', '', '', ''].map((h, i) => (
                        <th key={i} style={{ padding: '11px 10px', textAlign: 'left', fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 10.5, color: '#64748b', letterSpacing: '.5px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, i) => {
                      const echeanceOld = r.statut !== 'Répondu SMS' && r.statut !== 'Répondu transfert' && isEcheancePassed(r.date_echeance);
                      const score = priorityScore(r);
                      const isSelected = selected.has(r.id);
                      const confirmingDelete = deleteConfirm === r.id;
                      return (
                        <tr key={r.id}
                          style={{ borderBottom: i < filtered.length - 1 ? '1px solid #f1f5f9' : 'none', background: isSelected ? '#eff6ff' : 'transparent', borderLeft: `3px solid ${STATUT_CONFIG[r.statut]?.hex || '#e2e8f0'}` }}
                          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f9fafb'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = isSelected ? '#eff6ff' : 'transparent'; }}>
                          <td style={{ padding: '8px 10px', width: 32 }}>
                            <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(r.id)}
                              disabled={!r.telephone || r.statut === 'Répondu SMS' || r.statut === 'Répondu transfert'}
                              style={{ cursor: 'pointer', accentColor: '#6366f1' }} />
                          </td>
                          <td style={{ padding: '8px 6px', width: 36 }}>
                            {score > 0 && (
                              <div title={`Priorité ${score}`} style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center', width: 14 }}>
                                {[7, 5, 3].map(threshold => (
                                  <div key={threshold} style={{ width: 10, height: 3, borderRadius: 2, background: score >= threshold ? (threshold === 7 ? '#ef4444' : threshold === 5 ? '#f59e0b' : '#6366f1') : '#e2e8f0' }} />
                                ))}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nom || '—'}</td>
                          <td style={{ padding: '8px 10px' }}>
                            {r.telephone ? (
                              <button onClick={() => setHistoryPhone(r.telephone!)} style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline dotted', display: 'flex', alignItems: 'center', gap: 4 }}>
                                {r.telephone}
                                <ChevronRight size={11} style={{ color: 'var(--muted)' }} />
                              </button>
                            ) : '—'}
                          </td>
                          <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                            <span style={{ color: echeanceOld ? '#dc2626' : 'var(--muted)', fontWeight: echeanceOld ? 700 : 400, fontSize: 12 }}>
                              {echeanceOld ? '⚠ ' : ''}{formatDate(r.date_echeance)}
                            </span>
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                              <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 20, fontSize: 11.5, fontWeight: 700, fontFamily: 'Lexend,sans-serif', background: STATUT_CONFIG[r.statut]?.bg || '#f3f4f6', color: STATUT_CONFIG[r.statut]?.color || '#6b7280' }}>
                                {r.statut}
                              </span>
                              {/* Le badge SMS et le badge « fixe » vivent désormais dans la colonne SMS. */}
                              {r.ordonnance_deja_envoyee && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <span title="La patiente dit avoir déjà envoyé son ordonnance — à vérifier" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: '#fff7ed', color: '#b45309', border: '1px solid #fed7aa', whiteSpace: 'nowrap' }}>
                                    📄 Dit avoir envoyé
                                  </span>
                                  <button onClick={() => markOrdoVerified(r)} title="Dossier contrôlé — retirer ce signalement" style={{ padding: '1px 7px', borderRadius: 9, fontSize: 10, fontWeight: 700, background: 'white', color: '#047857', border: '1px solid #a7f3d0', cursor: 'pointer' }}>
                                    Vérifié
                                  </button>
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                              <SmsChip r={r} />
                              <MailChip r={r} />
                              <VocalChip r={r} />
                            </div>
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: r.nb_tentatives > 0 ? 'var(--blue)' : 'var(--muted)', fontSize: 13, fontFamily: 'Lexend,sans-serif' }}>
                            {r.nb_tentatives ?? 0}
                          </td>
                          <td style={{ padding: '8px 10px', color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                            {formatDateTime(r.dernier_appel)}
                            {r.duree_sec ? <span style={{ fontSize: 10, marginLeft: 5, color: '#9ca3af' }}>{formatDuration(r.duree_sec)}</span> : null}
                          </td>
                          <td style={{ padding: '8px 10px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12 }} title={r.resultat_ia || r.resultat || r.notes || ''}>
                            {r.resultat_ia || r.resultat || r.notes || '—'}
                          </td>
                          <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', gap: 3 }}>
                              {r.statut !== 'Non répondu' && (
                                <button onClick={() => quickOutcome(r, 'Non répondu')} title="Non répondu" style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid #fde68a', background: '#fffbeb', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <PhoneOff size={12} style={{ color: '#92400e' }} />
                                </button>
                              )}
                              {r.statut !== 'Répondeur' && (
                                <button onClick={() => quickOutcome(r, 'Répondeur')} title="Répondeur" style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid #c4b5fd', background: '#f5f3ff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <Voicemail size={12} style={{ color: '#5b21b6' }} />
                                </button>
                              )}
                              {r.statut !== 'Répondu SMS' && (
                                <button onClick={() => quickOutcome(r, 'Répondu SMS')} title="Répondu SMS" style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid #6ee7b7', background: '#ecfdf5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <UserCheck size={12} style={{ color: '#065f46' }} />
                                </button>
                              )}
                              {r.statut !== 'Répondu transfert' && (
                                <button onClick={() => quickOutcome(r, 'Répondu transfert')} title="Répondu transfert" style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid #a5f3fc', background: '#ecfeff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <ArrowRightCircle size={12} style={{ color: '#0e7490' }} />
                                </button>
                              )}
                              {r.dernier_appel && (
                                <button
                                  onClick={() => r.transcript ? setTranscriptTarget(r) : undefined}
                                  title={r.transcript ? 'Voir le transcript' : 'Transcript en cours de traitement…'}
                                  style={{ width: 26, height: 26, borderRadius: 7, border: `1px solid ${r.transcript ? '#c7d2fe' : '#e5e7eb'}`, background: r.transcript ? '#eef2ff' : '#f9fafb', cursor: r.transcript ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: r.transcript ? 1 : 0.45 }}>
                                  <MessageSquare size={12} style={{ color: r.transcript ? '#6366f1' : '#9ca3af' }} />
                                </button>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button onClick={() => handleCall(r)} disabled={!r.telephone || callingId === r.id || r.statut === 'Répondu SMS' || r.statut === 'Répondu transfert'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 11px', background: callingId === r.id ? '#fffbeb' : '#4338ca', color: callingId === r.id ? '#b45309' : 'white', border: callingId === r.id ? '1px solid #fde68a' : 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: (!r.telephone || r.statut === 'Répondu SMS' || r.statut === 'Répondu transfert') ? 0.3 : 1, transition: 'all .15s', boxShadow: (!r.telephone || r.statut === 'Répondu SMS' || r.statut === 'Répondu transfert' || callingId === r.id) ? 'none' : '0 2px 6px rgba(67,56,202,.35)', whiteSpace: 'nowrap' }}>
                                {callingId === r.id ? <RefreshCw size={11} style={{ animation: 'spin .8s linear infinite' }} /> : <Phone size={11} />}
                                {callingId === r.id ? '…' : 'Appeler'}
                              </button>
                              {/* Envoi SMS + mail sans appel — pour les dossiers injoignables. */}
                              <button
                                onClick={() => handleSend(r)}
                                disabled={sendingId === r.id || (!r.email && !r.telephone)}
                                title={`Envoyer le SMS et le mail de relance à ${r.prenom || ''} ${r.nom || ''}`.trim() + ' — sans passer d’appel'}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 9px', background: sendingId === r.id ? '#fffbeb' : 'white', border: `1px solid ${sendingId === r.id ? '#fde68a' : '#c7d2fe'}`, borderRadius: 8, fontSize: 11.5, fontWeight: 600, color: sendingId === r.id ? '#b45309' : '#4338ca', cursor: 'pointer', opacity: (!r.email && !r.telephone) ? 0.3 : 1, whiteSpace: 'nowrap' }}
                              >
                                {sendingId === r.id ? <RefreshCw size={11} style={{ animation: 'spin .8s linear infinite' }} /> : <Send size={11} />}
                              </button>
                              <button onClick={() => setEditTarget(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '5px 8px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 11.5, fontWeight: 500, color: '#64748b', cursor: 'pointer' }}>
                                <Edit2 size={11} />
                              </button>
                            </div>
                          </td>
                          <td style={{ padding: '8px 8px' }}>
                            {confirmingDelete ? (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button onClick={() => handleDelete(r.id)} style={{ fontSize: 11, padding: '3px 8px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', color: '#dc2626', fontWeight: 700 }}>Oui</button>
                                <button onClick={() => setDeleteConfirm(null)} style={{ fontSize: 11, padding: '3px 8px', background: 'white', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--muted)' }}>Non</button>
                              </div>
                            ) : (
                              <button onClick={() => setDeleteConfirm(r.id)} title="Supprimer" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', display: 'flex', padding: 4, borderRadius: 6, opacity: 0.7, transition: 'opacity .15s' }} onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}>
                                <Trash2 size={13} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Modals & Panels ───────────────────────────────────────────────────── */}
      {showImport && <ImportModal token={user.token} mode="import" onClose={() => setShowImport(false)} onSuccess={n => { setShowImport(false); setSuccessMsg(`${n} ligne(s) importée(s).`); load(); }} />}
      {showManual && <ImportModal token={user.token} mode="manual" onClose={() => setShowManual(false)} onSuccess={n => { setShowManual(false); setSuccessMsg(`${n} ligne(s) ajoutée(s).`); load(); }} />}
      {/* La fenêtre reste ouverte après l'extraction pour afficher le compte-rendu ;
          on recharge la liste en arrière-plan sans la fermer. */}
      {showOrthop && <OrthopModal token={user.token} onClose={() => setShowOrthop(false)} onSuccess={n => { if (n > 0) setSuccessMsg(`${n} relance(s) ajoutée(s) depuis ORTHOP.`); load(); }} />}
      {editTarget && <EditModal relance={editTarget} token={user.token} onClose={() => setEditTarget(null)} onSaved={u => handleEditSaved(editTarget.id, u)} />}
      {transcriptTarget && <TranscriptPanel relance={transcriptTarget} onClose={() => setTranscriptTarget(null)} />}
      {historyPhone && <HistoryPanel telephone={historyPhone} token={user.token} onClose={() => setHistoryPhone(null)} />}
      {batch && <BatchModal batch={batch} onClose={() => { setBatch(null); load(); }} onCancel={() => { cancelBatchRef.current = true; setBatch(p => p ? { ...p, finished: true } : p); }} />}
    </div>
  );
}
