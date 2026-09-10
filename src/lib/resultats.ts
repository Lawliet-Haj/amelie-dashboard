/**
 * COMBIEN DE PATIENTES RELANCÉES ONT RENVOYÉ LEUR ORDONNANCE, sur une période donnée.
 *
 * La question est volontairement simple, et la réponse aussi : on prend les dossiers
 * relancés entre deux dates — par appel, par SMS ou par mail — et on regarde combien ont
 * renvoyé depuis.
 *
 * ⚠️ La SEULE preuve d'un retour est `resolu_le` : ORTHOP ne réclame plus la prescription.
 * Ni un SMS livré ni un mail cliqué ne prouvent quoi que ce soit — un clic dit qu'on a
 * ouvert le lien, pas qu'on a déposé le document.
 *
 * ⚠️ Deux limites à connaître, faute de quoi le chiffre ment :
 *
 * 1. **Les dossiers sans numéro de prescription ORTHOP ne peuvent JAMAIS être marqués
 *    résolus** (cohorte importée par Excel). Les laisser au dénominateur écrase le taux
 *    sans raison : ils sont écartés et comptés à part.
 *
 * 2. **Le rattrapage ne ré-interroge ORTHOP que sur 14 jours.** Au-delà, un retour n'est
 *    plus vu. Une période ancienne est donc sous-estimée — pas fausse, incomplète.
 *
 * ⚠️ Et ce que ce chiffre ne dit PAS : combien ont renvoyé *grâce* à la relance. Près de
 * la moitié du stock se résout seul en deux semaines. C'est un taux de retour, pas une
 * mesure d'efficacité.
 */
import { aujourdhuiIso, decalerJours, jourLocal } from './format';
import type { Relance } from '../types';

/** Au-delà de cet âge, `resolu_le` n'est plus mis à jour : le rattrapage couvre 14 jours. */
export const FENETRE_OBSERVATION = 14;

export type Canal = 'appel' | 'sms' | 'mail';

export interface LigneBilan {
  libelle: string;
  relances: number;
  resolus: number;
  taux: number | null;
}

export interface Bilan {
  /** Dossiers suivis par ORTHOP, relancés dans la période. */
  relances: number;
  resolus: number;
  taux: number | null;
  /** Relancés dans la période mais sans numéro de prescription : jamais marquables résolus. */
  horsSuivi: number;
  /** ⚠️ Lignes qui SE RECOUVRENT : une patiente peut avoir été appelée ET recevoir un SMS. */
  parCanal: LigneBilan[];
  /** Une ligne par jour de relance, du plus récent au plus ancien. */
  parJour: LigneBilan[];
}

/**
 * Les dates de relance d'un dossier, en jour parisien.
 *
 * ⚠️ `dernier_appel` ne retient que le DERNIER appel : une patiente appelée deux fois
 * n'apparaît qu'à la seconde date. Sans conséquence en pratique — la règle d'arrêt sur
 * contact écrit ramène la campagne à un appel par patiente — mais à savoir si cette règle
 * change un jour.
 */
function datesRelance(r: Relance) {
  return {
    appel: r.dernier_appel ? jourLocal(r.dernier_appel) : null,
    sms: r.sms_le ? jourLocal(r.sms_le) : null,
    mail: r.email_le ? jourLocal(r.email_le) : null,
  };
}

function dansPeriode(jour: string | null, debut: string, fin: string): boolean {
  return jour !== null && jour >= debut && jour <= fin;
}

export function calculerBilan(lignes: Relance[], debut: string, fin: string): Bilan {
  const retenus: { r: Relance; d: ReturnType<typeof datesRelance>; jour: string }[] = [];
  let horsSuivi = 0;

  for (const r of lignes) {
    const d = datesRelance(r);
    const jours = [d.appel, d.sms, d.mail].filter(j => dansPeriode(j, debut, fin)) as string[];
    if (!jours.length) continue;                       // pas relancée dans la période
    if (!r.orthop_prescription) { horsSuivi++; continue; }
    // Le jour retenu est celui du PREMIER contact de la période : c'est la date à laquelle
    // on l'a relancée, pas celle du dernier canal servi.
    retenus.push({ r, d, jour: jours.sort()[0] });
  }

  const estResolu = (r: Relance) => Boolean(r.resolu_le);
  const resolus = retenus.filter(x => estResolu(x.r)).length;

  const ligne = (libelle: string, sous: typeof retenus): LigneBilan => {
    const n = sous.length, res = sous.filter(x => estResolu(x.r)).length;
    return { libelle, relances: n, resolus: res, taux: n > 0 ? res / n : null };
  };

  const parCanal: LigneBilan[] = [
    ligne('Appel', retenus.filter(x => dansPeriode(x.d.appel, debut, fin))),
    ligne('SMS', retenus.filter(x => dansPeriode(x.d.sms, debut, fin))),
    ligne('Mail', retenus.filter(x => dansPeriode(x.d.mail, debut, fin))),
  ];

  const parJourMap = new Map<string, typeof retenus>();
  for (const x of retenus) {
    const l = parJourMap.get(x.jour); if (l) l.push(x); else parJourMap.set(x.jour, [x]);
  }
  const parJour = [...parJourMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([jour, sous]) => ligne(jour, sous));

  return {
    relances: retenus.length,
    resolus,
    taux: retenus.length > 0 ? resolus / retenus.length : null,
    horsSuivi,
    parCanal,
    parJour,
  };
}

/** Les raccourcis de période proposés à l'écran. */
export function periodeParDefaut(auj: string = aujourdhuiIso()) {
  return { debut: decalerJours(auj, -30), fin: auj };
}

export function pourcent(t: number | null, decimales = 0): string {
  return t === null ? '—' : (t * 100).toFixed(decimales) + ' %';
}
