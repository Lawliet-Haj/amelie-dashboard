/**
 * LE PARCOURS DE RELANCES — définition unique des neuf rails.
 *
 * Un « rail » est une étape du parcours : un message, un canal, un moment. Une patiente
 * entre au premier rail le jour où son ordonnance arrive à échéance, puis elle **vieillit**
 * à travers les rails suivants tant qu'elle n'a pas renvoyé son ordonnance.
 *
 * ⚠️ RIEN N'EST RÉ-EXTRAIT PAR RAIL. Une cohorte est extraite d'ORTHOP **une seule fois**,
 * le jour de son échéance ; son rail se DÉDUIT de l'écart entre cette échéance et
 * aujourd'hui. Aucune colonne à stocker, aucune migration : le rail est un calcul.
 *
 * ⚠️⚠️ DEUX TABLES, UNE SEULE ÉCHELLE. Les deux premiers rails (J-30, J-15) sont des
 * avertissements **préventifs** envoyés AVANT l'échéance : ils vivent dans la table
 * `facturation`, et leur rail est donné par la colonne `palier` — pas par un calcul de
 * dates. Les sept suivants sont des relances **après** échéance et vivent dans `relances`.
 * Ne pas fusionner les deux tables : `relances` porte un index unique sur
 * `orthop_prescription` seul, donc un palier J-30 y bloquerait le J-15 de la même patiente
 * ET l'extraction du jour J, en silence (`ON CONFLICT DO NOTHING`).
 *
 * ⚠️⚠️ TOUTE L'ÉCHELLE EST ANCRÉE SUR LA **FIN DE LOCATION**, pas sur `date_echeance`.
 * C'est déjà le cas de J-30 et J-15 côté facturation, et c'est ce qui rend le parcours
 * cohérent d'un bout à l'autre.
 *
 * `relances.date_echeance` est la date **« applicable du »**, soit **fin de location + 1**
 * (l'écran ORTHOP « Fin loc. » donne J+1 — vérifié sur les exports, 99/99 le 27/08).
 * Appeler le jour de `date_echeance`, c'est donc appeler **à J+1** après la fin de location.
 *
 * Un rail libellé J+N tire donc sur `date_echeance + (N − 1)` : voir `ecartEcheance()`.
 *   J+1  → écart 0  (la cohorte du jour)
 *   J+7  → écart 6
 *   J+14 → écart 13
 *
 * ⚠️ Corrigé le 2026-09-09 : le premier rail était libellé « J+0 » parce que l'écart était
 * compté depuis `date_echeance` au lieu de la fin de location. Le décalage n'est pas
 * cosmétique — mesuré le jour même, le rail J+1 compte **86** dossiers avec le bon écart
 * contre **10** sans.
 */
import { aujourdhuiIso, decalerJours, ecartJours, formatDate, isFixe, jourLocal } from './format';
import type { Relance } from '../types';

export type SourceRail = 'facturation' | 'relances';
export type CanalRail = 'appel' | 'sms' | 'mail' | 'courrier';

/**
 * Qui porte le rail, et dans quel état il se trouve.
 *   actif       — il tourne aujourd'hui
 *   facturation — il vit dans le menu Facturation (rôle cloisonné), montré ici pour situer
 *   manuel      — une conseillère reprend la main, aucun automate
 *   prevu       — dessiné, pas encore branché
 */
export type EtatRail = 'actif' | 'facturation' | 'manuel' | 'prevu';

export interface ActionRail {
  canal: CanalRail;
  libelle: string;
  detail: string;
  /**
   * `essai` — l'agent existe et se teste par un appel vers SON numéro (« Tester cette
   * étape »), mais AUCUN automate ne tourne : ni cron, ni déclenchement depuis la liste.
   * ⚠️ Ne compte PAS comme `actif` : `mailDansLeRail()` et les listes de travail ne
   * regardent que `actif`, et c'est voulu — une étape en essai n'appelle personne.
   */
  etat: 'actif' | 'essai' | 'a-creer' | 'manuel' | 'retire';
}

export interface Rail {
  /** Identifiant stable, utilisé comme clé d'URL et de groupe. Ne pas renuméroter. */
  code: 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9';
  /** Ce que l'utilisateur lit : « J-30 », « J+7 ». */
  libelle: string;
  /** Une phrase disant ce que ce rail fait, pour l'en-tête de la carte. */
  titre: string;
  source: SourceRail;
  /** `facturation` uniquement — le rail est porté par la colonne `palier`. */
  palier?: 'J30' | 'J15';
  /**
   * L'écart en jours depuis la **FIN DE LOCATION** — c'est le libellé du parcours :
   * J+1 → 1, J+7 → 7, J-30 → −30.
   *
   * ⚠️⚠️ CE N'EST PAS L'ÉCART SUR `date_echeance`. Cette dernière vaut fin de location + 1,
   * donc l'écart à comparer est `jour − 1` : utiliser `ecartEcheance()`, jamais `jour` nu,
   * dans un calcul de dates.
   *
   * ⚠️ UN JOUR PRÉCIS, PAS UNE FENÊTRE. Le parcours est une suite de rendez-vous, pas un
   * découpage du temps : un dossier à J+4 n'a rien de programmé, il attend son J+7. Le
   * premier modèle pavait le temps en fenêtres et affichait donc 517 dossiers sur la
   * première étape, là où la cohorte du jour en compte 86.
   *
   * ⚠️ Conséquence à ne jamais masquer : la plupart des dossiers actifs sont ENTRE deux
   * étapes. La somme des neuf étapes ne fait donc pas le total de la base, et c'est normal.
   * Un écran qui n'afficherait que les étapes aurait l'air d'avoir perdu le reste : voir
   * `comptesGlobaux`.
   */
  jour: number;
  canaux: CanalRail[];
  /** Le rail tourne-t-il aujourd'hui ? Un rail inactif s'affiche « prévu », pas « en panne ». */
  actif: boolean;
  /**
   * Premier jour où l'étape a réellement tourné (AAAA-MM-JJ). Absent = depuis toujours.
   *
   * ⚠️ Sert au CONTRÔLE d'une journée PASSÉE : regarder le 21/09 avec le J+14 « actif »
   * ferait apparaître soixante patientes « rien tenté » sur une étape qui n'existait pas
   * encore. `actif` dit ce qui tourne AUJOURD'HUI ; cette date dit depuis quand.
   */
  enServiceDepuis?: string;
  etat: EtatRail;
  /** Une ou deux phrases : ce que cette étape fait, et pourquoi. */
  resume: string;
  /** Qui la porte : un agent IA nommé, une conseillère, un prestataire. */
  porteur: string;
  actions: ActionRail[];
}

