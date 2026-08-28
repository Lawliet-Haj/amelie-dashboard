import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Rend les overlays (modals, panneaux latéraux) directement dans <body>.
 *
 * ⚠️ NE PAS retirer. Un élément `position: fixed` n'est PAS positionné par rapport à la
 * fenêtre dès qu'un ancêtre porte un `transform`, un `filter` ou un `will-change` : cet
 * ancêtre devient son bloc conteneur. Les vues sont enveloppées dans `.animate-fade-up`
 * (animation `fadeUp`, qui manipule `transform`), et le conteneur de scroll est `<main>` :
 * les modals et panneaux se retrouvaient donc positionnés par rapport au haut de la liste
 * et non de l'écran — invisibles sans scroller dès que la liste était longue.
 * Le portail supprime le problème à la racine, quel que soit le style des ancêtres.
 *
 * Corriger le keyframe `fadeUp` (fin sur `transform: none`) ne suffisait PAS : pendant
 * toute la durée de l'animation, l'ancêtre reste un bloc conteneur.
 */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
