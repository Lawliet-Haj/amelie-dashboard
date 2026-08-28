import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  ArcElement, Tooltip, Legend,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Phone, AlertTriangle, Clock, Bell, RefreshCw,
  BarChart2, PhoneCall, X, MessageSquare, CheckCircle,
  Circle, Filter, History, Users, LogOut, Search, Briefcase, Receipt,
} from 'lucide-react';
import { useData } from './hooks/useData';
import { useAuth } from './hooks/useAuth';
import { UsersView } from './views/UsersView';
import { RecouvrementView } from './views/RecouvrementView';
import { FacturationView } from './views/FacturationView';
import type { Rappel, RecentCall } from './types';
import { Portal } from './lib/Portal';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

// ─── Constants ───────────────────────────────────────────────────────────────

const API_BASE = 'https://n8n.srv778935.hstgr.cloud';

const BLUE_PALETTE = ['#2d7fc2', '#4a9dd4', '#7cb9e8', '#aad4f0', '#1a5ea0', '#93c5e0'];

const SENT_COLORS: Record<string, string> = {
  positif: '#22c55e',
  neutre:  '#94a3b8',
  negatif: '#ef4444',
};

const MOTIF_LABELS: Record<string, string> = {
  location:        'Location',
  retour:          'Retour',
  ordonnance:      'Ordonnance',
  transfert_voulu: 'Transfert',
  hors_ouverture:  'Hors horaires',
  autre:           'Autre',
  troll_injection: 'Troll',
  inconnu:         'Inconnu',
};

const CALLBACK_LABELS: Record<string, string> = {
  transfert_echoue: 'Transfert échoué',
  hors_ouverture:   'Hors horaires',
  hors_perimetre:   'Hors périmètre',
  raccroche_abrupt: 'Raccroché',
  frustration_ia:   'Frustration IA',
};

// ─── Phone helper ────────────────────────────────────────────────────────────

function PhoneLink({ phone }: { phone?: string | number }) {
  if (!phone) return <span style={{ color: 'var(--muted)', fontSize: 13 }}>—</span>;
  const str   = String(phone);
  const clean = str.replace(/\s/g, '');
  return (
    <a
      href={`tel:${clean}`}
      style={{
        fontFamily: 'monospace', fontSize: 13, color: 'var(--blue)',
        textDecoration: 'none', whiteSpace: 'nowrap',
        borderBottom: '1px dashed var(--blue)', paddingBottom: 1,
        cursor: 'pointer',
      }}
      title={`Appeler ${str}`}
    >
      {str}
    </a>
  );
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function markRappelDone(
  convId: string,
  rappele_par: string,
  remarque: string,
  phone?: string,
  motif?: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/webhook/dashboard-mark-rappel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conv_id: convId, statut: 'DONE', rappele_par, remarque,
        ...(phone ? { phone } : {}),
        ...(motif ? { motif } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Anomalie treatment types ─────────────────────────────────────────────────

interface TreatmentRecord {
  statut: 'DONE';
  diagnostic: string;
  remarque: string;
  par: string;
  le: string;
}

const DIAGNOSTICS = [
  'Patient rappelé — situation résolue',
  'Faux positif IA — aucune action nécessaire',
  'Problème technique identifié',
  'Escalade manager',
  'Aucune action nécessaire',
  'Autre',
];

// ─── Transcript Panel ─────────────────────────────────────────────────────────

type MessageLine = { role: 'agent' | 'user' | 'system'; text: string };

function parseTranscript(raw: string): MessageLine[] {
  return raw.split('\n').filter(l => l.trim()).map(line => {
    // ElevenLabs bracket format: [Amélie] … or [Patient] …
    if (/^\[(Amélie|Agent|Assistant|IA)\]/i.test(line))
      return { role: 'agent', text: line.replace(/^\[.*?\]\s*/, '') };
    if (/^\[(Patient|Utilisateur|User|Client|Appelant)\]/i.test(line))
      return { role: 'user',  text: line.replace(/^\[.*?\]\s*/, '') };
    // Colon format: Agent: … or Utilisateur: …
    if (/^(Agent|Amélie|Assistant)\s*:/i.test(line))
      return { role: 'agent', text: line.replace(/^.*?:\s*/, '') };
    if (/^(Utilisateur|User|Patient|Client)\s*:/i.test(line))
      return { role: 'user',  text: line.replace(/^.*?:\s*/, '') };
    return { role: 'system', text: line };
  });
}

function TranscriptPanel({ call, onClose }: { call: RecentCall; onClose: () => void }) {
  const lines = call.transcript ? parseTranscript(call.transcript) : [];

  return (
    <Portal>
      <div className="panel-overlay animate-fade-in" onClick={onClose} />
      <div className="panel animate-slide-in">
        {/* Header */}
        <div className="panel-header">
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
                fontFamily: 'Lexend,sans-serif', color: 'var(--blue)',
                background: 'var(--blue-light)', padding: '2px 8px', borderRadius: 6,
              }}>Transcript</span>
              {call.anomalie === 'OUI' && (
                <span style={{ fontSize: 10, fontWeight: 700, background: '#fef2f2', color: '#dc2626', padding: '2px 8px', borderRadius: 6, fontFamily: 'Lexend,sans-serif' }}>
                  ⚠ Anomalie
                </span>
              )}
            </div>
            <h3 style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 3 }}>
              {call.date} à {call.heure}
            </h3>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>
              {call.duration}s · {MOTIF_LABELS[call.motif_ia] || call.motif_ia} · {call.action}
              {call.conv_id && <span style={{ marginLeft: 8, fontFamily: 'monospace', fontSize: 11 }}>{call.conv_id}</span>}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: 8, border: 'none', background: 'var(--blue-faint)',
              borderRadius: 8, cursor: 'pointer', color: 'var(--muted)',
              display: 'flex', alignItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="panel-body">
          {call.transcript ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {lines.map((line, i) => {
                if (line.role === 'system') return (
                  <div key={i} style={{ textAlign: 'center', margin: '2px 0' }}>
                    <span style={{
                      fontSize: 11, color: 'var(--muted)',
                      padding: '3px 14px', background: '#f0f5fa', borderRadius: 20,
                    }}>{line.text}</span>
                  </div>
                );
                const isAgent = line.role === 'agent';
                return (
                  <div key={i} style={{
                    display: 'flex', gap: 8, alignItems: 'flex-end',
                    flexDirection: isAgent ? 'row' : 'row-reverse',
                  }}>
                    {/* Avatar */}
                    <div style={{
                      width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                      background: isAgent
                        ? 'linear-gradient(135deg, #2d7fc2 0%, #1a5ea0 100%)'
                        : 'linear-gradient(135deg, #f5a128 0%, #d68510 100%)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 800, color: 'white',
                      fontFamily: 'Lexend,sans-serif',
                      boxShadow: isAgent
                        ? '0 2px 6px rgba(45,127,194,.35)'
                        : '0 2px 6px rgba(245,161,40,.35)',
                    }}>
                      {isAgent ? 'A' : 'P'}
                    </div>
                    {/* Bubble + label */}
                    <div style={{ maxWidth: '74%', display: 'flex', flexDirection: 'column', gap: 3, alignItems: isAgent ? 'flex-start' : 'flex-end' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.5px',
                        textTransform: 'uppercase', fontFamily: 'Lexend,sans-serif',
                        color: isAgent ? 'var(--blue)' : '#d68510',
                      }}>
                        {isAgent ? 'Amélie' : 'Patient'}
                      </span>
                      <div className={isAgent ? 'bubble-agent' : 'bubble-user'}>
                        {line.text}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: 200, gap: 12, color: 'var(--muted)',
            }}>
              <MessageSquare size={32} strokeWidth={1.5} />
              <p style={{ fontSize: 13 }}>Transcript non disponible</p>
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

// ─── Login Page ───────────────────────────────────────────────────────────────

function LoginPage({ onLogin }: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await fetch('https://n8n.srv778935.hstgr.cloud/webhook/dashboard-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
        signal: AbortSignal.timeout(10_000),
      });
      const json = await res.json();
      if (json.ok && json.token) {
        onLogin(json.token);
      } else {
        setError(json.error ?? 'Identifiants invalides');
      }
    } catch {
      setError('Impossible de contacter le serveur. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 13,
            background: 'linear-gradient(135deg,#2d7fc2,#1a5ea0)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, boxShadow: '0 3px 10px rgba(45,127,194,.35)',
          }}>🎙</div>
          <div>
            <div style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 800, fontSize: 17, color: 'var(--text)' }}>
              Amélie
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.2px' }}>
              Tire-Lait Express · Dashboard
            </div>
          </div>
        </div>

        <h2 style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 18, marginBottom: 6, color: 'var(--text)' }}>
          Connexion
        </h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 22 }}>
          Connectez-vous pour accéder au dashboard.
        </p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 5, fontFamily: 'Lexend,sans-serif' }}>
              Identifiant
            </label>
            <input
              className="login-input"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="votre identifiant"
              autoFocus
              required
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 5, fontFamily: 'Lexend,sans-serif' }}>
              Mot de passe
            </label>
            <input
              className="login-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '11px', fontSize: 14, marginTop: 4 }}
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : null}
            Se connecter
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Aging helpers ────────────────────────────────────────────────────────────

// ─── Rappel grouping helpers ──────────────────────────────────────────────────

interface RappelGroup {
  phone: string;
  all: Rappel[];           // tous les rappels pour ce numéro
  latest: Rappel;         // le plus récent PENDING, sinon le plus récent DONE
  pendingCount: number;
  hasUrgent: boolean;
}

