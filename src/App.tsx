import { useState, useCallback, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  ArcElement, Tooltip, Legend,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Phone, AlertTriangle, Clock, Bell, RefreshCw,
  BarChart2, PhoneCall, X, MessageSquare, CheckCircle,
  Circle, Filter, History, Users, LogOut,
} from 'lucide-react';
import { useData } from './hooks/useData';
import { useAuth } from './hooks/useAuth';
import { UsersView } from './views/UsersView';
import type { Rappel, RecentCall } from './types';

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

async function markRappelDone(convId: string, rappele_par: string, remarque: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/webhook/dashboard-mark-rappel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conv_id: convId, statut: 'DONE', rappele_par, remarque }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

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
    <>
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
    </>
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
    <>
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
    </>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({ value, label, icon: Icon, delay, accentColor, bgColor, sub }: {
  value: string | number;
  label: string;
  icon: React.ElementType;
  delay: string;
  accentColor: string;
  bgColor: string;
  sub?: string;
}) {
  return (
    <div
      className="card animate-fade-up"
      style={{ padding: '20px 22px', animationDelay: delay, borderTop: `3px solid ${accentColor}` }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <span style={{
          fontFamily: 'Lexend,sans-serif', fontSize: 10.5, fontWeight: 700,
          letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--muted)',
        }}>{label}</span>
        <div style={{
          width: 34, height: 34, borderRadius: 9, background: bgColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon size={15} style={{ color: accentColor }} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{
          fontFamily: 'Lexend,sans-serif', fontSize: 38, fontWeight: 800,
          lineHeight: 1, color: 'var(--text)',
        }}>{value}</span>
        {sub && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</span>}
      </div>
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function Overview({ data }: { data: NonNullable<ReturnType<typeof useData>['data']> }) {
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
        <KPICard value={data.kpis.anomalies_week}       label="Anomalies"      icon={AlertTriangle} delay="0.06s"  accentColor="#ef4444"       bgColor="#fef2f2" />
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
  data, onTimeline,
}: {
  data: NonNullable<ReturnType<typeof useData>['data']>;
  onTimeline: (phone: string) => void;
}) {
  const [selected, setSelected] = useState<RecentCall | null>(null);
  const [sortCol, setSortCol]   = useState<AppelSortCol>('datetime');
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('desc');
  const [preset, setPreset]     = useState<DatePreset>('today');
  const [dateFrom, setDateFrom] = useState<string>(todayISO);
  const [dateTo, setDateTo]     = useState<string>(todayISO);

  const applyPreset = (p: DatePreset) => {
    setPreset(p);
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

  // Date filter (compare ISO strings)
  const filtered = sorted.filter(c => {
    if (!dateFrom && !dateTo) return true;
    const d = c.date_full ?? toKey(c).slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo   && d > dateTo)   return false;
    return true;
  });

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
      <div className="card animate-fade-up" style={{ overflow: 'hidden' }}>

        {/* Header */}
        <div style={{
          padding: '14px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h3 style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 15 }}>Appels récents</h3>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {filtered.length === data.recent_calls.length
              ? `${filtered.length} appels`
              : `${filtered.length} / ${data.recent_calls.length} appels`}
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
              onChange={e => { setDateFrom(e.target.value); setPreset('custom'); }}
            />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>→</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              max={todayISO}
              style={inputStyle}
              onChange={e => { setDateTo(e.target.value); setPreset('custom'); }}
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
                <th>Transcript</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
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
                    {c.anomalie === 'OUI'
                      ? <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, background: '#fef2f2', color: '#dc2626', fontWeight: 700 }}>⚠ OUI</span>
                      : <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, background: '#f0fdf4', color: '#16a34a', fontWeight: 500 }}>✓ NON</span>
                    }
                  </td>
                  <td>
                    <button onClick={() => setSelected(c)} className="btn btn-ghost btn-sm">
                      <MessageSquare size={13} />
                      Voir
                    </button>
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

  // Build groups from all rappels, then filter at group level
  const allGroups = buildRappelGroups(data.rappels, getStatut);
  const groups = allGroups.filter(g => {
    if (filter === 'pending') return g.pendingCount > 0;
    if (filter === 'urgent')  return g.hasUrgent;
    if (filter === 'done')    return g.pendingCount === 0;
    return true;
  });

  const pendingCount = allGroups.reduce((n, g) => n + g.pendingCount, 0);
  const urgentCount  = allGroups.filter(g => g.hasUrgent).reduce((n, g) => n + g.all.filter(r => getStatut(r) !== 'DONE' && r.priorite === 'URGENT').length, 0);
  const doneGroups   = allGroups.filter(g => g.pendingCount === 0).length;

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

// ─── Main App ─────────────────────────────────────────────────────────────────

type View = 'overview' | 'appels' | 'rappels' | 'users';

export default function App() {
  const { user, login, logout }       = useAuth();
  const { data, loading, refresh, lastRefresh, hasNewUrgent, dismissNewUrgent } = useData();
  const [view, setView]               = useState<View>('overview');
  const [refreshing, setRefreshing]   = useState(false);
  const [timelinePhone, setTimelinePhone] = useState<string | null>(null);

  const openTimeline = (phone: string) => setTimelinePhone(phone);

  // ── Login gate ───────────────────────────────────────────────
  if (!user) return <LoginPage onLogin={login} />;

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setTimeout(() => setRefreshing(false), 700);
  };

  const navItems: { id: View; label: string; icon: React.ElementType; adminOnly?: boolean }[] = [
    { id: 'overview', label: "Vue d'ensemble", icon: BarChart2  },
    { id: 'appels',   label: 'Appels récents',  icon: PhoneCall },
    { id: 'rappels',  label: 'Rappels',          icon: Bell      },
    { id: 'users',    label: 'Utilisateurs',     icon: Users, adminOnly: true },
  ];

  const titleMap: Record<View, string> = {
    overview: "Vue d'ensemble",
    appels:   'Appels récents',
    rappels:  'Rappels',
    users:    'Utilisateurs',
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>

      {/* ── Urgent toast ─────────────────────────────────────── */}
      {hasNewUrgent && (
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
        width: 240, minHeight: '100vh', background: 'white',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        position: 'sticky', top: 0, height: '100vh', flexShrink: 0,
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
            .filter(item => !item.adminOnly || user.role === 'admin')
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
                {user.role === 'admin' ? '🛡 Admin' : '👤 Conseillère'}
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
              Mis à jour · {lastRefresh.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              <span className="auto-refresh-dot" title="Actualisation auto toutes les 30s" />
            </p>
          </div>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────── */}
      <main style={{ flex: 1, padding: '28px 32px', overflow: 'auto', minWidth: 0 }}>
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
              {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <button onClick={handleRefresh} className="btn btn-ghost">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Actualiser
          </button>
        </div>

        {/* Content */}
        {loading && !data ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: 400, gap: 14, color: 'var(--muted)',
          }}>
            <RefreshCw size={28} style={{ color: 'var(--blue)', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ fontSize: 14 }}>Chargement des données…</p>
          </div>
        ) : data ? (
          <>
            {view === 'overview' && <Overview data={data} />}
            {view === 'appels'   && <AppelsView  data={data} onTimeline={openTimeline} />}
            {view === 'rappels'  && <RappelsView data={data} onTimeline={openTimeline} />}
            {view === 'users'    && user.role === 'admin' && <UsersView currentUser={user} />}
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
