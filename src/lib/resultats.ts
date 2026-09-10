/**
 * LE RÉSULTAT DE LA CAMPAGNE — combien de patientes relancées ont renvoyé leur ordonnance.
 *
 * La seule preuve d'un retour est **`resolu_le`** : ORTHOP ne réclame plus la prescription.
 * Ni un SMS livré, ni un mail cliqué ne prouvent quoi que ce soit — un clic dit qu'on a
 * ouvert le lien, pas qu'on a déposé le document.
 *
 * ⚠️⚠️ TROIS BIAIS RENDENT UN TAUX BRUT FAUX. Ils sont corrigés ici, et affichés à l'écran :
 *
 * 1. **Les dossiers sans numéro de prescription ne peuvent JAMAIS être résolus.** La cohorte
 *    Excel du 25/08 (153 lignes) n'a pas d'`orthop_prescription` : aucun signal ne viendra
 *    jamais les fermer. Les compter au dénominateur écrase le taux sans raison. Ils sont
 *    donc EXCLUS et comptés à part.
 *
 * 2. **La maturité.** Une cohorte échue hier n'a pas eu le temps de renouveler. Comparer
 *    une cohorte d'un jour à une cohorte de deux semaines n'a aucun sens : la courbe est
 *    donc construite avec un **ensemble à risque** — au jour N, le dénominateur ne retient
 *    que les dossiers ayant DÉJÀ atteint l'âge N.
 *
 * 3. **La fenêtre d'observation de 14 jours.** Le rattrapage glissant ne ré-interroge ORTHOP
 *    que sur les 14 derniers jours. **Au-delà, une résolution n'est plus vue** — le parcours,
 *    lui, va jusqu'à J+40. Un taux qui plafonne après deux semaines est donc un artefact de
 *    NOTRE instrumentation, pas un comportement des patientes. La courbe s'arrête à 14 jours
 *    pour cette raison, et les cohortes plus âgées sont marquées.
 *
 * ⚠️ Enfin, et c'est le plus important à ne pas oublier en lisant cet écran : **rien ici ne
 * mesure l'EFFET de la relance.** Près de la moitié du stock se résout seul en deux semaines
 * (courbe mesurée le 2026-09-04 : 6 % à J+1, 14 % à J+3, 34 % à J+8, 47 % à J+13). L'écart
 * entre « jointes » et « non jointes » est un écart OBSERVÉ entre deux groupes qui n'ont pas
 * été tirés au sort — les injoignables diffèrent par nature (numéro erroné, dossier ancien).
 * C'est la meilleure comparaison disponible, ce n'est pas une mesure d'effet.
 */
import { ecartJours, jourLocal, aujourdhuiIso } from './format';
import type { Relance } from '../types';

/**
 * Au-delà de cet âge, `resolu_le` n'est plus mis à jour : le rattrapage glissant du cron
 * J+1 ne ré-interroge ORTHOP que sur 14 jours.
 * ⚠️ À faire évoluer EN MÊME TEMPS que ce rattrapage, sinon l'écran ment sur ce qu'il voit.
 */
export const FENETRE_OBSERVATION = 14;

/**
 * ⚠️⚠️ `resolu_le` EST LA DATE À LAQUELLE ON A REGARDÉ, PAS CELLE DU RETOUR.
 *
 * Mesuré le 2026-09-10 : les 625 résolutions connues sont détectées sur **six jours
 * seulement**, du 04/09 au 09/09 — rien avant. C'est exactement la mise en service du
 * rattrapage glissant. Son premier passage a balayé 117 dossiers d'échéances allant du
 * 27/08 au 04/09 : un arriéré, pas des retours du jour.
 *
 * Le symptôme qui l'avait trahi : la cohorte du 25/08 compte 57 résolus dont **zéro dans
 * les dix jours**, quand sa voisine du 26/08 en compte 34 sur 51. Une telle marche n'est
 * pas un comportement de patientes, c'est la date où l'on a commencé à regarder.
 *
 * Conséquence : un DÉLAI n'a de sens que si la détection était déjà quotidienne quand la
 * cohorte est arrivée à échéance. Le TAUX, lui, reste juste — « a-t-elle renvoyé » ne
 * dépend pas de la date de détection.
 *
 * ⚠️ À avancer si le rattrapage est un jour interrompu puis repris : la date ici est celle
 * du début de la détection CONTINUE, pas celle du premier marquage.
 */