function buildRappelGroups(rappels: Rappel[], getStatut: (r: Rappel) => string): RappelGroup[] {
  const map = new Map<string, Rappel[]>();
  for (const r of rappels) {
    const key = String(r.phone || '—').trim();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  const groups: RappelGroup[] = [];
  map.forEach((all, phone) => {
    // sort: PENDING first, then most recent
    const sorted = [...all].sort((a, b) => {
      const sa = getStatut(a), sb = getStatut(b);
      if (sa !== sb) return sa === 'PENDING' ? -1 : 1;
      const ka = `${a.date_full || a.date} ${a.heure}`;
      const kb = `${b.date_full || b.date} ${b.heure}`;
      return kb.localeCompare(ka);
    });
    const pending = sorted.filter(r => getStatut(r) !== 'DONE');
    groups.push({
      phone,
      all: sorted,
      latest: sorted[0],
      pendingCount: pending.length,
      hasUrgent: pending.some(r => r.priorite === 'URGENT'),
    });
  });
  // sort groups: URGENT pending first, then any pending, then done; within same status: most recent latest first
  return groups.sort((a, b) => {
    if (a.hasUrgent !== b.hasUrgent) return a.hasUrgent ? -1 : 1;
    if ((a.pendingCount > 0) !== (b.pendingCount > 0)) return a.pendingCount > 0 ? -1 : 1;
    const ka = `${a.latest.date_full || a.latest.date} ${a.latest.heure}`;
    const kb = `${b.latest.date_full || b.latest.date} ${b.latest.heure}`;
    return kb.localeCompare(ka);
  });
}

// ─── Patient Timeline Panel ───────────────────────────────────────────────────

function PatientTimelinePanel({
  phone, calls, rappels, onClose,
}: {
  phone: string;
  calls: RecentCall[];
  rappels: Rappel[];
  onClose: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const norm = (p?: string | number) => String(p ?? '').replace(/\s/g, '');
  const normPhone = norm(phone);

  const matchingCalls = [...calls]
    .filter(c => norm(c.phone) === normPhone)
    .sort((a, b) => {
      const ka = `${a.date_full || a.date} ${a.heure}`;
      const kb = `${b.date_full || b.date} ${b.heure}`;
      return kb.localeCompare(ka);
    });

  const matchingRappels = rappels.filter(r => norm(r.phone) === normPhone);
  const hasUrgent = matchingRappels.some(r => r.priorite === 'URGENT' && r.statut !== 'DONE');

  return (
    <Portal>
      <div className="panel-overlay animate-fade-in" onClick={onClose} />
      <div className="panel animate-slide-in" style={{ zIndex: 60 }}>
        {/* Header */}
        <div className="panel-header">
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
                fontFamily: 'Lexend,sans-serif', color: 'var(--blue)',
                background: 'var(--blue-light)', padding: '2px 8px', borderRadius: 6,
              }}>Historique patient</span>
              {hasUrgent && (
                <span style={{ fontSize: 10, fontWeight: 700, background: '#fef2f2', color: '#dc2626', padding: '2px 8px', borderRadius: 6 }}>
                  ⚠ Rappel URGENT
                </span>
              )}
            </div>
            <h3 style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 3 }}>
              {phone}
            </h3>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>
              {matchingCalls.length} appel{matchingCalls.length !== 1 ? 's' : ''} trouvé{matchingCalls.length !== 1 ? 's' : ''}
              {matchingRappels.length > 0 && ` · ${matchingRappels.length} rappel${matchingRappels.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <button onClick={onClose} style={{
            padding: 8, border: 'none', background: 'var(--blue-faint)',
            borderRadius: 8, cursor: 'pointer', color: 'var(--muted)',
            display: 'flex', alignItems: 'center',
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Rappels summary strip */}
        {matchingRappels.length > 0 && (
          <div style={{
            padding: '10px 24px', borderBottom: '1px solid var(--border)',
            background: hasUrgent ? '#fef9f9' : 'var(--blue-faint)',
            display: 'flex', gap: 8, flexWrap: 'wrap',
          }}>
            {matchingRappels.map((r, i) => (
              <span key={i} style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 20,
                background: r.priorite === 'URGENT' ? '#fef2f2' : 'var(--orange-light)',
                color: r.priorite === 'URGENT' ? '#dc2626' : 'var(--orange-dark)',
                fontWeight: 700, fontFamily: 'Lexend,sans-serif',
                border: `1px solid ${r.priorite === 'URGENT' ? '#fca5a5' : '#fcd99a'}`,
              }}>
                {r.priorite === 'URGENT' ? '🔴' : '🟡'} {r.date} {r.heure} — {CALLBACK_LABELS[r.motif] || r.motif}
                {r.statut === 'DONE' ? ' ✓' : ''}
              </span>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="panel-body">
          {matchingCalls.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: 200, gap: 12, color: 'var(--muted)',
            }}>
              <Phone size={32} strokeWidth={1.5} />
              <p style={{ fontSize: 13 }}>Aucun appel trouvé pour ce numéro</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {matchingCalls.map((c, i) => {
                const callKey = c.conv_id || String(i);
                const isExpanded = expandedId === callKey;
                const accentColor = c.anomalie === 'OUI' ? '#ef4444' : (SENT_COLORS[c.sentiment] || '#94a3b8');
                const lines = c.transcript ? parseTranscript(c.transcript) : [];
                return (
                  <div key={i} className="timeline-card" style={{ borderLeft: `4px solid ${accentColor}` }}>
                    <div
                      className="timeline-card-header"
                      onClick={() => setExpandedId(isExpanded ? null : callKey)}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
                          {c.date} · {c.heure}
                        </span>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, background: 'var(--blue-light)', color: 'var(--blue-dark)', fontWeight: 600 }}>
                            {MOTIF_LABELS[c.motif_ia] || c.motif_ia}
                          </span>
                          <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, background: '#f0f5fa', color: 'var(--muted)' }}>
                            {c.action}
                          </span>
                          <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, background: `${accentColor}18`, color: accentColor, fontWeight: 600 }}>
                            {c.sentiment}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        {c.anomalie === 'OUI' && (
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: '#fef2f2', color: '#dc2626', fontWeight: 700 }}>⚠</span>
                        )}
                        <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{c.duration}s</span>
                        {c.transcript && (
                          <span style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 600 }}>
                            {isExpanded ? '▲' : '▼'}
                          </span>
                        )}
                      </div>
                    </div>
                    {isExpanded && c.transcript && (
                      <div className="timeline-card-body">
                        <div className="timeline-transcript">
                          {lines.map((line, li) => {
                            if (line.role === 'system') return (
                              <div key={li} style={{ textAlign: 'center' }}>
                                <span style={{ fontSize: 10, color: 'var(--muted)', padding: '2px 10px', background: '#f0f5fa', borderRadius: 20 }}>{line.text}</span>
                              </div>
                            );
                            const isAgent = line.role === 'agent';
                            return (
                              <div key={li} style={{ display: 'flex', gap: 7, flexDirection: isAgent ? 'row' : 'row-reverse' }}>
                                <div style={{
                                  width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                                  background: isAgent ? 'linear-gradient(135deg,#2d7fc2,#1a5ea0)' : 'linear-gradient(135deg,#f5a128,#d68510)',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: 10, fontWeight: 800, color: 'white',
                                }}>
                                  {isAgent ? 'A' : 'P'}
                                </div>
                                <div className={isAgent ? 'bubble-agent' : 'bubble-user'} style={{ fontSize: 12, maxWidth: '80%' }}>
                                  {line.text}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({ value, label, icon: Icon, delay, accentColor, bgColor, sub, progress }: {
  value: string | number;
  label: string;
  icon: React.ElementType;
  delay: string;
  accentColor: string;
  bgColor: string;
  sub?: string;
  progress?: { current: number; total: number };
}) {
  // Dynamic accent when a progress bar is present
  const dynAccent = progress
    ? progress.total === 0         ? '#94a3b8'
    : progress.current === 0       ? '#ef4444'
    : progress.current >= progress.total ? '#22c55e'
    : progress.current / progress.total >= 0.5 ? '#10b981'
    : '#f97316'
    : accentColor;

  const pct = progress && progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div
      className="card animate-fade-up"
      style={{ padding: '20px 22px', animationDelay: delay, borderTop: `3px solid ${dynAccent}` }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <span style={{
          fontFamily: 'Lexend,sans-serif', fontSize: 10.5, fontWeight: 700,
          letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--muted)',
        }}>{label}</span>
        <div style={{
          width: 34, height: 34, borderRadius: 9,
          background: progress ? `${dynAccent}1a` : bgColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          transition: 'background 0.5s ease',
        }}>
          <Icon size={15} style={{ color: dynAccent, transition: 'color 0.5s ease' }} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{
          fontFamily: 'Lexend,sans-serif', fontSize: 38, fontWeight: 800,
          lineHeight: 1, color: 'var(--text)',
        }}>{value}</span>
        {sub && !progress && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</span>}
      </div>
      {progress && progress.total > 0 && (
        <div style={{ marginTop: 14 }}>
          {/* Label row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'DM Sans,sans-serif' }}>
              {progress.current >= progress.total
                ? '✓ Toutes traitées'
                : `${progress.current} traitée${progress.current !== 1 ? 's' : ''} / ${progress.total}`}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 700, fontFamily: 'Lexend,sans-serif',
              color: dynAccent, transition: 'color 0.5s ease',
            }}>
              {pct}%
            </span>
          </div>
          {/* Progress bar */}
          <div style={{ height: 5, background: '#eef4fa', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${pct}%`,
              background: dynAccent,
              borderRadius: 10,
              transition: 'width 0.8s cubic-bezier(.4,0,.2,1), background 0.5s ease',
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Anomalie Treatment Modal ─────────────────────────────────────────────────

function AnomalieTraitementModal({
  call, rappel, treatment, onClose, onTreat, onViewTranscript,
}: {
  call: RecentCall;
  rappel?: Rappel;
  treatment?: TreatmentRecord;
  onClose: () => void;
  onTreat: (conv_id: string, remarque: string, phone?: string, motif?: string) => Promise<void>;
  onViewTranscript?: () => void;
}) {
  const [diagnostic, setDiagnostic] = useState(DIAGNOSTICS[0]);
  const [remarqueLibre, setRemarqueLibre] = useState('');
  const [loading, setLoading] = useState(false);

  const isDone = !!treatment || rappel?.statut === 'DONE';
  const traceData = treatment || (rappel?.statut === 'DONE' ? {
    par: rappel.rappele_par || '—',
    le: rappel.rappele_le || '',
    remarque: rappel.remarque || '',
  } : null);

  const anomalieReason = rappel
    ? (CALLBACK_LABELS[rappel.motif] || rappel.motif)
    : (call.sentiment === 'negatif' ? 'Sentiment négatif' : 'Anomalie détectée');

  const handleSubmit = async () => {
    if (!call.conv_id || loading) return;
    setLoading(true);
    const combined = remarqueLibre.trim()
      ? `[${diagnostic}] ${remarqueLibre.trim()}`
      : `[${diagnostic}]`;
    await onTreat(call.conv_id, combined, String(call.phone || ''), call.motif_ia);
    setLoading(false);
    onClose();
  };

  return (
    <Portal>
      <div className="panel-overlay animate-fade-in" onClick={onClose} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 520, maxWidth: 'calc(100vw - 32px)', background: 'white',
        borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,.18)',
        zIndex: 100, overflow: 'hidden',
        animation: 'fadeUp 0.2s ease',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px',
          background: 'linear-gradient(135deg,#fef2f2 0%,#fff7f0 100%)',
          borderBottom: '1px solid #fde8e8',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <AlertTriangle size={14} style={{ color: '#dc2626' }} />
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
                color: '#dc2626', fontFamily: 'Lexend,sans-serif',
              }}>Traitement anomalie</span>
            </div>
            <p style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 4 }}>
              {call.date} à {call.heure}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {call.phone || '—'} · {MOTIF_LABELS[call.motif_ia] || call.motif_ia} · {call.duration}s
              </span>
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, background: '#fce7e7', color: '#dc2626', fontWeight: 600 }}>
                ⚠ {anomalieReason}
              </span>
            </div>
          </div>
          <button onClick={onClose} style={{
            padding: 8, border: 'none', background: '#fee2e2',
            borderRadius: 8, cursor: 'pointer', color: '#dc2626', display: 'flex',
          }}>
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {isDone ? (
            <div style={{
              padding: '14px 16px', background: '#f0fdf4', borderRadius: 10,
              border: '1px solid #bbf7d0', display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle size={16} style={{ color: '#16a34a' }} />
                <span style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 13, color: '#15803d' }}>
                  Clôturé{traceData?.le ? ` le ${traceData.le}` : ''}{traceData?.par ? ` par ${traceData.par}` : ''}
                </span>
              </div>
              {traceData?.remarque && (
                <p style={{
                  fontSize: 12, color: '#166534', fontStyle: 'italic',
                  marginLeft: 24, padding: '4px 10px', background: '#dcfce7', borderRadius: 6,
                }}>
                  {traceData.remarque}
                </p>
              )}
            </div>
          ) : !call.conv_id ? (
            <div style={{ padding: '12px 16px', background: '#f8fafc', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, color: 'var(--muted)' }}>
              ⚠ Aucun rappel associé à cet appel.
            </div>
          ) : (
            <>
              <div>
                <label style={{
                  display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.8px',
                  textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6, fontFamily: 'Lexend,sans-serif',
                }}>Diagnostic</label>
                <select
                  value={diagnostic}
                  onChange={e => setDiagnostic(e.target.value)}
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 9, fontSize: 13,
                    border: '1.5px solid var(--border)', fontFamily: 'DM Sans,sans-serif',
                    color: 'var(--text)', background: 'white', outline: 'none', cursor: 'pointer',
                  }}
                >
                  {DIAGNOSTICS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label style={{
                  display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.8px',
                  textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6, fontFamily: 'Lexend,sans-serif',
                }}>Note (optionnel)</label>
                <textarea
                  value={remarqueLibre}
                  onChange={e => setRemarqueLibre(e.target.value)}
                  placeholder="Détails supplémentaires…"
                  rows={3}
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 9, fontSize: 13,
                    border: '1.5px solid var(--border)', fontFamily: 'DM Sans,sans-serif',
                    color: 'var(--text)', background: 'white', outline: 'none',
                    resize: 'vertical', boxSizing: 'border-box',
                  }}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          background: 'var(--blue-faint)',
        }}>
          <div>
            {onViewTranscript && (
              <button onClick={onViewTranscript} className="btn btn-ghost btn-sm">
                <MessageSquare size={13} />
                Transcript
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} className="btn btn-ghost btn-sm">Fermer</button>
            {!isDone && call.conv_id && (
              <button
                onClick={handleSubmit}
                disabled={loading}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  fontFamily: 'Lexend,sans-serif', cursor: loading ? 'not-allowed' : 'pointer',
                  border: '1px solid #dc2626', background: '#dc2626', color: 'white',
                  opacity: loading ? 0.65 : 1,
                }}
              >
                <CheckCircle size={13} />
                {loading ? 'Clôture…' : 'Clôturer'}
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function Overview({
  data, rappelByConvId, localTreatments,
}: {
  data: NonNullable<ReturnType<typeof useData>['data']>;
  rappelByConvId: Map<string, Rappel>;
  localTreatments: Record<string, TreatmentRecord>;
}) {
  // Week-scoped anomaly treatment stats (consistent with kpis.anomalies_week)
  const weekStart = get7DaysAgo();
  const anomalyCallsWeek = data.recent_calls.filter(c =>
    c.anomalie === 'OUI' && (!c.date_full || c.date_full >= weekStart)
  );
  const anomalyTreatedWeek = anomalyCallsWeek.filter(c =>
    c.conv_id && (localTreatments[c.conv_id] || rappelByConvId.get(c.conv_id)?.statut === 'DONE')
  ).length;
  const callsData = {
    labels: data.calls_by_day.map(d => d.date),
    datasets: [
      {
        label: 'Appels', data: data.calls_by_day.map(d => d.total),
        backgroundColor: '#2d7fc2', borderRadius: 6, borderSkipped: false,
      },
      {
        label: 'Anomalies', data: data.calls_by_day.map(d => d.anomalies),
        backgroundColor: '#ffbe6a', borderRadius: 6, borderSkipped: false,
      },
    ],
  };

  const chartFont = { family: 'DM Sans', size: 11 } as const;
  const callsOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true, position: 'top' as const,
        labels: { font: { family: 'DM Sans', size: 12 }, color: '#607d94', boxWidth: 10, padding: 16 },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: chartFont, color: '#94aab9' }, border: { display: false } },
      y: { grid: { color: '#eef4fa' }, ticks: { font: chartFont, color: '#94aab9', precision: 0 }, border: { display: false } },
    },
  };

  const motifData = {
    labels: data.motifs.map(m => MOTIF_LABELS[m.name] || m.name),
    datasets: [{ data: data.motifs.map(m => m.count), backgroundColor: BLUE_PALETTE, borderWidth: 3, borderColor: '#fff' }],
  };

  const sentData = {
    labels: data.sentiment.map(s => s.name.charAt(0).toUpperCase() + s.name.slice(1)),
    datasets: [{
      data: data.sentiment.map(s => s.count),
      backgroundColor: data.sentiment.map(s => SENT_COLORS[s.name] || '#94a3b8'),
      borderWidth: 3, borderColor: '#fff',
    }],
  };

  const donutOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '68%',
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: { font: { family: 'DM Sans', size: 12 }, color: '#607d94', padding: 14, boxWidth: 10 },
      },
    },
  };

  const totalActions = data.actions.reduce((s, a) => s + a.count, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
        <KPICard value={data.kpis.total_week}           label="Appels semaine" icon={Phone}         delay="0s"     accentColor="var(--blue)"   bgColor="var(--blue-light)" sub={`${data.kpis.total_today} auj.`} />
        <KPICard
          value={data.kpis.anomalies_week}
          label="Anomalies"
          icon={AlertTriangle}
          delay="0.06s"
          accentColor="#ef4444"
          bgColor="#fef2f2"
          progress={{ current: anomalyTreatedWeek, total: anomalyCallsWeek.length }}
        />
        <KPICard value={`${data.kpis.avg_duration}s`}  label="Durée moy."     icon={Clock}         delay="0.12s"  accentColor="var(--blue)"   bgColor="var(--blue-light)" />
        <KPICard value={data.kpis.rappels_pending}      label="Rappels att."   icon={Bell}          delay="0.18s"  accentColor="var(--orange)" bgColor="var(--orange-light)" />
      </div>

      {/* Bar chart */}
      <div className="card animate-fade-up-3" style={{ padding: '22px 24px' }}>
        <p className="section-label">Appels par jour — 7 derniers jours</p>
        <div style={{ height: 200 }}><Bar data={callsData} options={callsOpts} /></div>
      </div>

      {/* Donuts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="card animate-fade-up-4" style={{ padding: '22px 24px' }}>
          <p className="section-label">Répartition des motifs</p>
          <div style={{ height: 220 }}><Doughnut data={motifData} options={donutOpts} /></div>
        </div>
        <div className="card animate-fade-up-5" style={{ padding: '22px 24px' }}>
          <p className="section-label">Sentiment</p>
          <div style={{ height: 220 }}><Doughnut data={sentData} options={donutOpts} /></div>
        </div>
      </div>

      {/* Actions */}
      <div className="card animate-fade-up-6" style={{ padding: '22px 24px' }}>
        <p className="section-label">Actions réalisées</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {data.actions.map((a, i) => {
            const pct = totalActions ? Math.round(a.count / totalActions * 100) : 0;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 160, fontSize: 13, color: 'var(--text-2)', flexShrink: 0 }}>{a.name}</span>
                <div style={{ flex: 1, height: 7, background: '#eef4fa', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${pct}%`,
                    background: BLUE_PALETTE[i % BLUE_PALETTE.length],
                    borderRadius: 4, transition: 'width 0.9s ease',
                  }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', width: 28, textAlign: 'right' }}>{a.count}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)', width: 36, textAlign: 'right' }}>{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });

function get7DaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
}

// ─── Appels View ──────────────────────────────────────────────────────────────

type AppelSortCol = 'datetime' | 'duration' | 'anomalie';
type DatePreset   = 'today' | 'week' | 'all' | 'custom';

function AppelsView({
  data, onTimeline, rappelByConvId, localTreatments, onTreat,
}: {
  data: NonNullable<ReturnType<typeof useData>['data']>;
  onTimeline: (phone: string) => void;
  rappelByConvId: Map<string, Rappel>;
  localTreatments: Record<string, TreatmentRecord>;
  onTreat: (conv_id: string, remarque: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<RecentCall | null>(null);
  const [sortCol, setSortCol]   = useState<AppelSortCol>('datetime');
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('desc');
  const [preset, setPreset]     = useState<DatePreset>('today');
  const [dateFrom, setDateFrom] = useState<string>(todayISO);
  const [dateTo, setDateTo]     = useState<string>(todayISO);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchPhone, setSearchPhone]         = useState('');
  const [motifFilter, setMotifFilter]         = useState('');
  const [sentimentFilter, setSentimentFilter] = useState('');
  const [anomalieFilter, setAnomalieFilter]   = useState<'' | 'OUI' | 'NON'>('');
  const PAGE_SIZE = 100;

  const [selectedAnomalie, setSelectedAnomalie] = useState<RecentCall | null>(null);
  const motifOptions = Array.from(new Set(data.recent_calls.map(c => c.motif_ia).filter(Boolean))).sort();
  const normalizePhone = (p: string) => String(p || '').replace(/[\s.\-()+]/g, '');
  const hasActiveFilter = !!(searchPhone || motifFilter || sentimentFilter || anomalieFilter);
  const isTraite = (c: RecentCall): boolean => {
    if (!c.conv_id) return false;
    if (localTreatments[c.conv_id]) return true;
    return rappelByConvId.get(c.conv_id)?.statut === 'DONE';
  };

  const resetExtraFilters = () => {
    setSearchPhone(''); setMotifFilter(''); setSentimentFilter(''); setAnomalieFilter('');
    setCurrentPage(1);
  };

  const applyPreset = (p: DatePreset) => {
    setPreset(p);
    setCurrentPage(1);
    if (p === 'today') { setDateFrom(todayISO);       setDateTo(todayISO); }
    if (p === 'week')  { setDateFrom(get7DaysAgo());  setDateTo(todayISO); }
    if (p === 'all')   { setDateFrom('');              setDateTo('');       }
  };

  const handleSort = (col: AppelSortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  // Build YYYY-MM-DD HH:MM key for sorting (uses date_full when available)
  const toKey = (c: RecentCall) => {
    if (c.date_full) return `${c.date_full} ${c.heure}`;
    const [d, m] = c.date.split('/');
    return `2026-${(m ?? '01').padStart(2, '0')}-${(d ?? '01').padStart(2, '0')} ${c.heure}`;
  };

  const sorted = [...data.recent_calls].sort((a, b) => {
    let cmp = 0;
    if (sortCol === 'datetime') cmp = toKey(a).localeCompare(toKey(b));
    if (sortCol === 'duration') cmp = a.duration - b.duration;
    if (sortCol === 'anomalie') cmp = (a.anomalie === 'OUI' ? 1 : 0) - (b.anomalie === 'OUI' ? 1 : 0);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Combined filter: date + phone search + motif + sentiment + anomalie
  const needle = normalizePhone(searchPhone);
  const filtered = sorted.filter(c => {
    // Date range
    if (dateFrom || dateTo) {
      const d = c.date_full ?? toKey(c).slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo   && d > dateTo)   return false;
    }
    // Phone search (digits-only contains)
    if (needle && !normalizePhone(c.phone || '').includes(needle)) return false;
    // Motif / sentiment / anomalie
    if (motifFilter     && c.motif_ia  !== motifFilter)     return false;
    if (sentimentFilter && c.sentiment !== sentimentFilter) return false;
    if (anomalieFilter  && c.anomalie  !== anomalieFilter)  return false;
    return true;
  });

  // Pagination — clamp current page if filter shrank result set
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(currentPage, totalPages);
  if (safePage !== currentPage) setTimeout(() => setCurrentPage(safePage), 0);
  const paged      = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const SortIcon = ({ col }: { col: AppelSortCol }) => (
    <span style={{ marginLeft: 4, opacity: sortCol === col ? 1 : 0.25, fontSize: 10 }}>
      {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );

  const thSort = (col: AppelSortCol): React.CSSProperties => ({
    cursor: 'pointer', userSelect: 'none',
    color: sortCol === col ? 'var(--blue-dark)' : undefined,
  });

  const inputStyle: React.CSSProperties = {
    padding: '4px 10px', borderRadius: 8, fontSize: 12,
    border: '1px solid var(--border)', fontFamily: 'DM Sans, sans-serif',
    color: 'var(--text)', background: 'white', outline: 'none',
    cursor: 'pointer', colorScheme: 'light' as React.CSSProperties['colorScheme'],
  };

  return (
    <>
      {selected && <TranscriptPanel call={selected} onClose={() => setSelected(null)} />}
      {selectedAnomalie && (
        <AnomalieTraitementModal
          call={selectedAnomalie}
          rappel={selectedAnomalie.conv_id ? rappelByConvId.get(selectedAnomalie.conv_id) : undefined}
          treatment={selectedAnomalie.conv_id ? localTreatments[selectedAnomalie.conv_id] : undefined}
          onClose={() => setSelectedAnomalie(null)}
          onTreat={onTreat}
          onViewTranscript={selectedAnomalie.transcript ? () => { setSelectedAnomalie(null); setSelected(selectedAnomalie); } : undefined}
        />
      )}
      <div className="card animate-fade-up" style={{ overflow: 'hidden' }}>

        {/* Header */}
        <div style={{
          padding: '14px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h3 style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 15 }}>Appels récents</h3>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {filtered.length === data.recent_calls.length
              ? `${filtered.length} appel${filtered.length > 1 ? 's' : ''}`
              : `${filtered.length} / ${data.recent_calls.length} appels`}
            {totalPages > 1 && (
              <span style={{ marginLeft: 8, color: 'var(--blue-dark)', fontWeight: 600 }}>
                · page {safePage}/{totalPages}
              </span>
            )}
          </span>
        </div>

        {/* Date filter bar */}
        <div style={{
          padding: '10px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          background: 'var(--blue-faint)',
        }}>
          {/* Quick presets */}
          {([
            { key: 'today' as DatePreset, label: "Aujourd'hui" },
            { key: 'week'  as DatePreset, label: '7 jours' },
            { key: 'all'   as DatePreset, label: 'Tout' },
          ]).map(({ key, label }) => (
            <button
              key={key}
              className={`filter-tab${preset === key ? ' active' : ''}`}
              onClick={() => applyPreset(key)}
            >
              {label}
            </button>
          ))}

          {/* Divider */}
          <span style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0, margin: '0 2px' }} />

          {/* Custom date range */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || todayISO}
              style={inputStyle}
              onChange={e => { setDateFrom(e.target.value); setPreset('custom'); setCurrentPage(1); }}
            />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>→</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              max={todayISO}
              style={inputStyle}
              onChange={e => { setDateTo(e.target.value); setPreset('custom'); setCurrentPage(1); }}
            />
          </div>

          {/* Reset custom */}
          {preset === 'custom' && (
            <button
              onClick={() => applyPreset('today')}
              style={{
                fontSize: 11, color: 'var(--blue)', background: 'none',
                border: 'none', cursor: 'pointer', padding: '2px 4px',
                textDecoration: 'underline', fontFamily: 'DM Sans, sans-serif',
              }}
            >
              Réinitialiser
            </button>
          )}
        </div>

        {/* Search & filter bar */}
        <div style={{
          padding: '10px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          background: 'white',
        }}>
          {/* Phone search */}
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 200, maxWidth: 320 }}>
            <Search size={13} style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--muted)', pointerEvents: 'none',
            }} />
            <input
              type="search"
              value={searchPhone}
              onChange={e => { setSearchPhone(e.target.value); setCurrentPage(1); }}
              placeholder="Rechercher un numéro…"
              style={{
                ...inputStyle, width: '100%', paddingLeft: 30, paddingRight: 30,
                cursor: 'text',
              }}
            />
            {searchPhone && (
              <button
                onClick={() => { setSearchPhone(''); setCurrentPage(1); }}
                style={{
                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  background: 'var(--blue-faint)', border: 'none', borderRadius: 5,
                  cursor: 'pointer', padding: 3, display: 'flex',
                }}
                title="Effacer"
              >
                <X size={11} style={{ color: 'var(--muted)' }} />
              </button>
            )}
          </div>

          {/* Motif */}
          <select
            value={motifFilter}
            onChange={e => { setMotifFilter(e.target.value); setCurrentPage(1); }}
            style={{ ...inputStyle, minWidth: 130 }}
          >
            <option value="">Tous motifs</option>
            {motifOptions.map(m => (
              <option key={m} value={m}>{MOTIF_LABELS[m] || m}</option>
            ))}
          </select>

          {/* Sentiment */}
          <select
            value={sentimentFilter}
            onChange={e => { setSentimentFilter(e.target.value); setCurrentPage(1); }}
            style={{ ...inputStyle, minWidth: 130 }}
          >
            <option value="">Tous sentiments</option>
            <option value="positif">😊 Positif</option>
            <option value="neutre">😐 Neutre</option>
            <option value="negatif">😞 Négatif</option>
          </select>

          {/* Anomalie */}
          <select
            value={anomalieFilter}
            onChange={e => { setAnomalieFilter(e.target.value as '' | 'OUI' | 'NON'); setCurrentPage(1); }}
            style={{ ...inputStyle, minWidth: 130 }}
          >
            <option value="">Toutes anomalies</option>
            <option value="OUI">⚠ Anomalie seulement</option>
            <option value="NON">✓ Sans anomalie</option>
          </select>

          {/* Reset all */}
          {hasActiveFilter && (
            <button
              onClick={resetExtraFilters}
              style={{
                fontSize: 11, color: 'var(--blue)', background: 'none',
                border: 'none', cursor: 'pointer', padding: '2px 4px',
                textDecoration: 'underline', fontFamily: 'DM Sans, sans-serif',
              }}
            >
              Effacer les filtres
            </button>
          )}
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th onClick={() => handleSort('datetime')} style={thSort('datetime')}>
                  Date / Heure <SortIcon col="datetime" />
                </th>
                <th>Numéro</th>
                <th onClick={() => handleSort('duration')} style={thSort('duration')}>
                  Durée <SortIcon col="duration" />
                </th>
                <th>Motif</th>
                <th>Action</th>
                <th>Sentiment</th>
                <th onClick={() => handleSort('anomalie')} style={thSort('anomalie')}>
                  Anomalie <SortIcon col="anomalie" />
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((c, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>{c.date}</span>
                    <span style={{ fontWeight: 600, fontFamily: 'Lexend,sans-serif', marginLeft: 6 }}>{c.heure}</span>
                  </td>
                  <td>
                    <div className="phone-cell">
                      <PhoneLink phone={c.phone} />
                      {c.phone && (
                        <button
                          className="phone-timeline-btn"
                          title="Historique patient"
                          onClick={() => onTimeline(String(c.phone))}
                        >
                          <History size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                  <td style={{ fontFamily: 'monospace', color: 'var(--muted)', fontSize: 13 }}>{c.duration}s</td>
                  <td>
                    <span style={{
                      fontSize: 11, padding: '3px 9px', borderRadius: 6,
                      background: 'var(--blue-light)', color: 'var(--blue-dark)',
                      fontWeight: 600, fontFamily: 'Lexend,sans-serif',
                    }}>
                      {MOTIF_LABELS[c.motif_ia] || c.motif_ia}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{c.action}</td>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: SENT_COLORS[c.sentiment] || '#94a3b8' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: SENT_COLORS[c.sentiment] || '#94a3b8', flexShrink: 0 }} />
                      {c.sentiment.charAt(0).toUpperCase() + c.sentiment.slice(1)}
                    </span>
                  </td>
                  <td>
                    {c.anomalie === 'OUI' ? (
                      isTraite(c)
                        ? <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, background: '#f0fdf4', color: '#16a34a', fontWeight: 700 }}>✅ Traité</span>
                        : <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, background: '#fef2f2', color: '#dc2626', fontWeight: 700 }}>⚠ OUI</span>
                    ) : (
                      <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, background: '#f0fdf4', color: '#16a34a', fontWeight: 500 }}>✓ NON</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {c.anomalie === 'OUI' && (
                        <button
                          onClick={() => setSelectedAnomalie(c)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '4px 10px', borderRadius: 7, fontSize: 12,
                            fontWeight: 700, fontFamily: 'Lexend,sans-serif',
                            cursor: 'pointer', border: 'none',
                            background: isTraite(c) ? '#e2f4ec' : '#dc2626',
                            color: isTraite(c) ? '#16a34a' : 'white',
                          }}
                        >
                          {isTraite(c)
                            ? <><CheckCircle size={12} /> Détails</>
                            : <><AlertTriangle size={12} /> Traiter</>
                          }
                        </button>
                      )}
                      {c.transcript && (
                        <button onClick={() => setSelected(c)} className="btn btn-ghost btn-sm">
                          <MessageSquare size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                    📭 Aucun appel sur cette période
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        {totalPages > 1 && (
          <div style={{
            padding: '12px 24px',
            borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'var(--blue-faint)',
            flexWrap: 'wrap', gap: 10,
          }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'DM Sans, sans-serif' }}>
              Affichage <strong style={{ color: 'var(--text)' }}>
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)}
              </strong> sur <strong style={{ color: 'var(--text)' }}>{filtered.length}</strong>
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setCurrentPage(1)}
                disabled={safePage === 1}
                style={{ opacity: safePage === 1 ? 0.35 : 1 }}
                title="Première page"
              >
                «
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={safePage === 1}
                style={{ opacity: safePage === 1 ? 0.35 : 1 }}
              >
                ‹ Précédent
              </button>

              {/* Page numbers — show up to 5 surrounding pages */}
              {(() => {
                const pages: number[] = [];
                const start = Math.max(1, safePage - 2);
                const end   = Math.min(totalPages, start + 4);
                const realStart = Math.max(1, end - 4);
                for (let p = realStart; p <= end; p++) pages.push(p);
                return pages.map(p => (
                  <button
                    key={p}
                    onClick={() => setCurrentPage(p)}
                    style={{
                      minWidth: 30, height: 28, padding: '0 8px',
                      borderRadius: 7, fontSize: 12, fontWeight: 600,
                      fontFamily: 'Lexend, sans-serif',
                      cursor: 'pointer',
                      border: p === safePage ? '1px solid var(--blue)' : '1px solid transparent',
                      background: p === safePage ? 'var(--blue)' : 'transparent',
                      color: p === safePage ? 'white' : 'var(--text-2)',
                    }}
                  >
                    {p}
                  </button>
                ));
              })()}

              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                style={{ opacity: safePage === totalPages ? 0.35 : 1 }}
              >
                Suivant ›
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setCurrentPage(totalPages)}
                disabled={safePage === totalPages}
                style={{ opacity: safePage === totalPages ? 0.35 : 1 }}
                title="Dernière page"
              >
                »
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Rappels View ─────────────────────────────────────────────────────────────

type RappelFilter = 'all' | 'pending' | 'urgent' | 'done';

function RappelsView({
  data, onTimeline,
}: {
  data: NonNullable<ReturnType<typeof useData>['data']>;
  onTimeline: (phone: string) => void;
}) {
  const { user } = useAuth();
  const [filter, setFilter]               = useState<RappelFilter>('pending');
  const [localStatus, setLocalStatus]     = useState<Record<string, 'PENDING' | 'DONE'>>({});
  const [localTrace, setLocalTrace]       = useState<Record<string, { rappele_le: string; rappele_par: string; remarque: string }>>({});
  const [loadingIds, setLoadingIds]       = useState<Record<string, boolean>>({});
  const [expandedPhones, setExpandedPhones] = useState<Set<string>>(new Set());
  const [selectedRappel, setSelectedRappel] = useState<Rappel | null>(null);
  // inline confirm form: conv_id being confirmed + current remark text
  const [confirmingId, setConfirmingId]   = useState<string | null>(null);
  const [remarkText, setRemarkText]       = useState('');
  // search & filter
  const [searchPhone, setSearchPhone]     = useState('');
  const [motifFilter, setMotifFilter]     = useState('');
  const [auteurFilter, setAuteurFilter]   = useState('');
  const [datePreset, setDatePreset]       = useState<DatePreset>('all');
  const [dateFrom, setDateFrom]           = useState<string>('');
  const [dateTo, setDateTo]               = useState<string>('');

  const normalizePhone = (p: string) => String(p || '').replace(/[\s.\-()+]/g, '');

  const applyDatePreset = (p: DatePreset) => {
    setDatePreset(p);
    if (p === 'today') { setDateFrom(todayISO);      setDateTo(todayISO); }
    if (p === 'week')  { setDateFrom(get7DaysAgo()); setDateTo(todayISO); }
    if (p === 'all')   { setDateFrom('');             setDateTo('');       }
  };

  useEffect(() => {
    setLocalStatus({});
    setLocalTrace({});
    setLoadingIds({});
    setConfirmingId(null);
    setRemarkText('');
  }, [data]);

  const getStatut = useCallback((r: Rappel) =>
    localStatus[r.conv_id] ?? r.statut ?? 'PENDING'
  , [localStatus]);

  const getTrace = useCallback((r: Rappel) =>
    localTrace[r.conv_id] ?? (r.rappele_le ? { rappele_le: r.rappele_le, rappele_par: r.rappele_par || '', remarque: r.remarque || '' } : null)
  , [localTrace]);

  const handleMark = useCallback(async (r: Rappel, remarque: string) => {
    if (!r.conv_id || loadingIds[r.conv_id]) return;
    const nom = user?.nom || user?.username || '';
    setConfirmingId(null);
    setRemarkText('');
    setLoadingIds(prev => ({ ...prev, [r.conv_id]: true }));
    setLocalStatus(prev => ({ ...prev, [r.conv_id]: 'DONE' }));
    const now = new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    setLocalTrace(prev => ({ ...prev, [r.conv_id]: { rappele_le: now, rappele_par: nom, remarque } }));
    const ok = await markRappelDone(r.conv_id, nom, remarque);
    if (!ok) {
      setLocalStatus(prev => ({ ...prev, [r.conv_id]: 'PENDING' }));
      setLocalTrace(prev => { const n = { ...prev }; delete n[r.conv_id]; return n; });
    }
    setLoadingIds(prev => ({ ...prev, [r.conv_id]: false }));
  }, [loadingIds, user]);

  const toggleExpand = (phone: string) =>
    setExpandedPhones(prev => {
      const next = new Set(prev);
      next.has(phone) ? next.delete(phone) : next.add(phone);
      return next;
    });

  // Build distinct lists for filter dropdowns
  const motifOptions  = Array.from(new Set(data.rappels.map(r => r.motif).filter(Boolean))).sort();
  const auteurOptions = Array.from(new Set(
    data.rappels
      .map(r => (getTrace(r)?.rappele_par || '').trim())
      .filter(Boolean)
  )).sort();

  const hasActiveFilter = !!(searchPhone || motifFilter || auteurFilter || dateFrom || dateTo);
  const needle = normalizePhone(searchPhone);

  // Pre-filter individual rappels before grouping
  const preFiltered = data.rappels.filter(r => {
    if (needle && !normalizePhone(r.phone || '').includes(needle)) return false;
    if (motifFilter && r.motif !== motifFilter) return false;
    if (auteurFilter) {
      const trace = getTrace(r);
      if (!trace || trace.rappele_par !== auteurFilter) return false;
    }
    if (dateFrom || dateTo) {
      const d = r.date_full || '';
      if (dateFrom && d < dateFrom) return false;
      if (dateTo   && d > dateTo)   return false;
    }
    return true;
  });

  const resetExtraFilters = () => {
    setSearchPhone(''); setMotifFilter(''); setAuteurFilter('');
    setDatePreset('all'); setDateFrom(''); setDateTo('');
  };

  // Build groups from filtered rappels (for table), and from all rappels (for KPI cards)
  const allGroups       = buildRappelGroups(preFiltered, getStatut);
  const allGroupsGlobal = buildRappelGroups(data.rappels, getStatut);
  const groups = allGroups.filter(g => {
    if (filter === 'pending') return g.pendingCount > 0;
    if (filter === 'urgent')  return g.hasUrgent;
    if (filter === 'done')    return g.pendingCount === 0;
    return true;
  });

  // KPI cards always reflect ALL rappels, regardless of search/filters
  const pendingCount = allGroupsGlobal.reduce((n, g) => n + g.pendingCount, 0);
  const urgentCount  = allGroupsGlobal.filter(g => g.hasUrgent).reduce((n, g) => n + g.all.filter(r => getStatut(r) !== 'DONE' && r.priorite === 'URGENT').length, 0);
  const doneGroups   = allGroupsGlobal.filter(g => g.pendingCount === 0).length;

  const rappelAsCall = (r: Rappel): RecentCall => ({
    date: r.date, date_full: r.date_full, heure: r.heure, phone: r.phone,
    duration: 0, motif_ia: r.motif, action: '—', sentiment: 'neutre',
    anomalie: 'NON', transcript: r.transcript, conv_id: r.conv_id,
  });

  const RappelRow = ({ r, sub }: { r: Rappel; sub?: boolean }) => {
    const done        = getStatut(r) === 'DONE';
    const isLoading   = loadingIds[r.conv_id];
    const trace       = getTrace(r);
    const isConfirming = confirmingId === r.conv_id;
    return (
      <tr style={{ opacity: done ? 0.65 : 1, transition: 'opacity 0.3s', background: sub ? 'var(--bg)' : undefined }}>
        {/* Statut + trace */}
        <td style={{ paddingLeft: sub ? 36 : undefined, minWidth: 160 }}>
          {done ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="badge-done"><CheckCircle size={11} />Rappelé</span>
              {trace && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                    👤 {trace.rappele_par || '—'}
                    <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 6 }}>{trace.rappele_le}</span>
                  </span>
                  {trace.remarque && (
                    <span style={{
                      fontSize: 11, color: '#475569', fontStyle: 'italic',
                      background: '#f1f5f9', borderRadius: 5, padding: '2px 7px',
                      borderLeft: '3px solid #cbd5e1', display: 'inline-block',
                    }}>
                      {trace.remarque}
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <span className="badge-pending"><Circle size={9} />En attente</span>
          )}
        </td>
        {/* Priorité */}
        <td>
          {r.priorite === 'URGENT'
            ? <span className="badge-urgent">🔴 URGENT</span>
            : <span className="badge-normal">NORMAL</span>
          }
        </td>
        {/* Date · heure */}
        <td style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.date} {r.heure}</td>
        {/* Motif */}
        <td>
          <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, background: '#f0f5fa', color: 'var(--muted)', fontWeight: 500 }}>
            {CALLBACK_LABELS[r.motif] || r.motif}
          </span>
        </td>
        {/* Action */}
        <td style={{ minWidth: 220 }}>
          {!done && r.conv_id && (
            isConfirming ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  autoFocus
                  type="text"
                  placeholder="Remarque (optionnel)…"
                  value={remarkText}
                  onChange={e => setRemarkText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleMark(r, remarkText);
                    if (e.key === 'Escape') { setConfirmingId(null); setRemarkText(''); }
                  }}
                  style={{
                    width: '100%', fontSize: 12, padding: '5px 9px',
                    border: '1px solid var(--border)', borderRadius: 6,
                    outline: 'none', fontFamily: 'inherit',
                  }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => handleMark(r, remarkText)}
                    disabled={isLoading}
                    className="btn btn-success btn-sm"
                    style={{ flex: 1 }}
                  >
                    <CheckCircle size={12} />
                    {isLoading ? '…' : 'Confirmer'}
                  </button>
                  <button
                    onClick={() => { setConfirmingId(null); setRemarkText(''); }}
                    className="btn btn-ghost btn-sm"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setConfirmingId(r.conv_id); setRemarkText(''); }}
                disabled={isLoading}
                className="btn btn-success btn-sm"
              >
                <CheckCircle size={13} />
                {isLoading ? '…' : 'Marquer rappelé'}
              </button>
            )
          )}
        </td>
        {/* Transcript */}
        <td>
          {r.transcript && (
            <button onClick={() => setSelectedRappel(r)} className="btn btn-ghost btn-sm">
              <MessageSquare size={13} />
            </button>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {selectedRappel && (
        <TranscriptPanel call={rappelAsCall(selectedRappel)} onClose={() => setSelectedRappel(null)} />
      )}

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {([
          { key: 'pending' as RappelFilter, count: pendingCount, Icon: Bell,          color: '#f5a128', border: '#f5a128', bg: '#fff4e2', label: 'en attente' },
          ...(urgentCount > 0 ? [
            { key: 'urgent' as RappelFilter, count: urgentCount, Icon: AlertTriangle, color: '#ef4444', border: '#ef4444', bg: '#fef2f2', label: 'URGENT' }
          ] : []),
          { key: 'done' as RappelFilter, count: doneGroups, Icon: CheckCircle, color: '#22c55e', border: '#22c55e', bg: '#f0fdf4', label: 'rappelés' },
        ] as { key: RappelFilter; count: number; Icon: React.ElementType; color: string; border: string; bg: string; label: string }[]).map(({ key, count, Icon, color, border, bg, label }) => {
          const isActive = filter === key;
          return (
            <div key={key} className="card" onClick={() => setFilter(isActive ? 'all' : key)} style={{
              padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10,
              borderTop: `3px solid ${border}`, cursor: 'pointer',
              background: isActive ? bg : 'white',
              boxShadow: isActive ? `0 0 0 2px ${border}55, 0 4px 12px rgba(0,0,0,.06)` : '0 1px 4px rgba(26,43,66,.05)',
              transform: isActive ? 'translateY(-2px)' : 'none', transition: 'all 0.15s',
            }}>
              <Icon size={15} style={{ color }} />
              <span style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 800, fontSize: 22, color: isActive ? color : 'var(--text)' }}>{count}</span>
              <span style={{ fontSize: 13, color: isActive ? color : 'var(--muted)', fontWeight: isActive ? 600 : 400 }}>{label}</span>
            </div>
          );
        })}
      </div>

      {/* Table */}
      <div className="card animate-fade-up" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Filter size={14} style={{ color: 'var(--muted)' }} />
            <h3 style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 15 }}>Rappels</h3>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['all', 'pending', 'urgent', 'done'] as RappelFilter[]).map(f => (
              <button key={f} className={`filter-tab${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
                {f === 'all' ? 'Tous' : f === 'pending' ? 'En attente' : f === 'urgent' ? '🔴 Urgent' : 'Rappelés'}
              </button>
            ))}
          </div>
        </div>

        {/* Date preset bar */}
        <div style={{
          padding: '10px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          background: 'var(--blue-faint)',
        }}>
          {([
            { key: 'all'   as DatePreset, label: 'Tout' },
            { key: 'today' as DatePreset, label: "Aujourd'hui" },
            { key: 'week'  as DatePreset, label: '7 jours' },
          ]).map(({ key, label }) => (
            <button
              key={key}
              className={`filter-tab${datePreset === key ? ' active' : ''}`}
              onClick={() => applyDatePreset(key)}
            >
              {label}
            </button>
          ))}
          <span style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0, margin: '0 2px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || todayISO}
              style={{
                padding: '4px 10px', borderRadius: 8, fontSize: 12,
                border: '1px solid var(--border)', fontFamily: 'DM Sans, sans-serif',
                color: 'var(--text)', background: 'white', outline: 'none', cursor: 'pointer',
                colorScheme: 'light' as React.CSSProperties['colorScheme'],
              }}
              onChange={e => { setDateFrom(e.target.value); setDatePreset('custom'); }}
            />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>→</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              max={todayISO}
              style={{
                padding: '4px 10px', borderRadius: 8, fontSize: 12,
                border: '1px solid var(--border)', fontFamily: 'DM Sans, sans-serif',
                color: 'var(--text)', background: 'white', outline: 'none', cursor: 'pointer',
                colorScheme: 'light' as React.CSSProperties['colorScheme'],
              }}
              onChange={e => { setDateTo(e.target.value); setDatePreset('custom'); }}
            />
          </div>
          {datePreset === 'custom' && (
            <button
              onClick={() => applyDatePreset('all')}
              style={{
                fontSize: 11, color: 'var(--blue)', background: 'none',
                border: 'none', cursor: 'pointer', padding: '2px 4px',
                textDecoration: 'underline', fontFamily: 'DM Sans, sans-serif',
              }}
            >
              Réinitialiser
            </button>
          )}
        </div>

        {/* Search & filter bar */}
        <div style={{
          padding: '10px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          background: 'white',
        }}>
          {/* Phone search */}
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 200, maxWidth: 320 }}>
            <Search size={13} style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--muted)', pointerEvents: 'none',
            }} />
            <input
              type="search"
              value={searchPhone}
              onChange={e => setSearchPhone(e.target.value)}
              placeholder="Rechercher un numéro…"
              style={{
                width: '100%', paddingLeft: 30, paddingRight: 30,
                padding: '6px 12px', borderRadius: 8, fontSize: 12,
                border: '1px solid var(--border)', fontFamily: 'DM Sans, sans-serif',
                color: 'var(--text)', background: 'white', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            {searchPhone && (
              <button
                onClick={() => setSearchPhone('')}
                style={{
                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  background: 'var(--blue-faint)', border: 'none', borderRadius: 5,
                  cursor: 'pointer', padding: 3, display: 'flex',
                }}
                title="Effacer"
              >
                <X size={11} style={{ color: 'var(--muted)' }} />
              </button>
            )}
          </div>

          {/* Motif */}
          <select
            value={motifFilter}
            onChange={e => setMotifFilter(e.target.value)}
            style={{
              padding: '6px 10px', borderRadius: 8, fontSize: 12, minWidth: 160,
              border: '1px solid var(--border)', fontFamily: 'DM Sans, sans-serif',
              color: 'var(--text)', background: 'white', outline: 'none', cursor: 'pointer',
            }}
          >
            <option value="">Tous motifs</option>
            {motifOptions.map(m => (
              <option key={m} value={m}>{CALLBACK_LABELS[m] || m}</option>
            ))}
          </select>

          {/* Auteur */}
          {auteurOptions.length > 0 && (
            <select
              value={auteurFilter}
              onChange={e => setAuteurFilter(e.target.value)}
              style={{
                padding: '6px 10px', borderRadius: 8, fontSize: 12, minWidth: 150,
                border: '1px solid var(--border)', fontFamily: 'DM Sans, sans-serif',
                color: 'var(--text)', background: 'white', outline: 'none', cursor: 'pointer',
              }}
            >
              <option value="">Tous auteurs</option>
              {auteurOptions.map(a => (
                <option key={a} value={a}>👤 {a}</option>
              ))}
            </select>
          )}

          {/* Reset all */}
          {hasActiveFilter && (
            <button
              onClick={resetExtraFilters}
              style={{
                fontSize: 11, color: 'var(--blue)', background: 'none',
                border: 'none', cursor: 'pointer', padding: '2px 4px',
                textDecoration: 'underline', fontFamily: 'DM Sans, sans-serif',
              }}
            >
              Effacer les filtres
            </button>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                {['Statut', 'Priorité', 'Date · Heure', 'Motif', 'Action', ''].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                    {filter === 'done' ? '📭 Aucun rappel effectué' : '✅ Aucun rappel en attente'}
                  </td>
                </tr>
              ) : groups.map(g => {
                const expanded = expandedPhones.has(g.phone);
                const hasMultiple = g.all.length > 1;
                return (
                  <>
                    {/* Group header row — phone + expand toggle */}
                    <tr key={`hdr-${g.phone}`} style={{ background: '#f8fafc' }}>
                      <td colSpan={7} style={{ padding: '6px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div className="phone-cell">
                            <PhoneLink phone={g.phone} />
                            {g.phone && g.phone !== '—' && (
                              <button className="phone-timeline-btn" title="Historique patient" onClick={() => onTimeline(g.phone)}>
                                <History size={12} />
                              </button>
                            )}
                          </div>
                          {hasMultiple && (
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ fontSize: 11, padding: '2px 8px' }}
                              onClick={() => toggleExpand(g.phone)}
                            >
                              {expanded ? '▲' : '▼'} {g.all.length} appels
                            </button>
                          )}
                          {g.pendingCount > 1 && (
                            <span style={{ fontSize: 11, color: '#f5a128', fontWeight: 600 }}>
                              {g.pendingCount} en attente
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Latest rappel (always shown) */}
                    <RappelRow key={`latest-${g.latest.conv_id}`} r={g.latest} />
                    {/* Expanded: rest of the rappels for this phone */}
                    {expanded && g.all.slice(1).map((r, i) => (
                      <RappelRow key={`sub-${r.conv_id}-${i}`} r={r} sub />
                    ))}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Anomalies View ───────────────────────────────────────────────────────────

type AnomalieStatusFilter = 'all' | 'pending' | 'done';

function AnomaliesView({
  data, rappelByConvId, localTreatments, onTreat, onTimeline,
}: {
  data: NonNullable<ReturnType<typeof useData>['data']>;
  rappelByConvId: Map<string, Rappel>;
  localTreatments: Record<string, TreatmentRecord>;
  onTreat: (conv_id: string, remarque: string) => Promise<void>;
  onTimeline: (phone: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<AnomalieStatusFilter>('all');
  const [searchPhone,  setSearchPhone]  = useState('');
  const [motifFilter,  setMotifFilter]  = useState('');
  const [datePreset,   setDatePreset]   = useState<DatePreset>('all');
  const [dateFrom,     setDateFrom]     = useState('');
  const [dateTo,       setDateTo]       = useState('');
  const [selectedAnomalie,   setSelectedAnomalie]   = useState<RecentCall | null>(null);
  const [selectedTranscript, setSelectedTranscript] = useState<RecentCall | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedPhones, setExpandedPhones] = useState<Set<string>>(new Set());
  const PAGE_SIZE = 50;

  const toggleExpand = (phone: string) =>
    setExpandedPhones(prev => {
      const next = new Set(prev);
      next.has(phone) ? next.delete(phone) : next.add(phone);
      return next;
    });

  const normalizePhone = (p: string) => String(p || '').replace(/[\s.\-()+]/g, '');

  const applyDatePreset = (p: DatePreset) => {
    setDatePreset(p);
    if (p === 'today') { setDateFrom(todayISO);       setDateTo(todayISO); }
    if (p === 'week')  { setDateFrom(get7DaysAgo());  setDateTo(todayISO); }
    if (p === 'all')   { setDateFrom('');              setDateTo('');       }
  };

  const isTraite = (c: RecentCall): boolean => {
    if (!c.conv_id) return false;
    if (localTreatments[c.conv_id]) return true;
    return rappelByConvId.get(c.conv_id)?.statut === 'DONE';
  };

  const getTreatment = (c: RecentCall): TreatmentRecord | undefined => {
    if (!c.conv_id) return undefined;
    if (localTreatments[c.conv_id]) return localTreatments[c.conv_id];
    const r = rappelByConvId.get(c.conv_id);
    if (r?.statut === 'DONE') return { statut: 'DONE', diagnostic: '', remarque: r.remarque || '', par: r.rappele_par || '', le: r.rappele_le || '' };
    return undefined;
  };

  const toKey = (c: RecentCall) => {
    if (c.date_full) return `${c.date_full} ${c.heure}`;
    const [d, m] = c.date.split('/');
    return `2026-${(m ?? '01').padStart(2, '0')}-${(d ?? '01').padStart(2, '0')} ${c.heure}`;
  };

  // All anomaly calls (global — for KPIs)
  const anomalieCalls = useMemo(
    () => data.recent_calls.filter(c => c.anomalie === 'OUI'),
    [data.recent_calls]
  );

  // KPI stats (unfiltered)
  const totalAnomalies  = anomalieCalls.length;
  const treatedCount    = anomalieCalls.filter(isTraite).length;
  const pendingCount    = totalAnomalies - treatedCount;
  const tauxResolution  = totalAnomalies > 0 ? Math.round(treatedCount / totalAnomalies * 100) : 0;

  // Filtered list
  const needle = normalizePhone(searchPhone);
  const filtered = useMemo(() => {
    return [...anomalieCalls]
      .sort((a, b) => toKey(b).localeCompare(toKey(a)))
      .filter(c => {
        if (statusFilter === 'pending' && isTraite(c)) return false;
        if (statusFilter === 'done'    && !isTraite(c)) return false;
        if (needle && !normalizePhone(c.phone || '').includes(needle)) return false;
        if (motifFilter && c.motif_ia !== motifFilter) return false;
        if (dateFrom || dateTo) {
          const d = c.date_full ?? toKey(c).slice(0, 10);
          if (dateFrom && d < dateFrom) return false;
          if (dateTo   && d > dateTo)   return false;
        }
        return true;
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anomalieCalls, statusFilter, needle, motifFilter, dateFrom, dateTo, localTreatments, rappelByConvId]);

  // Group filtered calls by phone number
  const allGroups = useMemo(() => {
    const isPending = (c: RecentCall) =>
      !c.conv_id || (!localTreatments[c.conv_id] && rappelByConvId.get(c.conv_id)?.statut !== 'DONE');

    const map = new Map<string, RecentCall[]>();
    for (const c of filtered) {
      const key = String(c.phone || '—').trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    const groups: { phone: string; all: RecentCall[]; latest: RecentCall; pendingCount: number }[] = [];
    map.forEach((all, phone) => {
      // already sorted most-recent-first by the filtered memo
      const pendingCount = all.filter(isPending).length;
      groups.push({ phone, all, latest: all[0], pendingCount });
    });
    return groups.sort((a, b) => {
      if ((a.pendingCount > 0) !== (b.pendingCount > 0)) return a.pendingCount > 0 ? -1 : 1;
      const ka = `${a.latest.date_full ?? a.latest.date} ${a.latest.heure}`;
      const kb = `${b.latest.date_full ?? b.latest.date} ${b.latest.heure}`;
      return kb.localeCompare(ka);
    });
  }, [filtered, localTreatments, rappelByConvId]);

  const totalPages = Math.max(1, Math.ceil(allGroups.length / PAGE_SIZE));
  const safePage   = Math.min(currentPage, totalPages);
  if (safePage !== currentPage) setTimeout(() => setCurrentPage(safePage), 0);
  const pagedGroups = allGroups.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const motifOptions = Array.from(new Set(anomalieCalls.map(c => c.motif_ia).filter(Boolean))).sort();

  // Charts
  const barData = {
    labels: data.calls_by_day.map(d => d.date),
    datasets: [{
      label: 'Anomalies',
      data: data.calls_by_day.map(d => d.anomalies),
      backgroundColor: '#fca5a5',
      borderColor: '#ef4444',
      borderWidth: 2,
      borderRadius: 6,
      borderSkipped: false,
    }],
  };
  const barOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { font: { family: 'DM Sans', size: 11 }, color: '#94aab9' }, border: { display: false } },
      y: { grid: { color: '#fef2f2' }, ticks: { font: { family: 'DM Sans', size: 11 }, color: '#94aab9', precision: 0 }, border: { display: false } },
    },
  };

  const motifCounts = anomalieCalls.reduce((acc, c) => {
    const k = MOTIF_LABELS[c.motif_ia] || c.motif_ia;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const donutLabels = Object.keys(motifCounts);
  const donutData = {
    labels: donutLabels,
    datasets: [{
      data: donutLabels.map(k => motifCounts[k]),
      backgroundColor: ['#ef4444', '#f97316', '#eab308', '#8b5cf6', '#06b6d4', '#14b8a6'],
      borderWidth: 3, borderColor: '#fff',
    }],
  };
  const donutOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '68%',
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: { font: { family: 'DM Sans', size: 12 }, color: '#607d94', padding: 14, boxWidth: 10 },
      },
    },
  };

  const inputStyle: React.CSSProperties = {
    padding: '4px 10px', borderRadius: 8, fontSize: 12,
    border: '1px solid var(--border)', fontFamily: 'DM Sans,sans-serif',
    color: 'var(--text)', background: 'white', outline: 'none',
    cursor: 'pointer', colorScheme: 'light' as React.CSSProperties['colorScheme'],
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Panels */}
      {selectedTranscript && (
        <TranscriptPanel call={selectedTranscript} onClose={() => setSelectedTranscript(null)} />
      )}
      {selectedAnomalie && (
        <AnomalieTraitementModal
          call={selectedAnomalie}
          rappel={selectedAnomalie.conv_id ? rappelByConvId.get(selectedAnomalie.conv_id) : undefined}
          treatment={selectedAnomalie.conv_id ? localTreatments[selectedAnomalie.conv_id] : undefined}
          onClose={() => setSelectedAnomalie(null)}
          onTreat={onTreat}
          onViewTranscript={selectedAnomalie.transcript ? () => {
            const c = selectedAnomalie;
            setSelectedAnomalie(null);
            setSelectedTranscript(c);
          } : undefined}
        />
      )}

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
        <KPICard value={totalAnomalies}           label="Total anomalies"  icon={AlertTriangle} delay="0s"    accentColor="#ef4444"       bgColor="#fef2f2" />
        <KPICard value={pendingCount}             label="Non traitées"      icon={Circle}        delay="0.06s" accentColor="#f97316"       bgColor="#fff7ed" />
        <KPICard value={treatedCount}             label="Traitées"          icon={CheckCircle}   delay="0.12s" accentColor="#22c55e"       bgColor="#f0fdf4" />
        <KPICard value={`${tauxResolution}%`}     label="Taux résolution"   icon={BarChart2}     delay="0.18s" accentColor="var(--blue)"   bgColor="var(--blue-light)" />
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="card animate-fade-up-3" style={{ padding: '22px 24px' }}>
          <p className="section-label">Anomalies par jour — 7 jours</p>
          <div style={{ height: 200 }}><Bar data={barData} options={barOpts} /></div>
        </div>
        <div className="card animate-fade-up-4" style={{ padding: '22px 24px' }}>
          <p className="section-label">Répartition par motif</p>
          {donutLabels.length > 0
            ? <div style={{ height: 200 }}><Doughnut data={donutData} options={donutOpts} /></div>
            : <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>Aucune anomalie</div>
          }
        </div>
      </div>

      {/* Table */}
      <div className="card animate-fade-up" style={{ overflow: 'hidden' }}>

        {/* Header + status tabs */}
        <div style={{
          padding: '14px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={14} style={{ color: '#ef4444' }} />
            <h3 style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 15 }}>
              Liste des anomalies
            </h3>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {allGroups.length !== anomalieCalls.length
                ? `${filtered.length} appels · ${allGroups.length} numéros`
                : `${anomalieCalls.length} appels · ${allGroups.length} numéros`}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([
              { k: 'all'     as AnomalieStatusFilter, label: 'Toutes' },
              { k: 'pending' as AnomalieStatusFilter, label: '⏳ Non traitées' },
              { k: 'done'    as AnomalieStatusFilter, label: '✅ Traitées' },
            ]).map(({ k, label }) => (
              <button key={k} className={`filter-tab${statusFilter === k ? ' active' : ''}`}
                onClick={() => { setStatusFilter(k); setCurrentPage(1); }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Date preset bar */}
        <div style={{
          padding: '10px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          background: '#fff8f8',
        }}>
          {([
            { key: 'all'   as DatePreset, label: 'Tout' },
            { key: 'today' as DatePreset, label: "Aujourd'hui" },
            { key: 'week'  as DatePreset, label: '7 jours' },
          ]).map(({ key, label }) => (
            <button key={key} className={`filter-tab${datePreset === key ? ' active' : ''}`}
              onClick={() => { applyDatePreset(key); setCurrentPage(1); }}>
              {label}
            </button>
          ))}
          <span style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0, margin: '0 2px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="date" value={dateFrom} max={dateTo || todayISO} style={inputStyle}
              onChange={e => { setDateFrom(e.target.value); setDatePreset('custom'); setCurrentPage(1); }} />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>→</span>
            <input type="date" value={dateTo} min={dateFrom} max={todayISO} style={inputStyle}
              onChange={e => { setDateTo(e.target.value); setDatePreset('custom'); setCurrentPage(1); }} />
          </div>
          {datePreset === 'custom' && (
            <button onClick={() => { applyDatePreset('all'); setCurrentPage(1); }}
              style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'DM Sans,sans-serif', padding: '2px 4px' }}>
              Réinitialiser
            </button>
          )}
        </div>

        {/* Search + motif filter */}
        <div style={{
          padding: '10px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          background: 'white',
        }}>
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 200, maxWidth: 320 }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
            <input type="search" value={searchPhone}
              onChange={e => { setSearchPhone(e.target.value); setCurrentPage(1); }}
              placeholder="Rechercher un numéro…"
              style={{ ...inputStyle, width: '100%', paddingLeft: 30, cursor: 'text' }}
            />
            {searchPhone && (
              <button onClick={() => { setSearchPhone(''); setCurrentPage(1); }}
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'var(--blue-faint)', border: 'none', borderRadius: 5, cursor: 'pointer', padding: 3, display: 'flex' }}>
                <X size={11} style={{ color: 'var(--muted)' }} />
              </button>
            )}
          </div>
          <select value={motifFilter} onChange={e => { setMotifFilter(e.target.value); setCurrentPage(1); }}
            style={{ ...inputStyle, minWidth: 130 }}>
            <option value="">Tous motifs</option>
            {motifOptions.map(m => <option key={m} value={m}>{MOTIF_LABELS[m] || m}</option>)}
          </select>
          {(searchPhone || motifFilter || dateFrom || dateTo) && (
            <button onClick={() => { setSearchPhone(''); setMotifFilter(''); applyDatePreset('all'); setCurrentPage(1); }}
              style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'DM Sans,sans-serif', padding: '2px 4px' }}>
              Effacer les filtres
            </button>
          )}
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date / Heure</th>
                <th>Numéro</th>
                <th>Motif IA</th>
                <th>Sentiment</th>
                <th>Durée</th>
                <th>Traitement</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedGroups.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                    {statusFilter === 'done'    ? '📭 Aucune anomalie traitée' :
                     statusFilter === 'pending' ? '✅ Toutes les anomalies sont traitées !' :
                     '📭 Aucune anomalie sur cette période'}
                  </td>
                </tr>
              ) : pagedGroups.map(g => {
                const expanded    = expandedPhones.has(g.phone);
                const hasMultiple = g.all.length > 1;

                const AnomalieRow = ({ c, sub }: { c: RecentCall; sub?: boolean }) => {
                  const traite    = isTraite(c);
                  const treatment = getTreatment(c);
                  const rappel    = c.conv_id ? rappelByConvId.get(c.conv_id) : undefined;
                  const reason    = rappel ? (CALLBACK_LABELS[rappel.motif] || rappel.motif) : undefined;
                  return (
                    <tr style={{ opacity: traite ? 0.72 : 1, background: sub ? 'var(--bg)' : undefined }}>
                      <td style={{ whiteSpace: 'nowrap', paddingLeft: sub ? 32 : undefined }}>
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{c.date}</span>
                        <span style={{ fontWeight: 600, fontFamily: 'Lexend,sans-serif', marginLeft: 6 }}>{c.heure}</span>
                      </td>
                      <td>—</td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, background: 'var(--blue-light)', color: 'var(--blue-dark)', fontWeight: 600, display: 'inline-block' }}>
                            {MOTIF_LABELS[c.motif_ia] || c.motif_ia}
                          </span>
                          {reason && (
                            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: '#fef2f2', color: '#dc2626', fontWeight: 600, display: 'inline-block' }}>
                              ⚠ {reason}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: SENT_COLORS[c.sentiment] || '#94a3b8' }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: SENT_COLORS[c.sentiment] || '#94a3b8', flexShrink: 0 }} />
                          {c.sentiment.charAt(0).toUpperCase() + c.sentiment.slice(1)}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace', color: 'var(--muted)', fontSize: 13 }}>{c.duration}s</td>
                      <td style={{ minWidth: 200 }}>
                        {traite ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, background: '#f0fdf4', color: '#16a34a', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <CheckCircle size={10} /> Clôturé
                            </span>
                            {treatment?.le && (
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>👤 {treatment.par || '—'} · {treatment.le}</span>
                            )}
                            {treatment?.remarque && (
                              <span style={{
                                fontSize: 11, color: '#475569', fontStyle: 'italic',
                                background: '#f8fafc', padding: '2px 7px', borderRadius: 5,
                                borderLeft: '2px solid #cbd5e1',
                                maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
                              }}>
                                {treatment.remarque}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, background: '#fff7ed', color: '#c2410c', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <Circle size={9} /> À traiter
                          </span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => setSelectedAnomalie(c)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 5,
                              padding: '4px 10px', borderRadius: 7, fontSize: 12,
                              fontWeight: 700, fontFamily: 'Lexend,sans-serif',
                              cursor: 'pointer', border: 'none',
                              background: traite ? '#e2f4ec' : '#dc2626',
                              color: traite ? '#16a34a' : 'white',
                            }}
                          >
                            {traite ? <><CheckCircle size={12} /> Détails</> : <><AlertTriangle size={12} /> Traiter</>}
                          </button>
                          {c.transcript && (
                            <button onClick={() => setSelectedTranscript(c)} className="btn btn-ghost btn-sm">
                              <MessageSquare size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                };

                return (
                  <React.Fragment key={`grp-${g.phone}`}>
                    {/* Group header — phone */}
                    <tr style={{ background: '#f8fafc' }}>
                      <td colSpan={7} style={{ padding: '6px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div className="phone-cell">
                            <PhoneLink phone={g.phone} />
                            {g.phone && g.phone !== '—' && (
                              <button className="phone-timeline-btn" title="Historique patient" onClick={() => onTimeline(g.phone)}>
                                <History size={12} />
                              </button>
                            )}
                          </div>
                          {hasMultiple && (
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ fontSize: 11, padding: '2px 8px' }}
                              onClick={() => toggleExpand(g.phone)}
                            >
                              {expanded ? '▲' : '▼'} {g.all.length} anomalie{g.all.length > 1 ? 's' : ''}
                            </button>
                          )}
                          {g.pendingCount > 0 ? (
                            <span style={{ fontSize: 11, color: '#f97316', fontWeight: 600 }}>
                              {g.pendingCount} à traiter
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>✓ Tout traité</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Latest call — always visible */}
                    <AnomalieRow c={g.latest} />
                    {/* Rest — shown when expanded */}
                    {expanded && g.all.slice(1).map((c, i) => (
                      <AnomalieRow key={`sub-${c.conv_id ?? i}`} c={c} sub />
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            padding: '12px 24px', borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: '#fff8f8', flexWrap: 'wrap', gap: 10,
          }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'DM Sans,sans-serif' }}>
              Affichage <strong style={{ color: 'var(--text)' }}>
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, allGroups.length)}
              </strong> sur <strong style={{ color: 'var(--text)' }}>{allGroups.length}</strong> numéros
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={safePage === 1} style={{ opacity: safePage === 1 ? 0.35 : 1 }}>‹ Précédent</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages} style={{ opacity: safePage === totalPages ? 0.35 : 1 }}>Suivant ›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

type View = 'overview' | 'appels' | 'rappels' | 'anomalies' | 'users' | 'recouvrement' | 'facturation';

export default function App() {
  const { user, login, logout }       = useAuth();
  const { data, loading, refresh, lastRefresh, hasNewUrgent, dismissNewUrgent } = useData();
  const [view, setView]               = useState<View>('overview');

  // Redirect recouvrement role to their view on login
  useEffect(() => {
    if (user?.role === 'recouvrement') setView('recouvrement');
    if (user?.role === 'facturation')  setView('facturation');
  }, [user?.role]);
  const [refreshing, setRefreshing]   = useState(false);
  const [timelinePhone, setTimelinePhone] = useState<string | null>(null);

  // ── Anomalie treatment state (shared across AppelsView & AnomaliesView) ───
  const [localTreatments, setLocalTreatments] = useState<Record<string, TreatmentRecord>>({});

  const rappelByConvId = useMemo(
    () => new Map((data?.rappels ?? []).filter(r => r.conv_id).map(r => [r.conv_id!, r])),
    [data?.rappels]
  );

  const onTreat = useCallback(async (
    conv_id: string, remarque: string, phone?: string, motif?: string,
  ) => {
    const nom = user?.nom || user?.username || '';
    const now = new Date().toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    setLocalTreatments(prev => ({
      ...prev,
      [conv_id]: { statut: 'DONE', diagnostic: '', remarque, par: nom, le: now },
    }));
    await markRappelDone(conv_id, nom, remarque, phone, motif);
  }, [user]);

  // Reset local treatments when fresh data arrives
  useEffect(() => { setLocalTreatments({}); }, [data]);

  const openTimeline = (phone: string) => setTimelinePhone(phone);

  // ── Login gate ───────────────────────────────────────────────
  if (!user) return <LoginPage onLogin={login} />;

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setTimeout(() => setRefreshing(false), 700);
  };

  const navItems: { id: View; label: string; icon: React.ElementType; visibleRoles?: string[] }[] = [
    { id: 'overview',     label: "Vue d'ensemble",  icon: BarChart2,     visibleRoles: ['admin', 'conseillere'] },
    { id: 'appels',       label: 'Appels récents',   icon: PhoneCall,     visibleRoles: ['admin', 'conseillere'] },
    { id: 'rappels',      label: 'Rappels',           icon: Bell,          visibleRoles: ['admin', 'conseillere'] },
    { id: 'anomalies',    label: 'Anomalies',         icon: AlertTriangle, visibleRoles: ['admin', 'conseillere'] },
    { id: 'recouvrement', label: 'Recouvrement',      icon: Briefcase,     visibleRoles: ['admin', 'recouvrement'] },
    { id: 'facturation',  label: 'Facturation',        icon: Receipt,       visibleRoles: ['admin', 'recouvrement', 'facturation'] },
    { id: 'users',        label: 'Utilisateurs',      icon: Users,         visibleRoles: ['admin'] },
  ];

  const titleMap: Record<View, string> = {
    overview:     "Vue d'ensemble",
    appels:       'Appels récents',
    rappels:      'Rappels',
    anomalies:    'Anomalies',
    recouvrement: 'Recouvrement',
    facturation:  'Facturation',
    users:        'Utilisateurs',
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>

      {/* ── Urgent toast ─────────────────────────────────────── */}
      {hasNewUrgent && user.role !== 'recouvrement' && (
        <div
          className="urgent-toast"
          onClick={() => { setView('rappels'); dismissNewUrgent(); }}
        >
          <AlertTriangle size={14} />
          <span>Nouveau rappel URGENT</span>
          <button
            className="toast-dismiss"
            onClick={e => { e.stopPropagation(); dismissNewUrgent(); }}
          >
            <X size={11} />
          </button>
        </div>
      )}

      {/* ── Patient timeline ──────────────────────────────────── */}
      {timelinePhone && data && (
        <PatientTimelinePanel
          phone={timelinePhone}
          calls={data.recent_calls}
          rappels={data.rappels}
          onClose={() => setTimelinePhone(null)}
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside style={{
        width: 240, background: 'white',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        height: '100vh', flexShrink: 0, overflow: 'hidden',
      }}>
        {/* Brand */}
        <div style={{ padding: '20px 18px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 11,
              background: 'linear-gradient(135deg, #2d7fc2 0%, #1a5ea0 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 19, flexShrink: 0,
              boxShadow: '0 2px 8px rgba(45,127,194,.35)',
            }}>🎙</div>
            <div>
              <div style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 800, fontSize: 16, color: 'var(--text)', lineHeight: 1.1 }}>
                Amélie
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 1, letterSpacing: '0.2px' }}>
                Tire-Lait Express
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '14px 10px', flex: 1 }}>
          <p style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase',
            color: '#94aab9', padding: '0 8px', marginBottom: 8, fontFamily: 'Lexend,sans-serif',
          }}>Navigation</p>
          {navItems
            .filter(item => !item.visibleRoles || item.visibleRoles.includes(user.role))
            .map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`nav-item${view === id ? ' active' : ''}`}
            >
              <Icon size={15} />
              {label}
              {id === 'rappels' && data && data.kpis.rappels_pending > 0 && (
                <span style={{
                  marginLeft: 'auto', background: 'var(--orange)', color: 'white',
                  fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '1px 7px',
                  fontFamily: 'Lexend,sans-serif',
                }}>
                  {data.kpis.rappels_pending}
                </span>
              )}
              {id === 'anomalies' && data && (() => {
                const unresolved = data.recent_calls.filter(c =>
                  c.anomalie === 'OUI' && c.conv_id && !localTreatments[c.conv_id] &&
                  rappelByConvId.get(c.conv_id)?.statut !== 'DONE'
                ).length;
                return unresolved > 0 ? (
                  <span style={{
                    marginLeft: 'auto', background: '#dc2626', color: 'white',
                    fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '1px 7px',
                    fontFamily: 'Lexend,sans-serif',
                  }}>
                    {unresolved}
                  </span>
                ) : null;
              })()}
            </button>
          ))}
        </nav>

        {/* User + Status */}
        <div style={{ padding: '10px 12px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Connected user */}
          <div style={{
            padding: '10px 12px', background: 'var(--blue-faint)',
            borderRadius: 10, border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 9,
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
              background: user.role === 'admin'
                ? 'linear-gradient(135deg,#6366f1,#4f46e5)'
                : user.role === 'recouvrement'
                  ? 'linear-gradient(135deg,#d97706,#b45309)'
                  : user.role === 'facturation'
                    ? 'linear-gradient(135deg,#0d9488,#0f766e)'
                  : 'linear-gradient(135deg,#2d7fc2,#1a5ea0)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 800, color: 'white', fontFamily: 'Lexend,sans-serif',
            }}>
              {user.nom.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', fontFamily: 'Lexend,sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.nom}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                {user.role === 'admin' ? '🛡 Admin'
                  : user.role === 'recouvrement' ? '💼 Recouvrement'
                  : user.role === 'facturation' ? '🧾 Facturation'
                  : '👤 Conseillère'}
              </div>
            </div>
            <button
              onClick={logout}
              title="Déconnexion"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex', padding: 4, borderRadius: 6, flexShrink: 0 }}
            >
              <LogOut size={14} />
            </button>
          </div>

          {/* Live status */}
          <div style={{ padding: '10px 12px', background: 'var(--blue-faint)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
              <span className="live-dot" />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#16a34a' }}>Amélie active</span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
              Mis à jour · {lastRefresh.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })}
              <span className="auto-refresh-dot" title="Actualisation auto toutes les 30s" />
            </p>
          </div>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────── */}
      <main style={{ flex: 1, padding: '28px 32px', overflow: 'auto', minWidth: 0, minHeight: 0, overscrollBehavior: 'contain' }}>
        {/* Page header */}
        <div
          className="animate-fade-up"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}
        >
          <div>
            <h1 style={{ fontFamily: 'Lexend,sans-serif', fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--text)' }}>
              {titleMap[view]}
            </h1>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
              {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })}
            </p>
          </div>
          {/*
            Masqué sur Facturation : ce bouton rafraîchit les données de l'entrant
            (`useData`), dont cette vue ne se sert pas — il aurait donc l'air de faire
            quelque chose sans rien faire, à côté du bouton « Actualiser » de la vue.
            Recouvrement a la même particularité, laissée en place pour l'instant.
          */}
          {view !== 'facturation' && (
            <button onClick={handleRefresh} className="btn btn-ghost">
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              Actualiser
            </button>
          )}
        </div>

        {/* Content */}
        {view === 'recouvrement' ? (
          <RecouvrementView user={user} />
        ) : view === 'facturation' ? (
          <FacturationView user={user} />
        ) : loading && !data ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: 400, gap: 14, color: 'var(--muted)',
          }}>
            <RefreshCw size={28} style={{ color: 'var(--blue)', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ fontSize: 14 }}>Chargement des données…</p>
          </div>
        ) : data ? (
          <>
            {view === 'overview'  && <Overview data={data} rappelByConvId={rappelByConvId} localTreatments={localTreatments} />}
            {view === 'appels'    && (
              <AppelsView
                data={data}
                onTimeline={openTimeline}
                rappelByConvId={rappelByConvId}
                localTreatments={localTreatments}
                onTreat={onTreat}
              />
            )}
            {view === 'rappels'   && <RappelsView data={data} onTimeline={openTimeline} />}
            {view === 'anomalies' && (
              <AnomaliesView
                data={data}
                rappelByConvId={rappelByConvId}
                localTreatments={localTreatments}
                onTreat={onTreat}
                onTimeline={openTimeline}
              />
            )}
            {view === 'users'     && user.role === 'admin' && <UsersView currentUser={user} />}
          </>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--muted)', marginTop: 80, fontSize: 14 }}>
            <Phone size={32} strokeWidth={1.5} style={{ marginBottom: 12, opacity: .4 }} />
            <p>Aucune donnée disponible</p>
          </div>
        )}
      </main>
    </div>
  );
}