/**
 * Les neuf étapes, dans l'ordre du parcours.
 *
 * ⚠️ Ce commentaire décrivait auparavant des « fenêtres qui se pavent sans trou ni
 * recouvrement ». C'était le PREMIER modèle, et il est faux : une étape est un JOUR
 * PRÉCIS, donc la plupart des dossiers ne sont sur aucune étape un jour donné — 761 sur
 * 940 au 2026-09-04. Ce n'est pas un trou à boucher, c'est l'attente entre deux
 * rendez-vous, et `comptesGlobaux` la compte explicitement.
 *
 * En revanche les écarts doivent rester STRICTEMENT CROISSANTS et distincts : `etapeSuivante`
 * et la portée « segment » de la liste s'appuient dessus.
 */
export const RAILS: Rail[] = [
  {
    code: 'R1', libelle: 'J-30', titre: 'Premier avertissement, 30 jours avant la fin de location',
    source: 'facturation', palier: 'J30', jour: -30, canaux: ['sms', 'mail'], actif: true, etat: 'facturation',
    resume: 'Prévention avant l\u2019échéance. Cette étape vit dans le menu Facturation : le rôle '
      + 'recouvrement n\u2019y a pas accès, elle est montrée ici pour situer le parcours.',
    porteur: 'Brevo seul \u2014 aucun appel à ce palier',
    actions: [
      { canal: 'sms',  libelle: 'SMS (1) via Brevo',   detail: 'Automatique à 12h30 \u2014 1 segment, 149 caractères', etat: 'actif' },
      { canal: 'mail', libelle: 'Email (1) via Brevo', detail: 'Modèle 337, depuis no-reply@tire-lait-express.fr',     etat: 'actif' },
    ],
  },
  {
    code: 'R2', libelle: 'J-15', titre: 'Rappel rapproché, 15 jours avant la fin de location',
    source: 'facturation', palier: 'J15', jour: -15, canaux: ['sms', 'mail'], actif: true, etat: 'facturation',
    resume: 'Second avertissement préventif. Également porté par le menu Facturation.',
    porteur: 'Brevo seul \u2014 aucun appel à ce palier',
    actions: [
      { canal: 'sms',  libelle: 'SMS (2) via Brevo',   detail: 'Automatique à 12h30 \u2014 préfixe \u00ab RAPPEL \u00bb', etat: 'actif' },
      { canal: 'mail', libelle: 'Email (2) via Brevo', detail: 'Modèle 336, depuis no-reply@tire-lait-express.fr',          etat: 'actif' },
    ],
  },
  {
    // ⚠️ J+1, compté depuis la FIN DE LOCATION. `date_echeance` valant fin de location + 1,
    // ce rail tire donc sur `date_echeance` elle-même : écart 0. Le libellé « J+0 » utilisé
    // jusqu'au 2026-09-09 comptait à tort depuis `date_echeance`.
    code: 'R3', libelle: 'J+1', titre: 'Premier appel, le lendemain de la fin de location',
    source: 'relances', jour: 1, canaux: ['appel', 'sms', 'mail'], actif: true, etat: 'actif',
    resume: 'La location est arrivée à son terme la veille. L\u2019agent IA appelle, puis W3 envoie le SMS '
      + 'et le mail selon l\u2019issue de l\u2019appel.',
    porteur: 'Amélie Sortant \u2014 Recouvrement',
    actions: [
      // \u26a0\ufe0f CINQ et non dix : `appels_par_passage_j1` vaut 5 et PRIME sur le g\u00e9n\u00e9rique
      // `appels_par_passage` (10), qui n'est qu'un repli. Et c'est une SIMULTAN\u00c9IT\u00c9, pas un
      // quota : le LIMIT vaut \u00ab 5 \u2212 appels en cours \u00bb, et les passages sont \u00e0 la MINUTE.
      { canal: 'appel', libelle: 'Appel (1) par l\u2019agent IA', detail: 'Cron 12h30 \u2192 13h55, \u00e0 la minute, CINQ appels simultan\u00e9s \u2014 la cohorte DU JOUR uniquement', etat: 'actif' },
      { canal: 'sms',   libelle: 'SMS (1) après l\u2019appel',    detail: 'Envoyé par W3 selon l\u2019issue \u2014 jamais aux fixes', etat: 'actif' },
      { canal: 'mail',  libelle: 'Email (3) via Brevo',            detail: 'Modèle 353 \u2014 part après CHAQUE appel, fixes inclus',   etat: 'actif' },
    ],
  },
  {
    // ⚠️ En service depuis le 2026-09-09. Agent EL dédié `agent_3701m22p76xyeh4a8bahtbp6kq8v`,
    // son PROPRE post-call (`el-post-call-j7`) et son propre cron. Le message diffère du R3 et
    // il est porté par le PREMIER MESSAGE ElevenLabs, qui est un réglage PAR AGENT : c'est pour
    // ça qu'il fallait un second agent, et non une variable dynamique.
    code: 'R4', libelle: 'J+7', titre: 'Second appel, une semaine après la fin de location',
    source: 'relances', jour: 7, canaux: ['appel', 'sms'], actif: true, etat: 'actif',
    resume: 'Deuxième tentative vocale pour les dossiers restés sans contact abouti DANS CE RAIL. '
      + 'Pas de mail — retiré du parcours à cette étape par le client : la patiente en a déjà '
      + 'reçu un après son appel du R3.',
    porteur: 'Amélie Sortant J+7 — agent IA dédié',
    actions: [
      { canal: 'appel', libelle: 'Appel (2) par l’agent IA dédié', detail: 'Cron 12h30 → 13h55, à la minute, CINQ appels simultanés — MÊME créneau que R3 depuis le 2026-09-11', etat: 'actif' },
      { canal: 'sms',   libelle: 'SMS (2) après l’appel', detail: 'Envoyé par le post-call J+7 selon l’issue — jamais aux fixes', etat: 'actif' },
      { canal: 'mail',  libelle: 'Email (4) via Brevo', detail: 'Retiré du parcours — décision client du 2026-09-09', etat: 'retire' },
    ],
  },
  {
    code: 'R5', libelle: 'J+14', titre: 'Bascule vers le contentieux',
    source: 'relances', jour: 14, canaux: ['appel', 'sms', 'mail'], actif: true, enServiceDepuis: '2026-09-26', etat: 'actif',
    resume: 'Le ton change : troisième appel, qui annonce le service contentieux, puis le même SMS '
      + 'qu’au J+7 et le mail « dernière relance » (modèle 365).',
    // ✅ EN SERVICE depuis le 2026-09-26 (décision client du 25/09). Agent EL dédié
    // `agent_0001m3btn3s0efqsqkgjxy9f1536` (prompt `Amelie_sortant_J14.md`), son PROPRE post-call
    // (`el-post-call-j14`), son déclenchement (`dashboard-trigger-call-j14`) et son cron
    // (`EL - Recouvrement J14`) — jumeaux de ceux du J+7, à l'écart 13.
    porteur: 'Amélie Sortant J+14 \u2014 agent IA dédié',
    actions: [
      { canal: 'appel', libelle: 'Appel (3) par l\u2019agent IA dédié', detail: 'Cron 12h30 \u2192 13h55, à la minute, DEUX appels simultanés \u2014 volume faible, annonce le service contentieux', etat: 'actif' },
      { canal: 'sms',   libelle: 'SMS (3) après l’appel',          detail: 'Même texte qu’au J+7 — envoyé par le post-call J+14 selon l’issue, jamais aux fixes', etat: 'actif' },
      { canal: 'mail',  libelle: 'Email (5) via Brevo',            detail: 'Modèle 365 « dernière relance » après chaque appel — affiché contentieux@, envoyé depuis info@', etat: 'actif' },
    ],
  },
  {
    code: 'R6', libelle: 'J+21', titre: 'Intervention humaine',
    source: 'relances', jour: 21, canaux: ['appel', 'mail'], actif: false, etat: 'manuel',
    resume: 'Première étape où une conseillère reprend la main. Le mail reste automatique.',
    porteur: 'Conseillère \u2014 appel manuel',
    actions: [
      { canal: 'appel', libelle: 'Appel manuel par l\u2019équipe', detail: '\u00c0 déclencher depuis la liste',       etat: 'manuel' },
      { canal: 'mail',  libelle: 'Email (6) via Brevo',             detail: 'Depuis contentieux@tire-lait-express.fr', etat: 'a-creer' },
    ],
  },
  {
    code: 'R7', libelle: 'J+30', titre: 'Bascule ORG vers LTTC',
    source: 'relances', jour: 30, canaux: ['courrier'], actif: false, etat: 'manuel',
    resume: 'Changement de dossier dans l\u2019outil métier. Étape de validation, sans envoi vers la patiente.',
    porteur: 'Validation humaine \u2014 aucun envoi',
    actions: [
      { canal: 'courrier', libelle: 'Bascule ORG \u2192 LTTC', detail: 'Manuel \u2014 validation par l\u2019équipe', etat: 'manuel' },
    ],
  },
  {
    code: 'R8', libelle: 'J+33', titre: 'Lettre recommandée électronique',
    source: 'relances', jour: 33, canaux: ['courrier'], actif: false, etat: 'manuel',
    resume: 'Lettre recommandée électronique qualifiée, valeur juridique eIDAS. Déclenchée par '
      + 'l\u2019équipe, envoyée par le prestataire.',
    porteur: 'AR24 ou Maileva \u2014 semi-automatique',
    actions: [
      { canal: 'courrier', libelle: 'LRE eIDAS via AR24 ou Maileva', detail: 'Semi-automatique \u2014 déclenchement humain', etat: 'a-creer' },
    ],
  },
  {
    code: 'R9', libelle: 'J+40', titre: 'Mise en demeure',
    source: 'relances', jour: 40, canaux: ['sms', 'courrier'], actif: false, etat: 'prevu',
    resume: 'Dernière étape avant clôture. Le dossier est ensuite clos ou transmis au contentieux.',
    porteur: 'Brevo + suivi humain',
    actions: [
      { canal: 'sms',      libelle: 'SMS (4) \u2014 mise en demeure',  detail: 'Automatique via Brevo', etat: 'a-creer' },
      { canal: 'courrier', libelle: 'Encaissement sous 48 h (chèques)', detail: 'Suivi manuel',          etat: 'manuel' },
    ],
  },
];

