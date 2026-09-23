/**
 * Les deux paliers de relance préventive de la facturation, et leurs dates.
 *
 * ⚠️ Sortis de `FacturationView` le 2026-09-23, à l'arrivée de l'envoi manuel : la fenêtre
 * d'ajout en a besoin aussi, et une seconde copie des écarts finirait par diverger — la
 * panne que ce projet paie le plus cher.
 */
import type { Palier } from '../types';
import { decalerJours } from './format';

/**
 * ⚠️ J-30 et J-15 sont STRICTEMENT séparés : le message envoyé ne sera pas le même
 * (premier avertissement vs rappel rapproché). Ils ont leur propre extraction, leur propre
 * onglet, leurs propres compteurs, et en base leur propre ligne — la clé de déduplication
 * `(orthop_prescription, palier)` garantit qu'une patiente peut passer par les deux sans
 * que l'un n'empêche l'autre.
 *
 * `jours` = nombre de jours entre l'envoi du SMS et la **fin de location**. Les libellés
 * J-30 / J-15 correspondent donc exactement à cet écart (arrêté avec le client le
 * 2026-08-28 : le 28/08 vise une fin de location au 27/09).
 *
 * ⚠️ Ne pas confondre avec l'« applicable du » interrogé dans ORTHOP, qui vaut toujours
 * `fin de location + 1 jour` — voir `datesPalier` ci-dessous.
 *
 * ⚠️ Décalage FIXE, pas d'arithmétique de mois : avec un décalage fixe et un lancement
 * quotidien, chaque date de fin de location est visée une fois et une seule.
 * L'arithmétique de mois créerait doublons et trous (les 29, 30 et 31 janvier tomberaient
 * tous sur le 28 février).
 *
 * Le même écart est codé côté n8n dans `Auth + Params` (`JOURS_PALIER`) : les deux
 * doivent rester d'accord, et le modal signale un désaccord s'il en survient un.
 */
export const PALIERS: { id: Palier; label: string; jours: number; teinte: string; bord: string; fond: string; texte: string }[] = [
  { id: 'J30', label: 'J-30', jours: 30, teinte: '#c2410c', bord: '#fed7aa', fond: '#fff7ed', texte: 'Premier avertissement, 30 jours avant la fin de location.' },
  { id: 'J15', label: 'J-15', jours: 15, teinte: '#1d4ed8', bord: '#bfdbfe', fond: '#eff6ff', texte: 'Rappel rapproché, 15 jours avant la fin de location.' },
];
export const palierConf = (p: Palier) => PALIERS.find(x => x.id === p) ?? PALIERS[0];

/**
 * Deux dates à ne JAMAIS confondre :
 *
 *  - **fin de location** = `reference + N jours` — la date annoncée dans le SMS,
 *    celle que lit la patiente (« votre ordonnance prendra fin le … »).
 *  - **applicable du**   = `fin de location + 1 jour` — la date interrogée dans ORTHOP,
 *    et celle stockée dans `facturation.date_echeance`.
 *
 * Le décalage vient du champ « Fin loc. » de l'écran ORTHOP, qui donne J+1 : filtrer
 * Fin loc au 25/08 renvoie les prescriptions applicables du 26/08.
 *
 * ⚠️ Le même calcul est fait côté n8n (`Auth + Params`). Les deux doivent concorder —
 * le modal le vérifie et signale un désaccord plutôt que de le supposer.
 */
export function datesPalier(reference: string, jours: number) {
  return { fin: decalerJours(reference, jours), applicable: decalerJours(reference, jours + 1) };
}

/** Fin de location déduite d'une ligne en base, où `date_echeance` est l'« applicable du ». */
export function finDeLocation(dateEcheance: string | null | undefined): string {
  return dateEcheance ? decalerJours(dateEcheance, -1) : '';
}
