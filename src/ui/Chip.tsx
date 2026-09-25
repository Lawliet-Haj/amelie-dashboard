import type { ReactNode } from 'react';
/**
 * Puce d'état — la brique visuelle la plus répandue du dashboard.
 *
 * ⚠️ Elle existait en TROIS versions (App, Recouvrement, Facturation), avec des verts et
 * des ambres légèrement différents pour les mêmes états. Mesuré le 2026-09-03 : 102 couleurs
 * hex en dur dans les vues. D'où le `ton` sémantique ci-dessous : on nomme l'ÉTAT, jamais la
 * couleur, et les valeurs vivent dans `index.css`.
 *
 * Choisir un ton, pas une teinte :
 *   attente  — quelque chose est dû et n'est pas encore parti
 *   encours  — parti, sans confirmation
 *   ok       — abouti (livré, joint)
 *   ok2      — abouti, variante plus sourde pour un second niveau
 *   fort     — signal le plus probant (un clic vaut mieux qu'une ouverture)
 *   echec    — n'a pas abouti
 *   neutre   — hors périmètre, sans objet
 */
export type Ton = 'attente' | 'encours' | 'ok' | 'ok2' | 'fort' | 'echec' | 'neutre';

/**
 * `icone` : une icône devant le texte — typiquement le CANAL (téléphone, bulle, enveloppe)
 * quand la puce dit l'état d'un canal. L'icône est décorative pour les lecteurs d'écran.
 *
 * `lecteur` : ce que lit un lecteur d'écran À LA PLACE du texte visible. ⚠️ Indispensable
 * dès qu'une icône porte du sens : « Livré » seul ne dit pas si c'est le SMS ou le mail.
 */
export function Chip({ texte, ton = 'neutre', titre, icone, lecteur }: {
  texte: string; ton?: Ton; titre?: string; icone?: ReactNode; lecteur?: string;
}) {
  return (
    <span
      title={titre}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)',
        padding: '2px var(--sp-2)', borderRadius: 'var(--r-pill)',
        fontSize: 'var(--fs-xs)', fontWeight: 700, whiteSpace: 'nowrap',
        color: `var(--st-${ton}-fg)`,
        background: `var(--st-${ton}-bg)`,
        border: `1px solid var(--st-${ton}-bd)`,
      }}
    >
      {icone && <span aria-hidden="true" style={{ display: 'inline-flex' }}>{icone}</span>}
      {lecteur
        ? <><span aria-hidden="true">{texte}</span><span className="sr-only">{lecteur}</span></>
        : texte}
    </span>
  );
}