export const RAILS_RELANCES = RAILS.filter(r => r.source === 'relances');

/**
 * L'étape tournait-elle CE JOUR-LÀ ? `actif` ne le dit que pour aujourd'hui.
 *
 * ⚠️ Comparaison de chaînes AAAA-MM-JJ : l'ordre alphabétique est l'ordre des dates.
 */
export function enServiceLe(rail: Rail, jour: string): boolean {
  return rail.actif && (!rail.enServiceDepuis || jour >= rail.enServiceDepuis);
}
export const RAILS_FACTURATION = RAILS.filter(r => r.source === 'facturation');

export function railParCode(code: string): Rail | undefined {
  return RAILS.find(r => r.code === code);
}

/**
 * L'écart à comparer à `CURRENT_DATE - date_echeance` pour ce rail.
 *
 * ⚠️⚠️ TOUJOURS passer par cette fonction dans un calcul de dates, jamais par `rail.jour`
 * nu. `date_echeance` est la date « applicable du », soit **fin de location + 1**, alors que
 * `jour` est compté depuis la fin de location. Les confondre décale toute l'échelle d'un
 * jour : mesuré le 2026-09-09, le rail J+1 comptait **86** dossiers avec le bon écart contre
 * **10** sans.
 *
 * ⚠️ Doit rester d'accord avec TROIS endroits côté n8n — les modifier ensemble :
 *   • `PG Dates A Juger` du cron J+1, liste `etapes(jour)` : 0, 6, 13, 20, 29, 32, 39 ;
 *   • `PG Cibles Appels` du cron J+1  : `date_echeance = CURRENT_DATE`     (écart 0) ;
 *   • `PG Cibles J7`      du cron J+7 : `date_echeance = CURRENT_DATE - 6` (écart 6).
 * Vérifié le 2026-09-09 : l'écran et les deux crons comptent pareil — 86 / 28 / 31.
 */
