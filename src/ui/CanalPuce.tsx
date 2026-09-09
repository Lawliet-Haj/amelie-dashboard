/**
 * Puce de CANAL — volontairement distincte de `Chip`.
 *
 * ⚠️ Un canal n'est pas un état d'acheminement. « SMS » ne dit pas si le SMS est parti,
 * livré ou en échec : c'est `Chip` qui le dit. Faire porter les deux sens aux mêmes
 * couleurs ferait perdre au vert sa signification « abouti » — c'est la raison pour
 * laquelle `PalierChip` reste lui aussi séparé de `Chip` dans la Facturation.
 *
 * Trois familles, pas quatre : SMS et mail partagent la même teinte parce qu'ils
 * partagent la même nature — un message parti sans interlocuteur.
 */
import type { CanalRail } from '../lib/rails';

const FAMILLE: Record<CanalRail, { cle: 'voix' | 'ecrit' | 'papier'; libelle: string }> = {
  appel:    { cle: 'voix',   libelle: 'Appel' },
  sms:      { cle: 'ecrit',  libelle: 'SMS' },
  mail:     { cle: 'ecrit',  libelle: 'Mail' },
  courrier: { cle: 'papier', libelle: 'Courrier' },
};

export function CanalPuce({
  canal, texte, barre = false, titre,
}: { canal: CanalRail; texte?: string; barre?: boolean; titre?: string }) {
  const f = FAMILLE[canal];
  return (
    <span
      title={titre}
      style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '1px var(--sp-2)', borderRadius: 'var(--r-pill)',
        fontSize: 'var(--fs-xs)', fontWeight: 700, whiteSpace: 'nowrap',
        color: `var(--cn-${f.cle}-fg)`,
        background: `var(--cn-${f.cle}-bg)`,
        border: `1px solid var(--cn-${f.cle}-bd)`,
        // Un canal retiré du parcours reste visible mais barré : le supprimer de la liste
        // ferait croire qu'il n'a jamais existé, alors que c'est une décision à connaître.
        textDecoration: barre ? 'line-through' : undefined,
        opacity: barre ? 0.65 : 1,
      }}
    >
      {texte ?? f.libelle}
    </span>
  );
}
