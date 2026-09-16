import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Chip, type Ton } from './Chip';

/**
 * Liste groupée et repliable.
 *
 * ⚠️ POURQUOI CE COMPOSANT EXISTE. Les extractions quotidiennes empilent une centaine de
 * lignes par jour : la Facturation en portait 769 sur un seul palier, le Recouvrement 947 au
 * total. Une liste plate devient illisible en une semaine, et surtout elle ne suit pas la
 * façon dont le travail se fait — on traite une échéance à la fois.
 *
 * L'en-tête replié doit se suffire à lui-même : il porte le compte et l'état du groupe, donc
 * un groupe sain reste silencieux et un problème saute aux yeux sans qu'on l'ouvre.
 */
export type GroupeEntete = {
  /** Clé stable — sert d'identifiant de dépliage. Typiquement la date ISO. */
  cle: string;
  titre: string;
  /** Ligne de contexte à droite du titre (« 35 patientes »). */
  compte?: string;
  /** Résumé de l'état du groupe. N'y mettre que ce qui est NON VIDE. */
  puces?: { texte: string; ton: Ton }[];
  /** Étiquette mise en avant (« échéance visée aujourd'hui »). */
  marque?: string;
  /** Groupe sur lequel on travaille : bordure et fond accentués. */
  accent?: boolean;
  /**
   * Actions portées par l'en-tête, à droite. Rendues À CÔTÉ du bouton de dépliage, jamais
   * dedans : imbriquer un bouton dans un bouton est invalide, et le moindre clic replierait
   * le groupe.
   *
   * ⚠️ Elles restent visibles GROUPE REPLIÉ — c'est précisément l'intérêt : agir sur une
   * échéance sans avoir à déplier cent lignes pour atteindre un bouton.
   */
  actions?: ReactNode;
  /** Teintes de l'accent, laissées à l'appelant (chaque palier a la sienne). */
  accentBord?: string;
  accentFond?: string;
  accentTexte?: string;
};

export function GroupedList({
  groupes, estOuvert, onToggle, rendu, vide,
}: {
  groupes: GroupeEntete[];
  estOuvert: (cle: string) => boolean;
  onToggle: (cle: string) => void;
  /** Contenu du groupe, calculé seulement quand il est déplié. */
  rendu: (cle: string) => ReactNode;
  vide?: ReactNode;
}) {
  if (groupes.length === 0) {
    return (
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
        padding: '30px var(--sp-4)', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-md)',
      }}>
        {vide ?? 'Aucune ligne.'}
      </div>
    );
  }

  return (
    <>
      {groupes.map(g => {
        const ouvert = estOuvert(g.cle);
        const bord = g.accent ? (g.accentBord ?? 'var(--blue-mid)') : 'var(--border)';
        return (
          <div key={g.cle} style={{
            background: 'var(--card)', border: `1px solid ${bord}`,
            borderRadius: 'var(--r-lg)', marginBottom: 'var(--sp-3)', overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center',
              background: g.accent ? (g.accentFond ?? 'var(--blue-faint)') : '#f8fafc',
              borderBottom: ouvert ? '1px solid var(--border)' : 'none',
            }}>
            <button
              onClick={() => onToggle(g.cle)}
              aria-expanded={ouvert}
              style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
                padding: '11px var(--sp-4)', border: 'none', cursor: 'pointer', textAlign: 'left',
                flexWrap: 'wrap', fontFamily: 'inherit', background: 'transparent',
              }}>
              {ouvert
                ? <ChevronDown size={15} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                : <ChevronRight size={15} style={{ color: 'var(--muted)', flexShrink: 0 }} />}

              <span style={{
                fontFamily: 'Lexend,sans-serif', fontSize: 'var(--fs-md)',
                fontWeight: 800, color: 'var(--text)',
              }}>{g.titre}</span>

              {g.marque && (
                <Chip texte={g.marque} ton="encours" />
              )}

              {g.compte && (
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>{g.compte}</span>
              )}

              {(g.puces?.length ?? 0) > 0 && (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                  {g.puces!.map(p => <Chip key={p.texte} texte={p.texte} ton={p.ton} />)}
                </span>
              )}
            </button>

            {g.actions && (
              <span style={{
                display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
                padding: '0 var(--sp-4)', flexShrink: 0,
              }}>{g.actions}</span>
            )}
            </div>

            {ouvert && rendu(g.cle)}
          </div>
        );
      })}
    </>
  );
}