export function ecartEcheance(rail: Rail): number {
  return rail.jour - 1;
}

/**
 * Cet écart tombe-t-il sur CETTE étape aujourd'hui ?
 *
 * ⚠️⚠️ SEUL ENDROIT QUI LE SAIT — ne pas en refaire une copie. `railDeRelance()` et
 * `lignesDuRail()` répondaient chacun de leur côté, et la fenêtre de rattrapage du
 * 2026-09-16 n'a été posée que dans le second. Conséquences mesurées le jour même :
 *   • l'écran Parcours annonçait **75** dossiers au J+1 quand sa propre liste en
 *     montrait **180**, et son bouton « Ouvrir la liste (75) » ouvrait les 180 ;
 *   • `estRailJ7()` (RecouvrementView) en dérive le choix de l’AGENT : les échéances
 *     du 08 et du 09/09 ne tombaient sur aucune étape, donc `null`, donc l'agent du
 *     J+1 sur des dossiers du J+7.
 */
export function surLEtapeAujourdhui(
  rail: Rail, j: number, auj: string = aujourdhuiIso(),
): boolean {
  const ecart = ecartEcheance(rail);

  // ⚠️⚠️ UN JOUR, ET UN SEUL, SEPT JOURS SUR SEPT (2026-09-25, demande du client).
  // Du 18 au 25/09, le week-end était reporté au lundi, qui couvrait alors trois jours
  // d'échéance. Revirement : « les appels et SMS reprennent le week-end, mais on ne reporte
  // plus à lundi ». Chaque jour appelle sa propre cohorte, samedi et dimanche compris.
  //
  // ⚠️⚠️ CETTE RÈGLE VIT AUSSI CÔTÉ n8n : `PG Cibles Appels`, `PG Bilan Jour`,
  // `PG Cibles Relance` (cron J+1), `PG Cibles J7`, `PG Bilan J7`, `PG Cibles Relance J7`,
  // et leurs jumeaux J+14 — `date_echeance = CURRENT_DATE - écart`. Si l'écran et les crons
  // cessent de compter pareil, la tuile annonce un chiffre que personne ne servira : c'est
  // exactement le défaut constaté le 2026-09-16.
  //
  // ⚠️ `auj` reste un paramètre : c'est lui qui rend l'écran capable de regarder un autre jour.
  //
  // ⚠️ Le contrôle du LUNDI reprend le samedi et le dimanche (personne ne contrôle le
  // week-end) : c'est l'écran de contrôle qui empile ces trois journées, pas cette fonction.
  void auj;
  return j === ecart;
}
/**
 * Sur quelle étape du parcours cette relance tombe-t-elle AUJOURD'HUI ?
 *
 * `null` dans trois cas, tous légitimes :
 *   • pas d'échéance connue ;
 *   • échéance dans le futur (pas encore entrée dans le parcours) ;
 *   • **elle est entre deux étapes** — le cas le plus fréquent, 81 % du stock actif.
 *     Un dossier à J+3 n'a aucun rendez-vous ce jour-là ; il en aura un à J+7.
 */
export function railDeRelance(r: Relance, auj: string = aujourdhuiIso()): Rail | null {
  if (!r.date_echeance) return null;
  const j = ecartJours(r.date_echeance, auj);
  if (!Number.isFinite(j) || j < 0) return null;
  return RAILS_RELANCES.find(x => surLEtapeAujourdhui(x, j, auj)) ?? null;
}

/**
 * Jusqu'où ce dossier est-il ALLÉ dans le parcours ? La dernière étape dépassée.
 *
 * ⚠️ À ne pas confondre avec `railDeRelance()`, qui répond « a-t-elle un rendez-vous
 * AUJOURD'HUI ». Celle-là est `null` pour 81 % du stock — les dossiers en transit entre
 * deux étapes. Or un envoi manuel se fait justement n'importe quel jour, sur un dossier
 * injoignable : il faut donc savoir où il en est, pas s'il est pile sur une étape.
 *
 * `null` a un seul sens ici : **pas encore entrée dans le parcours** (échéance absente ou
 * à venir).
 */
export function railAtteint(r: Relance, auj: string = aujourdhuiIso()): Rail | null {
  if (!r.date_echeance) return null;
  const j = ecartJours(r.date_echeance, auj);
  if (!Number.isFinite(j) || j < 0) return null;
  // Les rails sont en écarts strictement croissants : le dernier dépassé est le sien.
  let atteint: Rail | null = null;
  for (const x of RAILS_RELANCES) if (ecartEcheance(x) <= j) atteint = x;
  return atteint;
}

/**
 * ── QUELS ÉCRITS PEUT-ON ENCORE ENVOYER À LA MAIN ? ───────────────────────────
 *
 * Le bouton ✈ envoyait le SMS **et** le mail à toute ligne en portant les coordonnées,
 * sans jamais regarder le parcours. Or le client a **retiré le mail à partir du J+7**
 * (`R4`, action `mail` en `retire`) : sur ces dossiers le bouton contredisait sa décision.
 * Mesuré le 2026-09-11 : **44 dossiers sur l'étape J+7, les 44 avec une adresse valide**,
 * et 566 dossiers ayant dépassé le J+7.
 *
 * ⚠️ Le SMS, lui, reste ouvert à TOUTES les étapes. C'est la raison d'être du bouton :
 * joindre une patiente qu'on n'arrive pas à avoir au téléphone. Le retirer sur les étapes
 * dont le parcours automatique ne prévoit pas de SMS enlèverait un moyen d'action sans que
 * personne ne l'ait demandé.
 *
 * ⚠️ Le mail concerné est celui de la relance ordonnance (modèle Brevo 353). Les étapes
 * J+14 et suivantes prévoient un mail de **contentieux**, qui n'existe pas encore et qui
 * n'est pas celui-ci : elles comptent donc parmi les rails « sans mail ».
 *
 * ⚠️⚠️ Cette fonction dit ce qui est PERMIS ; c'est le serveur qui tranche réellement
 * (`RAILS_AVEC_MAIL` dans W-Envoi-Relance). Un navigateur ne décide pas des canaux — il
 * envoie le rail et lit ce que le serveur a fait. Les deux doivent rester d'accord.
 */
export function mailDansLeRail(rail: Rail | null): boolean {
  if (!rail) return true;   // pas encore dans le parcours : rien ne l'a retiré
  return rail.actions.some(a => a.canal === 'mail' && a.etat === 'actif');
}

