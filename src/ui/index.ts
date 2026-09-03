/**
 * Primitives partagées du dashboard.
 *
 * ⚠️ RÈGLE : aucun composant de ce dossier n'écrit une couleur hex. Tout passe par les
 * jetons de `index.css`. C'est ce qui empêche de revenir aux 102 couleurs en dur mesurées
 * dans les vues le 2026-09-03.
 *
 * ⚠️ Quand une vue a besoin d'une variante, l'ajouter ICI plutôt que de recopier le
 * composant : les trois versions divergentes de `Chip` sont exactement ce qu'on répare.
 */
export { Chip, type Ton } from './Chip';
export { StatsBar, type VuePuce, type RangeeStats } from './StatsBar';
export { GroupedList, type GroupeEntete } from './GroupedList';
export { DataTable, thStyle, tdStyle, tdDiscret } from './DataTable';
export { SearchInput } from './SearchInput';
export { Portal } from '../lib/Portal';
