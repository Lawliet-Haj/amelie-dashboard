import type { ComponentType, CSSProperties } from 'react';

/**
 * Barre de statistiques dont chaque puce est AUSSI un filtre.
 *
 * Le principe, éprouvé sur le Recouvrement puis la Facturation : voir un compteur donne
 * immédiatement envie de voir les lignes qu'il désigne. Un chiffre qu'on ne peut pas ouvrir
 * oblige à aller le rechercher à la main dans la liste.
 *
 * ⚠️ Les compteurs doivent porter sur l'ENSEMBLE décrit (toutes les lignes de l'onglet), pas
 * sur la liste déjà filtrée : sinon ils changent à chaque frappe dans la recherche et ne
 * décrivent plus rien.
 */
export type VuePuce = {
  id: string;
  libelle: string;
  n: number;
  /** Passe la puce en rouge dès que `n > 0` — pour ce qui demande une action. */
  alerte?: boolean;
  /** Puce incluse dans la précédente (« dont cliqués ») : décalée et préfixée d'un chevron. */
  sousEnsemble?: boolean;
  titre?: string;
};

export type RangeeStats = {
  titre: string;
  icone: ComponentType<{ size?: number; style?: CSSProperties }>;
  puces: VuePuce[];
};

export function StatsBar({
  titre = 'Statistiques d’envoi', sousTitre, rangees, actif, onActif, libelleActif,
}: {
  titre?: string;
  sousTitre?: string;
  rangees: RangeeStats[];
  /** Id de la puce active, ou `null` quand aucun filtre n'est posé. */
  actif: string | null;
  onActif: (id: string | null) => void;
  /** Libellé de la puce active, pour le lien « Retirer le filtre ». */
  libelleActif?: string;
}) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)', padding: 'var(--sp-3) var(--sp-4)', marginBottom: 'var(--sp-3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', marginBottom: 2, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--muted)',
          textTransform: 'uppercase', letterSpacing: '.3px',
        }}>{titre}</span>
        {sousTitre && <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>{sousTitre}</span>}
        {actif && (
          <button onClick={() => onActif(null)} style={{
            marginLeft: 'auto', fontSize: 'var(--fs-xs)', color: 'var(--blue)', background: 'none',
            border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0,
          }}>
            Retirer le filtre{libelleActif ? ` « ${libelleActif} »` : ''}
          </button>
        )}
      </div>

      {rangees.map((r, i) => (
        <div key={r.titre}>
          {i > 0 && <div style={{ borderTop: '1px solid var(--blue-faint)' }} />}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap', padding: '7px 0' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)', width: 62, flexShrink: 0,
              fontSize: 'var(--fs-sm)', fontWeight: 800, color: 'var(--text)', fontFamily: 'Lexend,sans-serif',
            }}>
              <r.icone size={13} style={{ color: 'var(--muted)' }} /> {r.titre}
            </span>

            {r.puces.map(p => {
              const estActif = actif === p.id;
              const rouge = p.alerte && p.n > 0;
              const inerte = p.n === 0 && !estActif;
              return (
                <button
                  key={p.id}
                  onClick={() => onActif(estActif ? null : p.id)}
                  title={p.titre ?? (p.n === 0 ? 'Aucune ligne dans cet état' : `Afficher ces ${p.n} ligne(s)`)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)',
                    padding: '3px 9px', borderRadius: 'var(--r-pill)',
                    fontSize: 'var(--fs-xs)', fontWeight: estActif ? 800 : 600,
                    cursor: inerte ? 'default' : 'pointer',
                    opacity: inerte ? .45 : 1,
                    marginLeft: p.sousEnsemble ? -2 : 0,
                    color: estActif ? 'white' : rouge ? 'var(--st-echec-fg)' : 'var(--text)',
                    background: estActif
                      ? (rouge ? 'var(--st-echec-fg)' : 'var(--text)')
                      : rouge ? 'var(--st-echec-bg)' : 'var(--card)',
                    border: `1px solid ${estActif ? 'transparent' : rouge ? 'var(--st-echec-bd)' : 'var(--border)'}`,
                  }}>
                  {p.sousEnsemble && <span style={{ opacity: .5 }}>↳</span>}
                  {p.libelle} <strong style={{ fontFamily: 'Lexend,sans-serif' }}>{p.n}</strong>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
