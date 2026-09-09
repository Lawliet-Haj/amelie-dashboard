import type { CSSProperties, ReactNode } from 'react';

/**
 * Tableau de données — l'enveloppe et les styles de cellule, rien de plus.
 *
 * ⚠️ Le même tableau était réécrit dans chaque vue, avec des `thStyle`/`tdStyle` locaux
 * légèrement différents. Les lignes sont laissées à l'appelant (chaque vue a ses colonnes),
 * mais l'en-tête, les bordures, le défilement horizontal et la typographie sont ici.
 *
 * Le conteneur défile horizontalement de lui-même : sans ça, une colonne large fait
 * déborder la page entière.
 */
export const thStyle: CSSProperties = {
  padding: '9px var(--sp-3)',
  textAlign: 'left',
  fontSize: 'var(--fs-xs)',
  fontWeight: 700,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '.3px',
  background: '#f8fafc',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
};

export const tdStyle: CSSProperties = {
  padding: '9px var(--sp-3)',
  fontSize: 'var(--fs-md)',
  color: 'var(--text-2)',
  borderBottom: '1px solid var(--blue-faint)',
  verticalAlign: 'middle',
};

/** Cellule discrète : identifiants, horodatages — tout ce qui ne doit pas attirer l'œil. */
export const tdDiscret: CSSProperties = {
  ...tdStyle,
  color: 'var(--muted)',
  fontSize: 'var(--fs-sm)',
  whiteSpace: 'nowrap',
};

export function DataTable({
  colonnes, children, vide, encadre = true, hauteurMax,
}: {
  colonnes: string[];
  children: ReactNode;
  /** Affiché à la place du corps quand il n'y a rien. */
  vide?: ReactNode;
  /** `false` quand le tableau est déjà dans un cadre (à l'intérieur d'un groupe). */
  encadre?: boolean;
  /**
   * Borne la hauteur du tableau, qui défile alors sur lui-même (ex. `'38vh'`).
   *
   * À utiliser quand le tableau vit dans un conteneur déjà borné — un modal, typiquement :
   * sans ça, 94 lignes repoussent tout ce qui suit hors d'atteinte, et il faut traverser la
   * liste entière pour retrouver les actions du bas.
   *
   * ⚠️ L'en-tête devient collant UNIQUEMENT dans ce mode. Le rendre collant partout
   * changerait le comportement des tableaux déjà en place, qui défilent avec la page.
   */
  hauteurMax?: string;
}) {
  const th = hauteurMax
    ? { ...thStyle, position: 'sticky' as const, top: 0, zIndex: 1 }
    : thStyle;
  const table = (
    <div style={hauteurMax
      ? { overflow: 'auto', maxHeight: hauteurMax }
      : { overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{colonnes.map(c => <th key={c} style={th}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {vide
            ? <tr><td colSpan={colonnes.length} style={{
                ...tdStyle, textAlign: 'center', color: 'var(--muted)', padding: '30px var(--sp-3)',
              }}>{vide}</td></tr>
            : children}
        </tbody>
      </table>
    </div>
  );

  if (!encadre) return table;
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)', overflow: 'hidden',
    }}>{table}</div>
  );
}