/** Ce que le bouton ✈ enverrait vraiment à cette patiente, aujourd'hui. */
export function ecritsDeRelance(
  r: Relance, auj: string = aujourdhuiIso(),
): { sms: boolean; mail: boolean; rail: Rail | null } {
  const rail = railAtteint(r, auj);
  return {
    sms: Boolean(r.telephone) && !isFixe(r.telephone),
    mail: Boolean(r.email) && mailDansLeRail(rail),
    rail,
  };
}

/** L'étape suivante du parcours, ou `null` si c'est la dernière. */
export function etapeSuivante(rail: Rail): Rail | null {
  return RAILS_RELANCES.find(x => x.jour > rail.jour) ?? null;
}

/**
 * Portée d'une liste de rail :
 *   'jour'    — la cohorte du jour même de l'étape (le défaut, et le travail programmé)
 *   'segment' — de cette étape jusqu'à la veille de la suivante (les dossiers en transit)
 *   'toutes'  — toutes les échéances passées, sans borne
 */
export type PorteeRail = 'jour' | 'segment' | 'toutes';

/**
 * Les lignes d'un rail selon la portée demandée. Les dossiers SORTIS du parcours
 * (ordonnance renouvelée) sont toujours écartés : ils n'ont plus rien à y faire.
 */
export function lignesDuRail(
  lignes: Relance[], rail: Rail, portee: PorteeRail = 'jour', auj: string = aujourdhuiIso(),
): Relance[] {
  if (rail.source !== 'relances') return [];
  const suivante = etapeSuivante(rail);
  return lignes.filter(r => {
    // ⚠️⚠️ UNE COUVERTE N'EST PAS DANS LE RAIL — demande du client, 2026-09-16.
    // Elle a une ordonnance qui court : il n'y a rien à lui demander, donc rien à faire
    // d'elle à cette étape. Mesure du jour, AVANT correction : J+1 affichait 75 dossiers
    // pour 54 à appeler, J+7 59 pour 35, J+14 35 pour 25.
    //
    // ⚠️ C'est une SUSPENSION, pas une sortie : quand la couverture expire, la ligne
    // revient d'elle-même dans le rail qu'elle atteint alors. Six dossiers sont dans ce
    // cas (couverture s'achevant avant J+40) — voir `couverteAujourdhui`.
    if (horsParcours(r) || couverteAujourdhui(r, auj) || !r.date_echeance) return false;
    const j = ecartJours(r.date_echeance, auj);
    if (!Number.isFinite(j) || j < 0) return false;
    if (portee === 'toutes') return true;
    if (portee === 'jour') return surLEtapeAujourdhui(rail, j, auj);
    // 'segment' : de cette étape jusqu'à la veille de la suivante.
    return j >= ecartEcheance(rail)
      && (suivante == null || j < ecartEcheance(suivante));
  });
}

/** Le J+N d'un dossier, ou `null` si son échéance est inconnue. */
export function ecartDeRelance(r: Relance, auj: string = aujourdhuiIso()): number | null {
  if (!r.date_echeance) return null;
  const j = ecartJours(r.date_echeance, auj);
  return Number.isFinite(j) ? j : null;
}

/**
 * ── LA SORTIE DU PARCOURS ─────────────────────────────────────────────────────
 * Une seule règle est ABSOLUE : l'ordonnance a été renouvelée, constaté dans ORTHOP.
 * Elle seule signifie « cette patiente n'a plus rien à faire dans le parcours ».
 */
export function estSortie(r: Relance): boolean {
  return Boolean(r.resolu_le);
}

/**
 * ── LA SORTIE MANUELLE ────────────────────────────────────────────────────────
 * L'équipe a sorti la patiente du parcours (dossier terminé, matériel rendu, demande de la
 * patiente…) : plus aucun appel, SMS ni mail de relance. Le serveur applique la même règle
 * dans les crons et derrière chaque bouton (`sorti_le IS NULL`).
 *
 * ⚠️ Ce n'est PAS `estSortie()` : celle-ci veut dire « ORTHOP ne la réclame plus » et se
 * lit « ordonnance reçue » partout. Une sortie manuelle est une DÉCISION, réversible, et
 * elle a son propre compteur — la ranger dans « ordonnances reçues » mentirait.
 */
export function sortieManuelle(r: Relance): boolean {
  return Boolean(r.sorti_le);
}

/** Plus rien à faire dans le parcours, quelle qu'en soit la raison. */
export function horsParcours(r: Relance): boolean {
  return estSortie(r) || sortieManuelle(r);
}

/**
 * ── LA SUSPENSION : UNE ORDONNANCE COURT ENCORE ───────────────────────────────
 * `fin_application` est la fin de la période couverte par l'ordonnance en cours. Tant
 * qu'elle est dans le futur, il n'y a RIEN à demander à la patiente.
 *
 * ⚠️ Ce n'est PAS `estSortie()` : la couverture EXPIRE, et la ligne redevient alors
 * relançable toute seule. Confondre les deux ferait disparaître définitivement des
 * dossiers qui doivent revenir.
 *
 * ⚠️ OUVERT PAR DÉFAUT — `null` ou date illisible ⇒ on relance. Une colonne vide ne peut
 * pas faire taire la campagne. Miroir exact du SQL des crons :
 * `fin_application IS NULL OR fin_application <= CURRENT_DATE`.
 */
export function couverteAujourdhui(r: Relance, auj: string = aujourdhuiIso()): boolean {
  const fin = String(r.fin_application || '').slice(0, 10);
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(fin)) return false;
  return fin > auj;
}

/**
 * ── LA SEULE QUESTION QUI COMPTE AVANT DE SOLLICITER QUELQU'UN ────────────────
 * Rend la raison de NE PAS la solliciter, ou `null` si rien ne s'y oppose.
 *
 * ⚠️⚠️ DEUX NATURES DE SIGNAL, ET ELLES NE SE TRAITENT PAS PAREIL.
 *
 *   PREUVES (elles viennent d'ORTHOP)                     → bloquent, ici et au serveur
 *     resolu_le        la prescription n'est plus réclamée
 *     fin_application  une ordonnance couvre encore la période
 *
 *   DÉCLARATIF (un modèle qui interprète un transcript)    → signalé, jamais bloquant
 *     ordonnance_deja_envoyee   la maman l'a DIT au téléphone
 *
 * Le déclaratif est COLLANT : seul le bouton « Vérifié » le lève. Un faux positif ferait
 * taire le dossier jusqu'à ce que quelqu'un s'en aperçoive — et rappeler pour vérifier est
 * justement l'action utile. Il n'entre donc pas ici ; il garde sa propre pastille.
 *
 * ⚠️ MIROIR de `PG Cibles Appels`, `PG Cibles J7`, du `Build Pre-Update SQL` des deux
 * boutons d'appel et de l'`Auth` de l'envoi manuel. Si l'un change et pas les autres,
 * l'écran annonce un travail que le serveur refuse — le défaut que ce projet combat.
 */