export const DEBUT_DETECTION_FIABLE = '2026-09-04';

export interface DossierJuge {
  r: Relance;
  /** Jours écoulés depuis l'échéance. Négatif = pas encore échue → hors périmètre. */
  age: number;
  /** Résolu, constaté dans ORTHOP. */
  resolu: boolean;
  /** Jours entre l'échéance et la résolution constatée. `null` si non résolu. */
  delai: number | null;
  /**
   * Le délai de ce dossier est-il interprétable ? Vrai seulement si son échéance tombe
   * après le début de la détection continue — sinon `delai` mesure notre latence.
   */
  delaiFiable: boolean;
  /** Elle a parlé, ou un message vocal a réellement été déposé. */
  parVoix: boolean;
  /** Un SMS a été livré, ou un mail a abouti (livré / ouvert / cliqué). */
  parEcrit: boolean;
  joint: boolean;
}

export interface Groupe { n: number; resolus: number; taux: number | null }

export interface PointCourbe { age: number; base: number; resolus: number; taux: number }

export interface Cohorte {
  echeance: string;
  age: number;
  observables: number;
  resolus: number;
  taux: number | null;
  /** Plus vieille que la fenêtre : son taux est FIGÉ, pas terminé. */
  horsFenetre: boolean;
}

export interface Resultats {
  /** Dossiers échus, tous confondus. */
  total: number;
  /** Sans `orthop_prescription` : jamais résolvables, exclus des taux. */
  horsSuivi: number;
  observables: number;
  resolus: number;
  taux: number | null;
  delaiMedian: number | null;
  /** Dossiers dont le délai est interprétable — l'échantillon de la courbe et de la médiane. */
  baseDelai: number;
  joints: Groupe;
  nonJoints: Groupe;
  /** ⚠️ Groupes qui SE RECOUVRENT : un dossier peut être joint par plusieurs canaux. */
  parCanal: { canal: string; n: number; resolus: number; taux: number | null }[];
  courbe: PointCourbe[];
  cohortes: Cohorte[];
  /** Part des observables déjà sortis de la fenêtre d'observation. */
  horsFenetre: number;
}

function tauxDe(n: number, resolus: number): number | null {
  return n > 0 ? resolus / n : null;
}

/**
 * Juge un dossier : âge, résolution, canaux aboutis.
 *
 * ⚠️ « Joint » est ici mesuré **sur toute la vie du dossier**, pas au rail. La règle
 * rail-scopée de `rails.ts` répond à « faut-il l'appeler aujourd'hui » ; ici la question est
 * « lui a-t-on parlé, un jour ? ». Les deux sont justes, dans leur contexte respectif — ne
 * pas remplacer l'une par l'autre.
 */
export function jugerDossier(r: Relance, auj: string = aujourdhuiIso()): DossierJuge | null {
  if (!r.date_echeance) return null;
  const age = ecartJours(r.date_echeance, auj);
  if (!Number.isFinite(age) || age < 0) return null;   // pas encore échue

  const resolu = Boolean(r.resolu_le);
  let delai: number | null = null;
  if (resolu && r.resolu_le) {
    const d = ecartJours(r.date_echeance, jourLocal(r.resolu_le));
    // ⚠️ Un délai négatif existe : ORTHOP peut cesser de réclamer la prescription AVANT la
    // date d'échéance. On le ramène à 0 plutôt que de le jeter — le retour a bien eu lieu.
    delai = Number.isFinite(d) ? Math.max(0, d) : null;
  }

  const parVoix = r.statut === 'Répondu SMS' || r.statut === 'Répondu transfert'
    || r.vocal_statut === 'depose_el' || r.vocal_statut === 'depose_agent';
  const parEcrit = r.sms_statut === 'livre'
    || r.email_statut === 'livre' || r.email_statut === 'ouvert' || r.email_statut === 'clique';

  const delaiFiable = String(r.date_echeance) >= DEBUT_DETECTION_FIABLE;

  return { r, age, resolu, delai, delaiFiable, parVoix, parEcrit, joint: parVoix || parEcrit };
}

