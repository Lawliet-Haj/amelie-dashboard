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
  Circle, Filter,
} from 'lucide-react';
import { useData } from './hooks/useData';
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

async function markRappelDone(convId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/webhook/dashboard-mark-rappel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conv_id: convId, statut: 'DONE' }),
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

function AppelsView({ data }: { data: NonNullable<ReturnType<typeof useData>['data']> }) {
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
                  <td><PhoneLink phone={c.phone} /></td>
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

function RappelsView({ data }: { data: NonNullable<ReturnType<typeof useData>['data']> }) {
  const [filter, setFilter] = useState<RappelFilter>('pending');
  const [localStatus, setLocalStatus] = useState<Record<string, 'PENDING' | 'DONE'>>({});
  const [loadingIds, setLoadingIds] = useState<Record<string, boolean>>({});
  const [selectedRappel, setSelectedRappel] = useState<Rappel | null>(null);

  // Reset local overrides whenever fresh data arrives (avoids hiding new entries with same conv_id)
  useEffect(() => {
    setLocalStatus({});
    setLoadingIds({});
  }, [data]);

  const getStatut = useCallback((r: Rappel) =>
    localStatus[r.conv_id] ?? r.statut ?? 'PENDING'
  , [localStatus]);

  const handleMark = useCallback(async (r: Rappel) => {
    if (!r.conv_id || loadingIds[r.conv_id]) return;
    setLoadingIds(prev => ({ ...prev, [r.conv_id]: true }));
    setLocalStatus(prev => ({ ...prev, [r.conv_id]: 'DONE' })); // optimistic
    const ok = await markRappelDone(r.conv_id);
    if (!ok) setLocalStatus(prev => ({ ...prev, [r.conv_id]: 'PENDING' })); // revert
    setLoadingIds(prev => ({ ...prev, [r.conv_id]: false }));
  }, [loadingIds]);

  const filtered = [...data.rappels]
    .filter(r => {
      const s = getStatut(r);
      if (filter === 'pending') return s !== 'DONE';
      if (filter === 'urgent')  return s !== 'DONE' && r.priorite === 'URGENT';
      if (filter === 'done')    return s === 'DONE';
      return true;
    })
    .sort((a, b) => {
      // PENDING before DONE
      const sa = getStatut(a), sb = getStatut(b);
      if (sa !== sb) return sa === 'PENDING' ? -1 : 1;
      // Most recent first (date_full = YYYY-MM-DD for cross-month accuracy)
      const keyA = `${a.date_full || a.date} ${a.heure}`;
      const keyB = `${b.date_full || b.date} ${b.heure}`;
      return keyB.localeCompare(keyA);
    });

  const pendingCount = data.rappels.filter(r => getStatut(r) !== 'DONE').length;
  const urgentCount  = data.rappels.filter(r => getStatut(r) !== 'DONE' && r.priorite === 'URGENT').length;
  const doneCount    = data.rappels.filter(r => getStatut(r) === 'DONE').length;

  // Build a RecentCall-compatible object for TranscriptPanel
  const rappelAsCall = (r: Rappel): RecentCall => ({
    date: r.date, date_full: r.date_full, heure: r.heure, phone: r.phone,
    duration: 0, motif_ia: r.motif, action: '—', sentiment: 'neutre',
    anomalie: 'NON', transcript: r.transcript, conv_id: r.conv_id,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {selectedRappel && (
        <TranscriptPanel call={rappelAsCall(selectedRappel)} onClose={() => setSelectedRappel(null)} />
      )}
      {/* Summary cards — clickable to filter */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {([
          { key: 'pending' as RappelFilter, count: pendingCount, Icon: Bell,          color: '#f5a128', border: '#f5a128', bg: '#fff4e2', label: 'en attente' },
          ...(urgentCount > 0 ? [
            { key: 'urgent'  as RappelFilter, count: urgentCount,  Icon: AlertTriangle, color: '#ef4444', border: '#ef4444', bg: '#fef2f2', label: 'URGENT' }
          ] : []),
          { key: 'done'    as RappelFilter, count: doneCount,    Icon: CheckCircle,   color: '#22c55e', border: '#22c55e', bg: '#f0fdf4', label: 'rappelés' },
        ] as { key: RappelFilter; count: number; Icon: React.ElementType; color: string; border: string; bg: string; label: string }[]).map(({ key, count, Icon, color, border, bg, label }) => {
          const isActive = filter === key;
          return (
            <div
              key={key}
              className="card"
              onClick={() => setFilter(isActive ? 'all' : key)}
              style={{
                padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10,
                borderTop: `3px solid ${border}`,
                cursor: 'pointer',
                background: isActive ? bg : 'white',
                boxShadow: isActive
                  ? `0 0 0 2px ${border}55, 0 4px 12px rgba(0,0,0,.06)`
                  : '0 1px 4px rgba(26,43,66,.05)',
                transform: isActive ? 'translateY(-2px)' : 'none',
                transition: 'all 0.15s',
              }}
            >
              <Icon size={15} style={{ color }} />
              <span style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 800, fontSize: 22, color: isActive ? color : 'var(--text)' }}>
                {count}
              </span>
              <span style={{ fontSize: 13, color: isActive ? color : 'var(--muted)', fontWeight: isActive ? 600 : 400 }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Table */}
      <div className="card animate-fade-up" style={{ overflow: 'hidden' }}>
        <div style={{
          padding: '14px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Filter size={14} style={{ color: 'var(--muted)' }} />
            <h3 style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 15 }}>Rappels</h3>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['all', 'pending', 'urgent', 'done'] as RappelFilter[]).map(f => (
              <button
                key={f}
                className={`filter-tab${filter === f ? ' active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'Tous' : f === 'pending' ? 'En attente' : f === 'urgent' ? '🔴 Urgent' : 'Rappelés'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                {['Statut', 'Priorité', 'Date', 'Heure', 'Téléphone', 'Motif', 'Action', 'Transcript'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const done = getStatut(r) === 'DONE';
                const isLoading = loadingIds[r.conv_id];
                return (
                  <tr key={i} style={{ opacity: done ? 0.55 : 1, transition: 'opacity 0.3s' }}>
                    <td>
                      {done
                        ? <span className="badge-done"><CheckCircle size={11} />Rappelé</span>
                        : <span className="badge-pending"><Circle size={9} />En attente</span>
                      }
                    </td>
                    <td>
                      {r.priorite === 'URGENT'
                        ? <span className="badge-urgent">🔴 URGENT</span>
                        : <span className="badge-normal">NORMAL</span>
                      }
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--muted)' }}>{r.date}</td>
                    <td style={{ fontWeight: 600, fontFamily: 'Lexend,sans-serif' }}>{r.heure}</td>
                    <td><PhoneLink phone={r.phone} /></td>
                    <td>
                      <span style={{
                        fontSize: 11, padding: '3px 9px', borderRadius: 6,
                        background: '#f0f5fa', color: 'var(--muted)', fontWeight: 500,
                      }}>
                        {CALLBACK_LABELS[r.motif] || r.motif}
                      </span>
                    </td>
                    <td>
                      {!done && r.conv_id && (
                        <button
                          onClick={() => handleMark(r)}
                          disabled={isLoading}
                          className="btn btn-success btn-sm"
                        >
                          <CheckCircle size={13} />
                          {isLoading ? '…' : 'Marquer rappelé'}
                        </button>
                      )}
                    </td>
                    <td>
                      {r.transcript && (
                        <button onClick={() => setSelectedRappel(r)} className="btn btn-ghost btn-sm">
                          <MessageSquare size={13} />
                          Voir
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                    {filter === 'done' ? '📭 Aucun rappel effectué' : '✅ Aucun rappel en attente'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

type View = 'overview' | 'appels' | 'rappels';

export default function App() {
  const { data, loading, refresh, lastRefresh } = useData();
  const [view, setView] = useState<View>('overview');
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setTimeout(() => setRefreshing(false), 700);
  };

  const navItems: { id: View; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: "Vue d'ensemble", icon: BarChart2  },
    { id: 'appels',   label: 'Appels récents',  icon: PhoneCall },
    { id: 'rappels',  label: 'Rappels',          icon: Bell      },
  ];

  const titleMap: Record<View, string> = {
    overview: "Vue d'ensemble",
    appels:   'Appels récents',
    rappels:  'Rappels',
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>

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
          {navItems.map(({ id, label, icon: Icon }) => (
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

        {/* Status */}
        <div style={{ padding: '10px 12px 18px' }}>
          <div style={{
            padding: '12px 14px', background: 'var(--blue-faint)',
            borderRadius: 10, border: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
              <span className="live-dot" />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#16a34a' }}>Amélie active</span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--muted)' }}>
              Mis à jour · {lastRefresh.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
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
            {view === 'appels'   && <AppelsView data={data} />}
            {view === 'rappels'  && <RappelsView data={data} />}
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