export function raisonDeNePasSolliciter(r: Relance, auj: string = aujourdhuiIso()): string | null {
  // La sortie manuelle d'abord : c'est une décision de l'équipe, et elle prime sur tout —
  // même ordre que le serveur (`Build Pre-Update SQL`, `Prepare` de l'envoi manuel).
  if (sortieManuelle(r)) {
    return 'Sortie du parcours le ' + formatDate(jourLocal(r.sorti_le)) + (r.sorti_par ? ' par ' + r.sorti_par : '')
      + (r.sorti_motif ? ' — ' + r.sorti_motif : '');
  }
  if (estSortie(r)) return 'Ordonnance déjà renouvelée — ORTHOP ne la réclame plus';
  if (couverteAujourdhui(r, auj)) return 'Ordonnance en cours jusqu au ' + String(r.fin_application).slice(0, 10);
  return null;
}

/**
 * Cette ligne PEUT-elle être jugée par ORTHOP ?
 *
 * ⚠️ Les 153 lignes de la cohorte Excel du 25/08 n'ont aucun numéro de prescription :
 * elles ne pourront JAMAIS être déclarées résolues. Elles sont pourtant toutes déjà
 * jointes par écrit — ce ne sont pas des dossiers en retard, ce sont des dossiers sans
 * suivi ORTHOP. Sans ce marquage, l'écran laisse croire à un taux de résolution effondré
 * sur les échéances du 22 au 28 août. Elles sortent par le plafond de tentatives.
 */
export function suiviOrthop(r: Relance): boolean {
  return Boolean(r.orthop_prescription);
}

/**
 * ── LES RÈGLES D'ARRÊT INTERNES À UN RAIL ─────────────────────────────────────
 * A-t-elle été jointe par écrit **depuis son entrée dans CE rail** ?
 *
 * ⚠️⚠️ C'est la nuance qui fait tenir toute l'échelle, et elle a été mesurée le
 * 2026-09-04. La règle « dès qu'un SMS ou un mail est livré, on n'appelle plus » avait été
 * écrite pour une campagne en UN SEUL passage. Appliquée au dossier, elle vide tous les
 * rails suivants : sur les 423 dossiers arrivés à J+7, **418** avaient déjà reçu un écrit
 * un jour quelconque — un rail J+7 n'aurait appelé que 5 personnes. Ramenée au rail, la
 * population réelle est de 417.
 *
 * Un SMS livré le jour de l'échéance ne dit rien de ce qu'il faut faire une semaine plus
 * tard : c'est justement la raison d'être du rail suivant.
 */
export function jointParEcritDansLeRail(
  r: Relance,
  rail: Rail,
  _auj: string = aujourdhuiIso(),
): boolean {
  if (!r.date_echeance || rail.source !== 'relances') return false;
  // Le jour d'entrée dans le rail, en jour parisien.
  const entree = decalerJours(r.date_echeance, ecartEcheance(rail));
  if (!entree) return false;

  const smsOk = r.sms_statut === 'livre'
    && Boolean(r.sms_le) && jourLocal(r.sms_le) >= entree;
  const mailOk = (r.email_statut === 'livre' || r.email_statut === 'ouvert' || r.email_statut === 'clique')
    && Boolean(r.email_le) && jourLocal(r.email_le) >= entree;

  return smsOk || mailOk;
}

/**
 * A-t-elle été jointe **à la voix** depuis son entrée dans ce rail ?
 *
 * « Jointe à la voix » veut dire qu'elle a parlé OU qu'un message vocal a réellement été
 * déposé. Un appel qui sonne dans le vide ne transmet rien.
 *
 * ⚠️ Le garde-fou de statut (`À appeler` / `Non répondu`) du cron est lui aussi INTERNE à
 * un rail : une ligne `Répondeur` a entendu le message il y a une semaine, la rappeler au
 * rail suivant est l'objet du rail, pas une erreur. Appliquer ce garde-fou au stock de R4
 * donnait 16 dossiers au lieu de 423.
 */
export function jointVoixDansLeRail(
  r: Relance,
  rail: Rail,
  _auj: string = aujourdhuiIso(),
): boolean {
  if (!r.date_echeance || rail.source !== 'relances') return false;
  const entree = decalerJours(r.date_echeance, ecartEcheance(rail));
  if (!entree || !r.dernier_appel || jourLocal(r.dernier_appel) < entree) return false;

  const aParle = r.statut === 'Répondu SMS' || r.statut === 'Répondu transfert';
  const vocalDepose = r.vocal_statut === 'depose_el' || r.vocal_statut === 'depose_agent';
  return aParle || vocalDepose;
}

/** Le plafond de tentatives appliqué par le cron d'appels. */
export const PLAFOND_TENTATIVES = 5;

export function quotaEpuise(r: Relance): boolean {
  return (r.nb_tentatives ?? 0) >= PLAFOND_TENTATIVES;
}

