/**
 * LE TRANSCRIPT D'UN APPEL — panneau latéral, en lecture seule.
 *
 * ⚠️ EXTRAIT DE `RecouvrementView` LE 2026-09-21, sans rien changer à son rendu. Il y
 * vivait comme fonction locale ; le Contrôle de journée en avait besoin à son tour, et
 * en recopier une seconde version est exactement ce que `src/ui/` existe pour empêcher —
 * `Chip` avait fini en TROIS versions divergentes, avec des verts différents pour le
 * même état.
 *
 * ⚠️ Il reste une TROISIÈME implémentation dans `App.tsx`, pour les appels ENTRANTS : elle
 * travaille sur `RecentCall` et non sur `Relance`, et son format de transcript diffère.
 * La fusionner demande d'unifier les deux formes d'abord — ce n'est pas un oubli, c'est
 * une dette nommée.
 */
import { useEffect } from 'react';
import { X, MessageSquare } from 'lucide-react';
import type { Relance } from '../types';
import { Portal } from '../lib/Portal';
import { formatDateTime, formatDuration } from '../lib/format';

const SENTIMENT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  positif: { label: '😊 Positif', color: '#15803d', bg: '#dcfce7' },
  neutre:  { label: '😐 Neutre',  color: '#d97706', bg: '#fef3c7' },
  negatif: { label: '😞 Négatif', color: '#dc2626', bg: '#fef2f2' },
};

/**
 * ⚠️ Le transcript arrive préfixé `[Amélie]` / `[Agent]` / `[Patient]`, une ligne par tour.
 * Toute ligne qui ne porte aucun de ces préfixes est ignorée — mieux vaut un panneau plus
 * court qu'une ligne attribuée au mauvais interlocuteur.
 *
 * ⚠️⚠️ RAPPEL DE LECTURE : l'annonce d'un répondeur est transcrite par ElevenLabs comme de
 * la PAROLE PATIENTE. Une bulle « Patient » qui dit « vous êtes bien sur la messagerie du
 * 06… » n'est donc pas une personne : c'est une machine. C'est le piège documenté qui a
 * imposé un classement déterministe côté W3.
 */
// /!\ Volontairement NON exportee : un fichier de composants qui exporte aussi des
// fonctions casse le Fast Refresh de Vite (regle `react-refresh/only-export-components`).
// Le jour ou un autre ecran en aura besoin, elle ira dans `src/lib/`, pas ici.
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

export function TranscriptPanel({ relance, onClose }: { relance: Relance; onClose: () => void }) {
  const messages = parseTranscript(relance.transcript);
  const hasSentiment = relance.sentiment && SENTIMENT_CONFIG[relance.sentiment];
  useEffect(() => {
    const main = document.querySelector('main') as HTMLElement | null;
    if (main) { main.style.overflow = 'hidden'; return () => { main.style.overflow = 'auto'; }; }
  }, []);
  return (
    // ⚠️ PORTAIL OBLIGATOIRE — ne pas retirer. Les animations `fadeUp` des vues portent un
    // `transform`, qui fait de l'ancêtre le bloc conteneur de tout `position: fixed` : le
    // panneau se positionnait alors par rapport au haut de la liste, donc hors écran.
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

/**
 * Le petit bouton qui ouvre un transcript — la même pastille partout dans le dashboard.
 *
 * ⚠️ Désactivé, mais TOUJOURS VISIBLE quand le transcript manque : le faire disparaître
 * laisserait croire qu'il n'y a pas eu d'appel. Ici il dit « pas encore traité », ce qui
 * est la vérité — l'analyse post-appel arrive quelques minutes après.
 */
export function BoutonTranscript({ relance, onOuvrir, taille = 26 }: {
  relance: Relance;
  onOuvrir: (r: Relance) => void;
  taille?: number;
}) {
  const dispo = Boolean(relance.transcript);
  return (
    <button
      onClick={() => dispo && onOuvrir(relance)}
      disabled={!dispo}
      title={dispo ? 'Lire le transcript de l’appel' : 'Transcript pas encore traité — l’analyse arrive quelques minutes après l’appel'}
      style={{
        width: taille, height: taille, borderRadius: 7, flexShrink: 0,
        border: '1px solid ' + (dispo ? '#c7d2fe' : '#e5e7eb'),
        background: dispo ? '#eef2ff' : '#f9fafb',
        cursor: dispo ? 'pointer' : 'default',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        opacity: dispo ? 1 : 0.45, padding: 0,
      }}>
      <MessageSquare size={Math.round(taille * 0.46)} style={{ color: dispo ? '#6366f1' : '#9ca3af' }} />
    </button>
  );
}
