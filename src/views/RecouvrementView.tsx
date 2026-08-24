import React, { useState, useEffect, useRef, useCallback } from 'react';
import { read, utils } from 'xlsx';
import {
  Upload, RefreshCw, Edit2, X, CheckCircle, FileText, AlertCircle,
  Phone, TrendingUp, PhoneCall, Clock, CheckSquare, Trash2, Download,
  MessageSquare, History, Play, Pause, ChevronRight,
  UserCheck, PhoneOff, ChevronLeft, Layers, Voicemail, ArrowRightCircle,
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

// ─── Status config ────────────────────────────────────────────────────────────
const STATUT_CONFIG: Record<string, { color: string; bg: string; hex: string; stripe: string }> = {
  'À appeler':         { color: '#1d4ed8', bg: '#eff6ff', hex: '#3b82f6', stripe: '#bfdbfe' },
  'Non répondu':       { color: '#92400e', bg: '#fffbeb', hex: '#f59e0b', stripe: '#fde68a' },
  'Répondeur':         { color: '#5b21b6', bg: '#f5f3ff', hex: '#8b5cf6', stripe: '#c4b5fd' },
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

function formatDate(s: string | null) {
  if (!s) return '—';
  try { const d = new Date(s + (s.includes('T') ? '' : 'T00:00:00')); return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch { return s; }
}

function formatDateTime(s: string | null) {
  if (!s) return '—';
  try { const d = new Date(s); return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch { return s; }
}

function formatDuration(sec: number | null | undefined) {
  if (!sec || sec === 0) return '—';
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m${sec % 60 > 0 ? String(sec % 60).padStart(2, '0') + 's' : ''}`;
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

/** Met un nom tout en majuscules en casse de titre : "MEZOUAR-CHABANE" → "Mezouar-Chabane" */
function titleCaseName(s: string): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(^|[\s'’.\-])([a-zà-ÿ])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

/** Convertit une date FR (Date, "DD/MM/YYYY", "DD-MM-YYYY") en ISO "YYYY-MM-DD" pour <input type=date>. */
function parseFrDate(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return v.toISOString().substring(0, 10);
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
interface EditableRow { _id: number; nom: string; prenom: string; telephone: string; date_echeance: string; }
let _rowSeq = 0;
function newRow(p?: Partial<EditableRow>): EditableRow { return { _id: ++_rowSeq, nom: '', prenom: '', telephone: '', date_echeance: '', ...p }; }
function parseToEditable(rawRows: object[]): EditableRow[] {
  return rawRows.map(r => {
    const row = r as Record<string, unknown>;
    const nom = String(row.nom ?? row.Nom ?? row['Nom de famille'] ?? row.NAME ?? row.name ?? '');
    const prenom = String(row.prenom ?? row.Prenom ?? row.Prénom ?? row['Prénom'] ?? row.firstname ?? row.firstName ?? '');
    const telephone = normalizePhoneFr(String(row.telephone ?? row.tel ?? row.phone ?? row.Telephone ?? row['Téléphone'] ?? row.numero ?? row.Numero ?? ''));
    const date_echeance = parseFrDate(row.date_echeance ?? row.dateEcheance ?? row['Date échéance'] ?? row["Date d'échéance"] ?? row['date echeance'] ?? row.date ?? '');
    return newRow({ nom, prenom, telephone, date_echeance });
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
      date_echeance: parseFrDate(row[dateCol]),
    }));
  }
  return out.length ? out : null;
}
const cellInput: React.CSSProperties = { width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12.5, outline: 'none', color: 'var(--text)', fontFamily: 'inherit', background: 'white', boxSizing: 'border-box' };

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
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];
        const parsed = parseOrthop(aoa) ?? parseToEditable(utils.sheet_to_json(ws, { defval: '' }) as object[]);
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
    <>
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
                {['nom', 'prenom', 'telephone', 'date_echeance'].map(c => <code key={c} style={{ fontSize: 11, background: 'var(--blue-light)', color: 'var(--blue)', padding: '2px 6px', borderRadius: 4 }}>{c}</code>)}
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
                <thead><tr style={{ background: '#f8fafc' }}>{['#', 'Nom', 'Prénom', 'Téléphone *', 'Date échéance', ''].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 11, color: 'var(--text)', letterSpacing: '.3px', textTransform: 'uppercase', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
                <tbody>{rows.map((r, i) => (
                  <tr key={r._id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '5px 10px', color: 'var(--muted)', fontSize: 11, width: 28 }}>{i + 1}</td>
                    <td style={{ padding: '4px 6px' }}><input style={cellInput} value={r.nom} onChange={e => upd(r._id, 'nom', e.target.value)} placeholder="Nom de famille" /></td>
                    <td style={{ padding: '4px 6px' }}><input style={cellInput} value={r.prenom} onChange={e => upd(r._id, 'prenom', e.target.value)} placeholder="Prénom" /></td>
                    <td style={{ padding: '4px 6px' }}><input style={{ ...cellInput, borderColor: !r.telephone.trim() ? '#fca5a5' : 'var(--border)' }} value={r.telephone} onChange={e => upd(r._id, 'telephone', e.target.value)} placeholder="+33612345678" /></td>
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
    </>
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
    <>
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
    </>
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
    <>
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
    </>
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
    <>
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
    </>
  );
}

// ─── Batch Progress Modal ─────────────────────────────────────────────────────
interface BatchState { done: number; total: number; currentName: string; errors: number; finished: boolean; active: number; }
function BatchModal({ batch, onClose, onCancel }: { batch: BatchState; onClose: () => void; onCancel: () => void }) {
  const pct = batch.total > 0 ? Math.round((batch.done / batch.total) * 100) : 0;
  return (
    <>
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
    </>
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

// ─── Numéros View ─────────────────────────────────────────────────────────────
interface PhoneGroup {
  telephone: string;
  nom: string;
  relances: Relance[];
  nb_campagnes: number;
  nb_tentatives: number;
  dernier_appel: string | null;
  statut: Relance['statut'];
}

function NumérosView({ relances, token }: { relances: Relance[]; token: string }) {
  const [search, setSearch] = React.useState('');
  const [historyPhone, setHistoryPhone] = React.useState<string | null>(null);

  const groups = React.useMemo<PhoneGroup[]>(() => {
    const map: Record<string, PhoneGroup> = {};
    relances.forEach(r => {
      const tel = r.telephone || '';
      if (!tel) return;
      if (!map[tel]) {
        map[tel] = { telephone: tel, nom: r.nom || '', relances: [], nb_campagnes: 0, nb_tentatives: 0, dernier_appel: null, statut: r.statut };
      }
      const g = map[tel];
      g.relances.push(r);
      g.nb_tentatives += r.nb_tentatives ?? 0;
      if (r.nom && !g.nom) g.nom = r.nom;
      if (r.dernier_appel && (!g.dernier_appel || r.dernier_appel > g.dernier_appel)) {
        g.dernier_appel = r.dernier_appel;
        g.statut = r.statut;
      }
      const batchIds = new Set(g.relances.map(x => x.batch_id).filter(Boolean));
      g.nb_campagnes = batchIds.size;
    });
    return Object.values(map).sort((a, b) => {
      if (!a.dernier_appel && !b.dernier_appel) return (a.nom || a.telephone).localeCompare(b.nom || b.telephone);
      if (!a.dernier_appel) return 1;
      if (!b.dernier_appel) return -1;
      return b.dernier_appel.localeCompare(a.dernier_appel);
    });
  }, [relances]);

  const filtered = groups.filter(g => {
    if (!search) return true;
    const q = search.toLowerCase();
    return g.telephone.replace(/\s/g, '').includes(q.replace(/\s/g, '')) || g.nom.toLowerCase().includes(q);
  });

  return (
    <div className="animate-fade-up">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
          {groups.length} numéro{groups.length !== 1 ? 's' : ''} unique{groups.length !== 1 ? 's' : ''} · {relances.filter(r => r.telephone).length} relance{relances.filter(r => r.telephone).length !== 1 ? 's' : ''} au total
        </p>
        <div style={{ position: 'relative' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrer par nom / numéro…" style={{ padding: '6px 10px 6px 30px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, color: 'var(--text)', width: 230, outline: 'none' }} />
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 13, pointerEvents: 'none' }}>🔍</span>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>
          <Phone size={32} strokeWidth={1.5} style={{ opacity: .3, marginBottom: 12 }} />
          <p style={{ fontSize: 13, fontWeight: 600 }}>Aucun numéro</p>
          <p style={{ fontSize: 12, marginTop: 4 }}>{search ? 'Aucun résultat pour cette recherche.' : 'Importez des relances pour voir les numéros ici.'}</p>
        </div>
      ) : (
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid var(--border)' }}>
                  {['Téléphone', 'Nom', 'Campagnes', 'Appels', 'Statut récent', 'Dernier appel', ''].map((h, i) => (
                    <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 11, color: 'var(--text)', letterSpacing: '.4px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((g, i) => {
                  const cfg = STATUT_CONFIG[g.statut] || { color: '#6b7280', bg: '#f3f4f6', hex: '#e2e8f0', stripe: '#e2e8f0' };
                  return (
                    <tr key={g.telephone}
                      style={{ borderBottom: i < filtered.length - 1 ? '1px solid #f1f5f9' : 'none', borderLeft: `3px solid ${STATUT_CONFIG[g.statut]?.hex || '#e2e8f0'}` }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#f9fafb'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                      <td style={{ padding: '9px 12px' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 12.5, color: 'var(--text)', fontWeight: 600 }}>{g.telephone}</span>
                      </td>
                      <td style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.nom || '—'}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                        {g.nb_campagnes > 0 ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: '#6366f1', background: '#eef2ff', padding: '2px 8px', borderRadius: 10 }}>
                            <Layers size={11} /> {g.nb_campagnes}
                          </span>
                        ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, fontSize: 13, color: g.nb_tentatives > 0 ? 'var(--blue)' : 'var(--muted)', fontFamily: 'Lexend,sans-serif' }}>{g.nb_tentatives}</td>
                      <td style={{ padding: '9px 12px' }}>
                        <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 20, fontSize: 11.5, fontWeight: 700, background: cfg.bg, color: cfg.color }}>{g.statut}</span>
                      </td>
                      <td style={{ padding: '9px 12px', color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>{formatDateTime(g.dernier_appel)}</td>
                      <td style={{ padding: '9px 10px' }}>
                        <button onClick={() => setHistoryPhone(g.telephone)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', background: '#eef2ff', color: '#4f46e5', border: '1px solid #c7d2fe', borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
                          <History size={11} /> Historique
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {historyPhone && <HistoryPanel telephone={historyPhone} token={token} onClose={() => setHistoryPhone(null)} />}
    </div>
  );
}

// ─── Suivi (appels sortants à suivre) ──────────────────────────────────────────
const CAMP_NONE = 'Sans campagne';

const suiviIconBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'white', color: 'var(--muted)', cursor: 'pointer' };

/** Une relance doit être suivie si le SMS a échoué, si sentiment négatif, ou si non répondu / répondeur. */
export function needsFollowUp(r: Relance): boolean {
  return !!r.echec_motif || r.sms_echec === true || r.sentiment === 'negatif' || r.statut === 'Non répondu' || r.ordonnance_deja_envoyee === true;
}

function SuiviView({ relances, callingId, onCall, onHistory, onTranscript, onRecallAll, onMarkVerified }: {
  relances: Relance[];
  callingId: number | null;
  onCall: (r: Relance) => void;
  onHistory: (phone: string) => void;
  onTranscript: (r: Relance) => void;
  onRecallAll: (list: Relance[]) => void;
  onMarkVerified: (r: Relance) => void;
}) {
  // Agrégats par campagne (batch_label) — triés : le plus « à suivre » en premier.
  const camp = (r: Relance) => r.batch_label || CAMP_NONE;
  const campaigns = [...new Set(relances.map(camp))].map(name => {
    const rs = relances.filter(r => camp(r) === name);
    return {
      name,
      total:      rs.length,
      repondu:    rs.filter(r => r.statut === 'Répondu SMS' || r.statut === 'Répondu transfert').length,
      aAppeler:   rs.filter(r => r.statut === 'À appeler').length,
      nonRepondu: rs.filter(r => r.statut === 'Non répondu').length,
      repondeur:  rs.filter(r => r.statut === 'Répondeur').length,
      smsEchec:   rs.filter(r => r.sms_echec === true).length,
      negatif:    rs.filter(r => r.sentiment === 'negatif').length,
      errs:       rs.filter(r => r.echec_motif).length,
    };
  }).sort((a, b) => (b.errs + b.smsEchec + b.negatif + b.nonRepondu + b.repondeur) - (a.errs + a.smsEchec + a.negatif + a.nonRepondu + a.repondeur));

  // Dernière campagne (import le plus récent) + ses erreurs de LANCEMENT — pour relancer
  let lastCampName = '', lastImp = '';
  for (const r of relances) { const imp = r.importe_le || ''; if (imp > lastImp) { lastImp = imp; lastCampName = r.batch_label || CAMP_NONE; } }
  const launchErrors = relances.filter(r => (r.batch_label || CAMP_NONE) === lastCampName && r.echec_motif === 'Échec déclenchement');
  const ordoAVerifier = relances.filter(r => r.ordonnance_deja_envoyee === true);

  // ── Vue d'ensemble : chiffres de ce qui s'est passé ──────────────────────────
  const total = relances.length;
  const n = (f: (r: Relance) => boolean) => relances.filter(f).length;
  const cnt = {
    aAppeler:   n(r => r.statut === 'À appeler'),
    nonRepondu: n(r => r.statut === 'Non répondu'),
    repondeur:  n(r => r.statut === 'Répondeur'),
    repSms:     n(r => r.statut === 'Répondu SMS'),
    repTransf:  n(r => r.statut === 'Répondu transfert'),
  };
  const resolus = cnt.repSms + cnt.repTransf;
  const appeles = n(r => (r.nb_tentatives || 0) > 0);
  const tauxResolution = total ? Math.round((resolus / total) * 100) : 0;

  const bigKpis = [
    { label: 'Relances',  value: total,        sub: 'au total',                              color: '#0f172a', bg: '#f1f5f9', icon: <Layers size={18} /> },
    { label: 'Appelés',   value: appeles,      sub: `${total - appeles} pas encore appelés`, color: '#1d4ed8', bg: '#eff6ff', icon: <PhoneCall size={18} /> },
    { label: 'Résolus',   value: resolus,      sub: `${tauxResolution}% de résolution`,      color: '#065f46', bg: '#ecfdf5', icon: <CheckCircle size={18} /> },
    { label: 'À appeler', value: cnt.aAppeler, sub: 'en attente',                            color: '#92400e', bg: '#fffbeb', icon: <Clock size={18} /> },
  ];
  const outcome = [
    { label: 'Répondu SMS',       value: cnt.repSms,     hex: STATUT_CONFIG['Répondu SMS'].hex,       color: STATUT_CONFIG['Répondu SMS'].color },
    { label: 'Répondu transfert', value: cnt.repTransf,  hex: STATUT_CONFIG['Répondu transfert'].hex, color: STATUT_CONFIG['Répondu transfert'].color },
    { label: 'Répondeur',         value: cnt.repondeur,  hex: STATUT_CONFIG['Répondeur'].hex,         color: STATUT_CONFIG['Répondeur'].color },
    { label: 'Non répondu',       value: cnt.nonRepondu, hex: STATUT_CONFIG['Non répondu'].hex,       color: STATUT_CONFIG['Non répondu'].color },
    { label: 'À appeler',         value: cnt.aAppeler,   hex: STATUT_CONFIG['À appeler'].hex,         color: STATUT_CONFIG['À appeler'].color },
  ];
  const attention = [
    { label: 'En échec',       value: n(r => !!r.echec_motif),           color: '#b91c1c', bg: '#fef2f2', icon: <AlertCircle size={15} /> },
    { label: 'SMS non livrés', value: n(r => r.sms_echec === true),      color: '#b91c1c', bg: '#fef2f2', icon: <MessageSquare size={15} /> },
    { label: 'Mécontents',     value: n(r => r.sentiment === 'negatif'), color: '#b91c1c', bg: '#fef2f2', icon: <PhoneCall size={15} /> },
    { label: 'Non répondus',   value: cnt.nonRepondu,                    color: '#92400e', bg: '#fffbeb', icon: <PhoneOff size={15} /> },
    { label: 'Déjà envoyée (à vérifier)', value: n(r => r.ordonnance_deja_envoyee === true), color: '#b45309', bg: '#fff7ed', icon: <FileText size={15} /> },
  ];

  return (
    <div className="animate-fade-in">
      {/* Vue d'ensemble — grands chiffres */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {bigKpis.map(c => (
          <div key={c.label} style={{ background: 'white', borderRadius: 14, padding: '16px 18px', border: '1px solid #e8edf2', boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.5px' }}>{c.label}</span>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: c.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.color, flexShrink: 0 }}>{c.icon}</div>
            </div>
            <div style={{ fontSize: 38, fontWeight: 800, color: c.color, fontFamily: 'Lexend,sans-serif', lineHeight: 1 }}>{c.value}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Résultats des appels — barre + légende chiffrée */}
      <div style={{ background: 'white', borderRadius: 14, padding: '16px 18px', border: '1px solid #e8edf2', boxShadow: '0 1px 4px rgba(0,0,0,.05)', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'Lexend,sans-serif', marginBottom: 12 }}>Résultats des appels</div>
        {total === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Aucune relance pour l'instant.</div>
        ) : (
          <>
            <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: '#eef2f6', marginBottom: 14 }}>
              {outcome.filter(o => o.value > 0).map(o => (
                <div key={o.label} title={`${o.label} : ${o.value}`} style={{ width: `${(o.value / total) * 100}%`, background: o.hex }} />
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              {outcome.map(o => (
                <div key={o.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: o.hex, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>{o.label}</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: o.color, fontFamily: 'Lexend,sans-serif' }}>{o.value}</span>
                  <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 34, textAlign: 'right' }}>{Math.round((o.value / total) * 100)}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Points d'attention */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
        {attention.map(a => (
          <div key={a.label} style={{ background: a.value > 0 ? a.bg : 'white', borderRadius: 12, padding: '10px 14px', border: `1px solid ${a.value > 0 ? a.color + '33' : '#e8edf2'}`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: a.value > 0 ? 'white' : '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: a.value > 0 ? a.color : '#cbd5e1', flexShrink: 0 }}>{a.icon}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: a.value > 0 ? a.color : '#cbd5e1', fontFamily: 'Lexend,sans-serif', lineHeight: 1 }}>{a.value}</div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Erreurs de LANCEMENT de la dernière campagne — pour relancer */}
      {launchErrors.length > 0 && (
        <div style={{ background: 'white', borderRadius: 13, border: '1px solid #fecaca', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.05)', marginBottom: 20 }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid #fee2e2', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#b91c1c', fontFamily: 'Lexend,sans-serif', display: 'flex', alignItems: 'center', gap: 6 }}><AlertCircle size={15} /> Erreurs de lancement — {lastCampName} ({launchErrors.length})</span>
            <button onClick={() => onRecallAll(launchErrors)} disabled={callingId !== null} style={{ fontSize: 12, fontWeight: 700, color: 'white', background: callingId !== null ? '#a5b4fc' : '#4338ca', border: 'none', borderRadius: 7, padding: '5px 12px', cursor: callingId !== null ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {callingId !== null ? <RefreshCw size={13} className="animate-spin" /> : <Phone size={13} />} Tout relancer ({launchErrors.length})
            </button>
          </div>
          {launchErrors.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: '1px solid #fef2f2' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{[r.prenom, r.nom].filter(Boolean).join(' ') || '—'} · {r.telephone || '—'} {isFixe(r.telephone) && <FixeBadge />}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{r.nb_tentatives} tentative{r.nb_tentatives > 1 ? 's' : ''} · dernier échec {formatDateTime(r.dernier_echec || r.dernier_appel)}</div>
              </div>
              {r.transcript && <button onClick={() => onTranscript(r)} title="Transcript" style={suiviIconBtn}><MessageSquare size={15} /></button>}
              {r.telephone && <button onClick={() => onHistory(r.telephone!)} title="Historique" style={suiviIconBtn}><History size={15} /></button>}
              {r.telephone && (
                <button onClick={() => onCall(r)} disabled={callingId === r.id} title="Relancer" style={{ ...suiviIconBtn, background: '#4338ca', color: 'white', borderColor: '#4338ca' }}>
                  {callingId === r.id ? <RefreshCw size={15} className="animate-spin" /> : <Phone size={15} />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* À vérifier — a dit avoir déjà envoyé son ordonnance */}
      {ordoAVerifier.length > 0 && (
        <div style={{ background: 'white', borderRadius: 13, border: '1px solid #fed7aa', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.05)', marginBottom: 20 }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid #ffedd5', background: '#fff7ed', display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileText size={15} style={{ color: '#b45309' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#b45309', fontFamily: 'Lexend,sans-serif' }}>À vérifier — a dit avoir déjà envoyé son ordonnance ({ordoAVerifier.length})</span>
          </div>
          {ordoAVerifier.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: '1px solid #fff7ed' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{[r.prenom, r.nom].filter(Boolean).join(' ') || '—'} · {r.telephone || '—'} {isFixe(r.telephone) && <FixeBadge />}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{r.batch_label || CAMP_NONE} · dernier appel {formatDateTime(r.dernier_appel)}</div>
              </div>
              {r.transcript && <button onClick={() => onTranscript(r)} title="Relire le transcript" style={suiviIconBtn}><MessageSquare size={15} /></button>}
              {r.telephone && <button onClick={() => onHistory(r.telephone!)} title="Historique du numéro" style={suiviIconBtn}><History size={15} /></button>}
              <button onClick={() => onMarkVerified(r)} title="Marquer comme vérifié (retire de la liste)" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: '#065f46', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 7, padding: '6px 11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <CheckCircle size={14} /> Vérifié
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Suivi par campagne */}
      {campaigns.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'Lexend,sans-serif', marginBottom: 10 }}>Suivi par campagne</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {campaigns.map(c => {
              const pct = c.total ? Math.round((c.repondu / c.total) * 100) : 0;
              const chips = ([
                c.errs       ? { label: `${c.errs} en échec`,                                    color: '#b91c1c', bg: '#fef2f2' } : null,
                c.smsEchec   ? { label: `${c.smsEchec} SMS non livré${c.smsEchec > 1 ? 's' : ''}`, color: '#b91c1c', bg: '#fef2f2' } : null,
                c.negatif    ? { label: `${c.negatif} mécontent${c.negatif > 1 ? 's' : ''}`,     color: '#b91c1c', bg: '#fef2f2' } : null,
                c.nonRepondu ? { label: `${c.nonRepondu} non répondu${c.nonRepondu > 1 ? 's' : ''}`, color: '#92400e', bg: '#fffbeb' } : null,
                c.repondeur  ? { label: `${c.repondeur} répondeur${c.repondeur > 1 ? 's' : ''}`,  color: '#5b21b6', bg: '#f5f3ff' } : null,
                c.aAppeler   ? { label: `${c.aAppeler} à appeler`,                                color: '#1d4ed8', bg: '#eff6ff' } : null,
              ].filter(Boolean)) as { label: string; color: string; bg: string }[];
              return (
                <div key={c.name} style={{ background: 'white', borderRadius: 13, padding: '14px 16px', border: '1px solid #e8edf2', boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{c.repondu}/{c.total} traités · {pct}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: '#eef2f6', overflow: 'hidden', marginBottom: 10 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#10b981' }} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {chips.length === 0
                      ? <span style={{ fontSize: 11, color: '#15803d', fontWeight: 600 }}>✓ Rien à suivre</span>
                      : chips.map((ch, i) => <span key={i} style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: ch.bg, color: ch.color, whiteSpace: 'nowrap' }}>{ch.label}</span>)}
                  </div>
                </div>
              );
            })}
          </div>
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
  const [activeTab, setActiveTab]           = useState<'relances' | 'suivi' | 'campagnes' | 'numeros'>('relances');
  const [showImport, setShowImport]         = useState(false);
  const [showManual, setShowManual]         = useState(false);
  const [editTarget, setEditTarget]         = useState<Relance | null>(null);
  const [filterStatut, setFilterStatut]     = useState('');
  const [filterToday, setFilterToday]       = useState(false);
  const [search, setSearch]                 = useState('');
  const [sortByPriority, setSortByPriority] = useState(false);
  const [successMsg, setSuccessMsg]         = useState('');
  const [callMsg, setCallMsg]               = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [callingId, setCallingId]           = useState<number | null>(null);
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

  const today = new Date().toDateString();
  // Statuts « traités » masqués par défaut dans la liste Relances : le patient a été
  // contacté (SMS envoyé) ou transféré → plus rien à appeler. Répondeur inclus (message
  // laissé + SMS envoyé). Ils restent visibles dans l'onglet Campagnes et via le filtre statut.
  const TRAITES = ['Répondu SMS', 'Répondu transfert', 'Répondeur'];
  const filtered = relances
    // Par défaut on masque les relances déjà traitées :
    // la liste ne montre que ce qui reste à faire.
    // Pour revoir les traitées (dont Répondeur), sélectionner leur statut dans le menu déroulant.
    .filter(r => filterStatut ? r.statut === filterStatut : !TRAITES.includes(r.statut))
    .filter(r => {
      if (!filterToday) return true;
      if (r.statut === 'Répondu SMS' || r.statut === 'Répondu transfert') return false;
      if (!r.dernier_appel) return true;
      return new Date(r.dernier_appel).toDateString() !== today;
    })
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
  const batchCandidates = filtered.filter(r => selected.has(r.id) && r.telephone && r.statut !== 'Répondu SMS' && r.statut !== 'Répondu transfert');

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
          <button className="btn btn-primary" onClick={() => setShowImport(true)}>
            <Upload size={14} /> Importer Excel
          </button>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 12, padding: 4, gap: 2 }}>
          {([
            { id: 'relances' as const, label: 'Relances', count: relances.length },
            { id: 'suivi' as const, label: 'Suivi', count: relances.filter(needsFollowUp).length, icon: <TrendingUp size={13} /> },
            { id: 'campagnes' as const, label: 'Campagnes', count: batches.length, icon: <Layers size={13} /> },
            { id: 'numeros' as const, label: 'Numéros', count: [...new Set(relances.map(r => r.telephone).filter(Boolean))].length, icon: <Phone size={13} /> },
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
                    background: tab.id === 'suivi' && tab.count > 0 ? '#fee2e2' : active ? '#ede9fe' : '#e2e8f0',
                    color: tab.id === 'suivi' && tab.count > 0 ? '#b91c1c' : active ? '#4338ca' : '#64748b',
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

      {/* ── Numéros tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'numeros' && (
        <NumérosView relances={relances} token={user.token} />
      )}

      {/* ── À suivre tab ────────────────────────────────────────────────────── */}
      {activeTab === 'suivi' && (
        <SuiviView
          relances={relances}
          callingId={callingId}
          onCall={handleCall}
          onHistory={setHistoryPhone}
          onTranscript={setTranscriptTarget}
          onRecallAll={recallAll}
          onMarkVerified={markOrdoVerified}
        />
      )}

      {/* ── Relances tab ────────────────────────────────────────────────────── */}
      {activeTab === 'relances' && (
        <>
          {/* ── KPI Strip ──────────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'À appeler', value: stats.a_appeler, sub: 'Pas encore contactés', color: '#1d4ed8', bg: '#eff6ff', icon: <Phone size={16} /> },
              { label: 'Répondus', value: stats.repondu_sms + stats.repondu_transfert, sub: `${tauxRappel}% de taux`, color: '#065f46', bg: '#ecfdf5', icon: <CheckCircle size={16} /> },
              { label: 'Non répondus', value: stats.non_repondu, sub: 'À relancer', color: '#92400e', bg: '#fffbeb', icon: <PhoneOff size={16} /> },
              { label: 'Répondeurs', value: stats.repondeur, sub: 'SMS envoyé', color: '#5b21b6', bg: '#f5f3ff', icon: <Voicemail size={16} /> },
            ].map(c => (
              <div key={c.label} style={{
                background: 'white', borderRadius: 13, padding: '14px 18px',
                border: '1px solid #e8edf2', borderTop: `3px solid ${c.color}`,
                boxShadow: '0 1px 4px rgba(0,0,0,.05)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.5px' }}>{c.label}</span>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: c.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.color, flexShrink: 0 }}>{c.icon}</div>
                </div>
                <div style={{ fontSize: 34, fontWeight: 800, color: c.color, fontFamily: 'Lexend,sans-serif', lineHeight: 1, marginBottom: 5 }}>{c.value}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.sub}</div>
              </div>
            ))}
          </div>

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
            <button onClick={() => setFilterToday(p => !p)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: filterToday ? '#fef3c7' : 'white', border: `1px solid ${filterToday ? '#fde68a' : 'var(--border)'}`, borderRadius: 8, fontSize: 12, fontWeight: 600, color: filterToday ? '#b45309' : 'var(--text)', cursor: 'pointer' }}>
              <Clock size={13} /> À appeler
            </button>
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
                <p style={{ fontSize: 13 }}>{filterStatut || search || filterToday ? 'Aucune relance pour ces filtres.' : relances.length > 0 ? 'Toutes les relances ont été traitées 🎉 (sélectionnez un statut pour les revoir).' : 'Aucune relance — importez un fichier Excel.'}</p>
                {!filterStatut && !search && !filterToday && relances.length === 0 && <button className="btn btn-primary" onClick={() => setShowImport(true)} style={{ marginTop: 12 }}><Upload size={14} /> Importer</button>}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e8edf2' }}>
                      {['', 'Pri.', 'Nom', 'Téléphone', 'Échéance', 'Statut', 'Appels', 'Dernier appel', 'Résultat', '', '', ''].map((h, i) => (
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
                              {r.sms_echec && (
                                <span title="SMS non livré — relance manuelle requise" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', whiteSpace: 'nowrap' }}>
                                  ⚠ SMS non livré
                                </span>
                              )}
                              {r.ordonnance_deja_envoyee && (
                                <span title="La patiente dit avoir déjà envoyé son ordonnance — à vérifier" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: '#fff7ed', color: '#b45309', border: '1px solid #fed7aa', whiteSpace: 'nowrap' }}>
                                  📄 Dit avoir envoyé
                                </span>
                              )}
                              {isFixe(r.telephone) && <FixeBadge />}
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
      {editTarget && <EditModal relance={editTarget} token={user.token} onClose={() => setEditTarget(null)} onSaved={u => handleEditSaved(editTarget.id, u)} />}
      {transcriptTarget && <TranscriptPanel relance={transcriptTarget} onClose={() => setTranscriptTarget(null)} />}
      {historyPhone && <HistoryPanel telephone={historyPhone} token={user.token} onClose={() => setHistoryPhone(null)} />}
      {batch && <BatchModal batch={batch} onClose={() => { setBatch(null); load(); }} onCancel={() => { cancelBatchRef.current = true; setBatch(p => p ? { ...p, finished: true } : p); }} />}
    </div>
  );
}
