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

export function Chip({ texte, ton = 'neutre', titre }: { texte: string; ton?: Ton; titre?: string }) {
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
      {texte}
    </span>
  );
}