/**
 * ── LE RATTRAPAGE D'UNE ÉCHÉANCE SAUTÉE ───────────────────────────────────────
 *
 * Le cron d'appels ne prend que `date_echeance = CURRENT_DATE` (décision du 2026-09-09).
 * Une journée où il n'a pas tourné — module en pause, n8n à terre — est donc perdue
 * SANS AUCUN RATTRAPAGE : sa cohorte n'a plus qu'à attendre l'étape suivante, cinq à six
 * jours plus tard, servie par un agent dont le message suppose un premier contact déjà
 * passé.
 *
 * Mesuré en base le 2026-09-10, au lendemain d'une pause : l'échéance du 09/09 portait
 * **86 dossiers, 0 appelé**. Six autres échéances traînaient de 1 à 11 dossiers jamais
 * appelés — 117 en tout.
 *
 * ⚠️⚠️ « SAUTÉE » VEUT DIRE JAMAIS APPELÉE, et non « mal appelée ». Une ligne appelée une
 * fois puis restée `Non répondu` n'a été privée de rien : elle a été servie, et c'est
 * l'étape suivante qui la reprend. Le rattrapage ne vise donc QUE `nb_tentatives = 0`,
 * sans quoi il doublerait le travail des rails au lieu de combler leur trou.
 *
 * ⚠️⚠️ Ces conditions sont le MIROIR de `PG Cibles Appels`, moins la borne de date — qui
 * est précisément l'objet du rattrapage. Si l'une des deux change sans l'autre, cet écran
 * annoncera « N à rattraper » là où un lancement ne partirait sur personne.
 *
 * ⚠️ L'agent J+1 annonce la date d'échéance EXPLICITEMENT (« votre prescription est
 * arrivée à échéance le {{date_echeance}} »), jamais « hier ». Un rattrapage tardif reste
 * donc exact — c'est ce qui rend l'opération jouable sur une échéance vieille de dix
 * jours. Ne pas remplacer cette date par un mot relatif dans le prompt.
 */
export function aRattraper(r: Relance, auj: string = aujourdhuiIso()): boolean {
  if (!r.date_echeance || !r.telephone) return false;
  // ⚠️ L'échéance DU JOUR n'est pas sautée : le cron passe à 12h30. L'afficher pousserait
  // à doubler l'automate, donc à rappeler une patiente déjà appelée quelques minutes plus
  // tôt — le délai de 45 minutes du cron ne protège pas un lancement manuel.
  if (r.date_echeance >= auj) return false;
  if (horsParcours(r)) return false;                               // reçue, ou sortie à la main
  if ((r.nb_tentatives ?? 0) > 0 || r.dernier_appel) return false; // jamais appelée
  // Un statut posé à la main (« Marquer répondeur ») compte comme un traitement, même sans
  // appel enregistré : `quickOutcome` permet ce cas depuis le tableau.
  if (r.statut !== 'À appeler' && r.statut !== 'Non répondu') return false;
  // La règle du contact écrit tient même sans appel : le bouton ✈ peut avoir servi cette
  // patiente par SMS et par mail sans jamais composer son numéro.
  if (r.sms_statut === 'livre') return false;
  if (r.email_statut === 'livre' || r.email_statut === 'ouvert' || r.email_statut === 'clique') return false;
  return true;
}

export interface EcheanceARattraper {
  /** L'échéance, telle qu'en base (`date_echeance`, ISO). */
  date: string;
  /** Son ancienneté en jours parisiens — 1 = hier. */
  jours: number;
  /** Tout ce que porte l'échéance, sortis du parcours compris. */
  total: number;
  /** Ce qu'un rattrapage appellerait RÉELLEMENT. C'est le seul chiffre actionnable. */
  aRattraper: number;
}

/**
 * Les échéances passées qui portent encore des dossiers jamais appelés, la plus récente
 * d'abord.
 *
 * ⚠️ Se calcule sur TOUTES les relances, jamais sur le périmètre affiché. Une échéance
 * sautée est par nature hors du cadrage courant (le sélecteur de journée montre
 * aujourd'hui) : la chercher dans `scope` la rendrait invisible exactement quand elle
 * compte.
 */