export function calculerResultats(lignes: Relance[], auj: string = aujourdhuiIso()): Resultats {
  const juges = lignes.map(r => jugerDossier(r, auj)).filter((x): x is DossierJuge => x !== null);

  // ⚠️ LE DÉNOMINATEUR : uniquement les dossiers qu'ORTHOP peut fermer.
  const obs = juges.filter(j => Boolean(j.r.orthop_prescription));
  const horsSuivi = juges.length - obs.length;

  const resolus = obs.filter(j => j.resolu);

  // ⚠️ Uniquement les délais INTERPRÉTABLES : inclure les cohortes antérieures au
  // rattrapage donnerait une médiane qui mesure notre latence de détection.
  const delais = resolus.filter(j => j.delaiFiable)
    .map(j => j.delai).filter((d): d is number => d !== null).sort((a, b) => a - b);
  const delaiMedian = delais.length
    ? (delais.length % 2 ? delais[(delais.length - 1) / 2]
                         : (delais[delais.length / 2 - 1] + delais[delais.length / 2]) / 2)
    : null;

  const grouper = (sous: DossierJuge[]): Groupe => {
    const n = sous.length, r = sous.filter(j => j.resolu).length;
    return { n, resolus: r, taux: tauxDe(n, r) };
  };

  const joints = grouper(obs.filter(j => j.joint));
  const nonJoints = grouper(obs.filter(j => !j.joint));

  const canal = (libelle: string, filtre: (j: DossierJuge) => boolean) => {
    const g = grouper(obs.filter(filtre));
    return { canal: libelle, ...g };
  };
  const parCanal = [
    canal('Elle a parlé', j => j.r.statut === 'Répondu SMS' || j.r.statut === 'Répondu transfert'),
    canal('Message vocal déposé', j => j.r.vocal_statut === 'depose_el' || j.r.vocal_statut === 'depose_agent'),
    canal('SMS livré', j => j.r.sms_statut === 'livre'),
    canal('Mail ouvert ou cliqué', j => j.r.email_statut === 'ouvert' || j.r.email_statut === 'clique'),
    canal('Aucun contact abouti', j => !j.joint),
  ];

  // ── LA COURBE, avec un ENSEMBLE À RISQUE ────────────────────────────────────
  // Au jour N, seuls les dossiers ayant atteint l'âge N entrent au dénominateur. Sans ça,
  // les cohortes fraîches (qui n'ont pas encore eu le temps de renouveler) écraseraient
  // mécaniquement le taux des jours élevés.
  // ⚠️ Et surtout : uniquement les dossiers dont le délai est interprétable, sinon la
  // courbe dessine la date de nos passages de rattrapage, pas le retour des patientes.
  // Elle s'arrête donc à l'âge le plus élevé qu'un tel dossier puisse avoir aujourd'hui —
  // elle s'allongera d'un jour par jour.
  const fiables = obs.filter(j => j.delaiFiable);
  const ageObservable = Math.max(0, Math.min(FENETRE_OBSERVATION,
    ecartJours(DEBUT_DETECTION_FIABLE, auj)));
  const courbe: PointCourbe[] = [];
  for (let n = 0; n <= ageObservable; n++) {
    const base = fiables.filter(j => j.age >= n);
    const r = base.filter(j => j.delai !== null && j.delai <= n).length;
    courbe.push({ age: n, base: base.length, resolus: r, taux: base.length ? r / base.length : 0 });
  }

  // ── Les cohortes, par date d'échéance ───────────────────────────────────────
  const parEcheance = new Map<string, DossierJuge[]>();
  for (const j of obs) {
    const k = String(j.r.date_echeance);
    const l = parEcheance.get(k); if (l) l.push(j); else parEcheance.set(k, [j]);
  }
  const cohortes: Cohorte[] = [...parEcheance.entries()]
    .map(([echeance, l]) => {
      const r = l.filter(x => x.resolu).length;
      return {
        echeance, age: l[0].age, observables: l.length, resolus: r,
        taux: tauxDe(l.length, r), horsFenetre: l[0].age > FENETRE_OBSERVATION,
      };
    })
    .sort((a, b) => (a.echeance < b.echeance ? 1 : -1));

  return {
    total: juges.length,
    horsSuivi,
    observables: obs.length,
    resolus: resolus.length,
    taux: tauxDe(obs.length, resolus.length),
    delaiMedian,
    baseDelai: fiables.length,
    joints, nonJoints, parCanal, courbe, cohortes,
    horsFenetre: obs.filter(j => j.age > FENETRE_OBSERVATION).length,
  };
}

export function pourcent(t: number | null, decimales = 0): string {
  return t === null ? '—' : (t * 100).toFixed(decimales) + ' %';
}