export function echeancesARattraper(
  relances: Relance[],
  auj: string = aujourdhuiIso(),
): EcheanceARattraper[] {
  const par = new Map<string, EcheanceARattraper>();
  for (const r of relances) {
    const d = r.date_echeance;
    if (!d || d >= auj) continue;
    const e = par.get(d) ?? { date: d, jours: ecartJours(d, auj), total: 0, aRattraper: 0 };
    e.total += 1;
    if (aRattraper(r, auj)) e.aRattraper += 1;
    par.set(d, e);
  }
  return [...par.values()]
    .filter(e => e.aRattraper > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * ── CES COMPTEURS ONT ÉTÉ CONFRONTÉS À LA BASE ────────────────────────────────
 * Mesuré le 2026-09-09, une étape = UN JOUR précis, écart compté sur `date_echeance` :
 *
 *   étape | écart | date visée | sur l'étape | jamais jointes à la voix
 *   J+1   |     0 | 09/09      |          86 |                       86
 *   J+7   |     6 | 03/09      |          28 |                        3
 *   J+14  |    13 | 27/08      |          31 |                        0
 *   J+21 à J+40 : 0 — la campagne a démarré le 22/08, rien n'a encore vieilli jusque-là.
 *
 * ⚠️ POURQUOI CE CONTRÔLE COMPTE : l'écran et les crons doivent compter pareil. Un écran
 * qui annonce « 417 à appeler » quand le cron n'en sélectionne que 5 est pire qu'un écran
 * absent — c'est le genre d'écart qui avait fait passer une panne de cinq jours pour un
 * fonctionnement normal.
 *
 * ⚠️ `dansLeRail` INCLUT les sortis. C'est volontaire : le rail décrit une population, pas
 * une file de travail. Ne pas confondre avec `actifs`.
 */
export interface ComptesRail {
  rail: Rail;
  /** Dossiers dont l'écart tombe dans la fenêtre du rail, résolus compris. */
  dansLeRail: number;
  /** Sortis du parcours : ordonnance renouvelée, constatée dans ORTHOP. */
  sortis: number;
  /** Sorties du parcours À LA MAIN par l'équipe — une décision, pas une ordonnance reçue. */
  sortiesManuelles: number;
  /**
   * SUSPENDUES : une ordonnance court encore, il n'y a rien à leur demander.
   * ⚠️ Ce n'est pas une sortie : quand la couverture expire elles reviennent d'elles-mêmes.
   */
  couvertes: number;
  /**
   * Le travail RÉEL de cette étape : ni sorties, ni couvertes.
   * ⚠️⚠️ C'est exactement `lignesDuRail(lignes, rail, 'jour', auj).length` — le chiffre
   * de la tuile et celui de la liste qu'elle ouvre ne peuvent plus diverger.
   * ⚠️ `dansLeRail = sortis + sortiesManuelles + couvertes + actifs`.
   */
  actifs: number;
  /** Parmi les actifs : déjà joints par écrit DEPUIS leur entrée dans ce rail. */
  jointsEcrit: number;
  /** Parmi les actifs : déjà joints à la voix depuis leur entrée dans ce rail. */
  jointsVoix: number;
  /** Ce qui reste réellement à traiter sur ce rail. */
  aTraiter: number;
  /** Parmi les actifs : plafond de tentatives atteint. */
  quotaEpuise: number;
  /** Parmi les actifs : aucun suivi ORTHOP, donc jamais résolvables. */
  sansSuiviOrthop: number;
}

/**
 * Les compteurs d'un rail. Chaque rail est jugé par SA propre règle — c'est pour ça que
 * cette fonction prend le rail en paramètre plutôt que de tout calculer d'un bloc.
 */
export interface ComptesGlobaux {
  /** Non résolues, échéance passée ou du jour : le stock réellement en cours. */
  actives: number;
  /** Sorties du parcours : ordonnance renouvelée, constatée dans ORTHOP. */
  sorties: number;
  /** Sorties du parcours à la main par l'équipe. Hors de `actives`, comme `sorties`. */
  sortiesManuelles: number;
  /** Sur une des neuf étapes aujourd'hui — le travail programmé du jour, couvertes exclues. */
  surUneEtape: number;
  /** Suspendues : une ordonnance court encore. Aucun rendez-vous tant qu’elle court. */
  couvertes: number;
  /** Entre deux étapes : aucun rendez-vous aujourd'hui, elles attendent la suivante. */
  entreDeuxEtapes: number;
  /** Parmi celles sur une étape : rien ne leur est parvenu depuis leur entrée. */
  aTraiter: number;
}

/**
 * Les totaux de l'écran d'entrée.
 *
 * ⚠️⚠️ `entreDeuxEtapes` N'EST PAS DÉCORATIF. Avec des étapes à un jour précis, la somme
 * des neuf tuiles ne fait PAS le total de la base : mesuré le 2026-09-04, 179 dossiers sur
 * une étape contre 761 entre deux. Un écran qui n'afficherait que les tuiles aurait l'air
 * d'avoir égaré 761 dossiers, et c'est exactement le genre de trou silencieux qu'on
 * cherche à ne plus produire. L'invariant à préserver :
 *
 *     surUneEtape + entreDeuxEtapes + couvertes === actives
 *
 * ⚠️ `couvertes` est le TROISIÈME terme, ajouté le 2026-09-16. Une couverte n’est ni
 * sur une étape (il n'y a rien à lui demander) ni entre deux (elle n'attend pas un
 * rendez-vous, elle attend la fin de sa couverture). La ranger dans `entreDeuxEtapes`
 * aurait fait boucler les totaux en racontant quelque chose de faux.
 */
export function comptesGlobaux(
  lignes: Relance[], auj: string = aujourdhuiIso(),
): ComptesGlobaux {
  let actives = 0, sorties = 0, sortiesManuelles = 0, surUneEtape = 0, entreDeuxEtapes = 0, aTraiter = 0, couvertes = 0;
  for (const r of lignes) {
    if (!r.date_echeance) continue;
    const j = ecartJours(r.date_echeance, auj);
    if (!Number.isFinite(j) || j < 0) continue;   // pas encore entrée dans le parcours
    if (estSortie(r)) { sorties++; continue; }
    // Après l'ORTHOP : une ordonnance reçue reste comptée comme telle, même sortie à la main.
    if (sortieManuelle(r)) { sortiesManuelles++; continue; }
    actives++;
    // ⚠️ Une couverte est comptée ACTIVE (elle reviendra) mais sur AUCUNE étape.
    if (couverteAujourdhui(r, auj)) { couvertes++; continue; }
    const rail = railDeRelance(r, auj);
    if (rail) {
      surUneEtape++;
      if (!jointParEcritDansLeRail(r, rail, auj) && !jointVoixDansLeRail(r, rail, auj)) aTraiter++;
    } else {
      entreDeuxEtapes++;
    }
  }
  return { actives, sorties, sortiesManuelles, surUneEtape, entreDeuxEtapes, aTraiter, couvertes };
}

export function comptesDuRail(
  rail: Rail,
  lignes: Relance[],
  auj: string = aujourdhuiIso(),
): ComptesRail {
  const dedans = lignes.filter(r => railDeRelance(r, auj)?.code === rail.code);
  // ⚠️⚠️ TROIS PARTS DISJOINTES, dans cet ordre : une sortie l’emporte sur une couverture.
  // Demande du client le 2026-09-16 : « ceux qui sont couverts ne doivent pas être dans
  // les rails ». `lignesDuRail()` les écartait déjà ; ces compteurs, non — la tuile
  // annonçait 75 au J+1 et sa liste en montrait 180.
  // ⚠️ QUATRE parts depuis le 2026-09-25 : la sortie manuelle vient après l'ORTHOP et avant
  // la couverture. `actifs` reste exactement `lignesDuRail(…, 'jour')`, qui écarte les deux.
  const sortis   = dedans.filter(r => estSortie(r));
  const manuelles = dedans.filter(r => !estSortie(r) && sortieManuelle(r));
  const couvertes = dedans.filter(r => !horsParcours(r) && couverteAujourdhui(r, auj));
  const actifs   = dedans.filter(r => !horsParcours(r) && !couverteAujourdhui(r, auj));
  const jointsEcrit = actifs.filter(r => jointParEcritDansLeRail(r, rail, auj));
  const jointsVoix = actifs.filter(r => jointVoixDansLeRail(r, rail, auj));

  return {
    rail,
    dansLeRail: dedans.length,
    sortis: sortis.length,
    sortiesManuelles: manuelles.length,
    couvertes: couvertes.length,
    actifs: actifs.length,
    jointsEcrit: jointsEcrit.length,
    jointsVoix: jointsVoix.length,
    // « À traiter » = rien ne lui est parvenu DEPUIS son entrée dans ce rail, ni voix ni
    // écrit. Le nombre de tentatives n'entre PAS dans le calcul : une patiente appelée
    // sept fois sans que rien ne lui parvienne reste entièrement à traiter.
    aTraiter: actifs.filter(r =>
      !jointParEcritDansLeRail(r, rail, auj) && !jointVoixDansLeRail(r, rail, auj)).length,
    quotaEpuise: actifs.filter(quotaEpuise).length,
    sansSuiviOrthop: actifs.filter(r => !suiviOrthop(r)).length,
  };
}
