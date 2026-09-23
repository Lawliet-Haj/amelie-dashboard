/**
 * CONTRÔLER UNE JOURNÉE — le jugement, séparé de son affichage.
 *
 * Ce fichier répond, pour une patiente et une étape, aux trois questions que le client a
 * posées le 2026-09-21 : *« qu'on puisse voir quelle action réaliser et ce qui a déjà été
 * fait »*, et *« distinguer les cas qu'on n'a vraiment pas pu contacter »*.
 *
 *   1. où en est-elle       → `jointe` / `rienTente`
 *   2. ce qui a été fait    → `appel`, `sms`, `mail`, tous datés DANS LE RAIL
 *   3. quoi faire ensuite   → `action`
 *
 * ⚠️⚠️ IL VIT DANS `src/lib/` ET NON DANS LA VUE, pour une raison mesurée : les contrôles
 * de ce projet ont déjà été trompés par des scripts qui recopiaient les helpers « à
 * l'identique ». Un tel test ne peut PAS voir que la source a divergé — c'est ce qui a
 * laissé passer la fenêtre de rattrapage absente de `railDeRelance()` le 2026-09-16, où la
 * tuile annonçait 75 au-dessus d'une liste de 180. Ici, un contrôle importe la fonction que
 * l'écran appelle, sans avoir à charger React.
 *
 * ⚠️ Aucune date n'est recalculée ici : tout passe par `ecartEcheance()` et les helpers de
 * `format.ts`. Une copie de plus de l'écart des rails et les chiffres divergeraient du
 * reste du dashboard.
 */
import type { Relance } from '../types';
import type { Ton } from '../ui/Chip';
import {
  ecartEcheance, etapeSuivante, mailDansLeRail, quotaEpuise, PLAFOND_TENTATIVES,
  jointVoixDansLeRail, jointParEcritDansLeRail, type Rail,
} from './rails';
import { aujourdhuiIso, decalerJours, jourLocal, isFixe, formatDate } from './format';

/**
 * « Jointe » veut dire QUELQUE CHOSE LUI EST PARVENU, pas qu'on a essayé.
 *
 * ⚠️ C'est la définition arbitrée par le client le 2026-09-17, et elle se lit AU RAIL :
 * une patiente jointe la semaine dernière, à l'étape précédente, compte comme non jointe
 * sur celle-ci — c'est la raison d'être d'une nouvelle étape.
 */
export function estJointe(r: Relance, rail: Rail, jour: string): boolean {
  return jointVoixDansLeRail(r, rail, jour) || jointParEcritDansLeRail(r, rail, jour);
}

/** L'état d'un canal pour CE rail : ce qu'on affiche, et ce qu'il vaut pour le compte. */
export interface EtatCanal {
  texte: string;
  ton: Ton;
  /** Quelque chose est parti sur ce canal depuis l'entrée dans le rail. */
  tente: boolean;
  /** Ce canal a ABOUTI : la patiente a reçu quelque chose. */
  abouti: boolean;
  /** Ce canal ne s'applique pas ici — décision du parcours ou donnée absente, pas une panne. */
  horsPerimetre: boolean;
}

const SANS_OBJET = (texte: string): EtatCanal =>
  ({ texte, ton: 'neutre', tente: false, abouti: false, horsPerimetre: true });

/**
 * Le jour où cette patiente est entrée dans ce rail. Tout se compare à cette date.
 *
 * ⚠️ `ecartEcheance()` et pas `rail.jour` : l'échelle est ancrée sur la FIN DE LOCATION,
 * et `date_echeance` vaut fin de location + 1. Un `rail.jour` nu décale tout d'un jour —
 * le décalage qui faisait compter 10 dossiers au J+1 au lieu de 86.
 */
export function entreeDansLeRail(r: Relance, rail: Rail): string | null {
  return r.date_echeance ? decalerJours(r.date_echeance, ecartEcheance(rail)) : null;
}

function depuisEntree(ts: string | null | undefined, entree: string | null): boolean {
  if (!entree || !ts) return false;
  const j = jourLocal(ts);
  return Boolean(j) && j >= entree;
}

/**
 * L'APPEL — ce qui s'est passé au téléphone depuis l'entrée dans le rail.
 *
 * ⚠️ Un statut resté sur « À appeler » APRÈS un appel n'est pas une contradiction : le
 * lancement a été refusé (limite CPS du tronc SIP) ou le post-call n'a pas tourné. Le
 * recopier tel quel donnerait « appelée (À appeler) », qui ne veut rien dire pour la
 * lectrice — alors que c'est justement un cas qu'un contrôle doit faire remonter.
 */
export function canalAppel(r: Relance, entree: string | null): EtatCanal {
  if (!r.telephone) return SANS_OBJET('Pas de téléphone');
  if (!depuisEntree(r.dernier_appel, entree)) {
    return { texte: 'Pas appelée', ton: 'attente', tente: false, abouti: false, horsPerimetre: false };
  }
  const abouti = (texte: string): EtatCanal =>
    ({ texte, ton: 'ok', tente: true, abouti: true, horsPerimetre: false });
  const rate = (texte: string): EtatCanal =>
    ({ texte, ton: 'echec', tente: true, abouti: false, horsPerimetre: false });

  if (r.statut === 'Répondu transfert') return abouti('Transférée à une conseillère');
  if (r.statut === 'Répondu SMS') return abouti('Elle a parlé');
  if (r.vocal_statut === 'depose_el' || r.vocal_statut === 'depose_agent') {
    return abouti('Message vocal déposé');
  }
  if (r.statut === 'Répondeur') return rate('Messagerie — aucun message laissé');
  if (r.statut === 'Raccroché') return rate('A décroché puis raccroché');
  if (r.statut === 'Non répondu') return rate('Appelée, sans réponse');
  if (r.echec_motif) return rate('Appel non abouti — ' + String(r.echec_motif).toLowerCase());
  return rate('Appel lancé, aucun résultat enregistré');
}

/** Le SMS. ⚠️ Un numéro fixe n'en reçoit pas : c'est une donnée, pas un manquement. */
export function canalSms(r: Relance, entree: string | null): EtatCanal {
  if (!r.telephone) return SANS_OBJET('Pas de téléphone');
  if (isFixe(r.telephone)) return SANS_OBJET('Fixe — pas de SMS');
  if (!r.sms_statut || !depuisEntree(r.sms_le, entree)) {
    return { texte: 'Pas de SMS', ton: 'attente', tente: false, abouti: false, horsPerimetre: false };
  }
  const t = (texte: string, ton: Ton, abouti: boolean): EtatCanal =>
    ({ texte, ton, tente: true, abouti, horsPerimetre: false });
  switch (r.sms_statut) {
    case 'livre':       return t('SMS livré', 'ok', true);
    case 'envoye':      return t('SMS envoyé, livraison non confirmée', 'encours', false);
    case 'echec':       return t('SMS non livré', 'echec', false);
    case 'echec_envoi': return t('SMS jamais parti', 'echec', false);
    default:            return t('SMS : ' + r.sms_statut, 'encours', false);
  }
}

/**
 * Le MAIL.
 *
 * ⚠️⚠️ « RETIRÉ À CETTE ÉTAPE » ET « PAS D'ADRESSE » SONT DEUX CHOSES DIFFÉRENTES, et les
 * confondre ferait passer une DÉCISION du client pour une panne. Le mail a été retiré du
 * parcours à partir du J+7 (`mailDansLeRail`) : à ces étapes, son absence est voulue.
 * C'est la même distinction que `hors_rail` / `non_applicable` dans le rapport de
 * l'envoi manuel.
 */
export function canalMail(r: Relance, rail: Rail, entree: string | null): EtatCanal {
  if (!mailDansLeRail(rail)) return SANS_OBJET('Mail retiré à cette étape');
  if (!r.email) return SANS_OBJET('Pas d’adresse');
  if (!r.email_statut || !depuisEntree(r.email_le, entree)) {
    return { texte: 'Pas de mail', ton: 'attente', tente: false, abouti: false, horsPerimetre: false };
  }
  const t = (texte: string, ton: Ton, abouti: boolean): EtatCanal =>
    ({ texte, ton, tente: true, abouti, horsPerimetre: false });
  switch (r.email_statut) {
    case 'clique':      return t('Mail cliqué', 'fort', true);
    case 'ouvert':      return t('Mail ouvert', 'ok', true);
    case 'livre':       return t('Mail livré', 'ok', true);
    case 'envoye':      return t('Mail envoyé, livraison non confirmée', 'encours', false);
    case 'echec':       return t('Mail non livré', 'echec', false);
    case 'echec_envoi': return t('Mail jamais parti', 'echec', false);
    default:            return t('Mail : ' + r.email_statut, 'encours', false);
  }
}

/** Ce que la colonne « Action à réaliser » affiche, et avec quelle gravité. */
export type GraviteAction = 'ok' | 'attente' | 'alerte' | 'neutre';
export interface ActionDossier {
  /** Identifiant stable, pour compter et pour éprouver — jamais affiché. */
  code: 'verifier' | 'jointe' | 'week-end' | 'pause' | 'en-cours'
      | 'quota' | 'rien-tente' | 'reprise' | 'reprise-passee' | 'fin-parcours';
  texte: string;
  gravite: GraviteAction;
  /**
   * La vérification ORTHOP, qui lève le drapeau déclaratif. Les autres gestes (« Traiter »)
   * se déduisent de `demandeUnGeste()`, pas de ce champ.
   */
  bouton?: 'verifier';
}

/**
 * La prochaine étape qui APPELLERA VRAIMENT — pas simplement la suivante du parcours.
 *
 * ⚠️⚠️ `etapeSuivante()` rend l'étape suivante par son écart, qu'elle soit branchée ou
 * non. Or J+14 et au-delà n'ont **ni agent ni cron** : annoncer « reprise automatique à
 * l'étape J+14 » pour un dossier resté sans contact au J+7 serait une promesse que rien
 * ne tient, et la patiente attendrait indéfiniment. C'est exactement le piège déjà payé
 * sur le filtre « Appelable » — sans le test `actif`, il proposait 638 dossiers au lieu
 * de 312, dont le travail d'étapes que personne n'exécute.
 *
 * ⚠️ `actif` est lu dans la définition du rail, jamais recopié : le jour où une étape
 * ouvre, elle entre d'elle-même dans cette réponse.
 */
export function prochaineEtapeAutomatique(rail: Rail): Rail | null {
  let x: Rail | null = rail;
  while ((x = etapeSuivante(x))) if (x.actif) return x;
  return null;
}

export interface ContexteJournee {
  estWeekEnd: boolean;
  enPause: boolean | null | undefined;
  journeeEnCours: boolean;
}

/**
 * ── QUELLE ACTION RÉALISER ────────────────────────────────────────────────────
 *
 * Un escalier de conditions, **première atteinte gagne** — exactement comme le `CASE` SQL
 * de `EL - Rail Test` : on veut la PREMIÈRE raison, celle qui explique la situation.
 * Réordonner ces branches change ce que la lectrice voit.
 *
 * ⚠️ « Rien à faire » est une réponse à part entière, et c'est même la plus fréquente : la
 * plupart des dossiers sont pris en charge par le parcours, qui les reprendra tout seul à
 * l'étape suivante. Écrire « à traiter » partout ferait de cet écran une liste de corvées
 * imaginaires, et on cesserait de la lire.
 *
 * ⚠️ Le quota passe AVANT la reprise automatique : au-delà de 5 tentatives, aucun cron ne
 * rappellera cette patiente, à aucune étape. Annoncer une reprise serait un mensonge.
 */
export function actionDuDossier(
  r: Relance, rail: Rail, jointe: boolean, rienTente: boolean, ctx: ContexteJournee,
  auj: string = aujourdhuiIso(),
): ActionDossier {
  if (r.ordonnance_deja_envoyee) {
    return {
      code: 'verifier', bouton: 'verifier', gravite: 'attente',
      texte: 'Elle dit avoir déjà envoyé son ordonnance',
    };
  }
  if (jointe) return { code: 'jointe', texte: 'Rien à faire — elle a été jointe', gravite: 'ok' };

  if (ctx.estWeekEnd) {
    return { code: 'week-end', texte: 'Reportée à lundi — aucun envoi le week-end', gravite: 'neutre' };
  }
  if (ctx.enPause === true) {
    return { code: 'pause', texte: 'Module en pause — reprise à la levée', gravite: 'neutre' };
  }
  if (ctx.journeeEnCours) {
    return { code: 'en-cours', texte: 'Journée en cours — les appels passent jusqu’à 13h55', gravite: 'neutre' };
  }

  if (quotaEpuise(r)) {
    return {
      code: 'quota', gravite: 'alerte',
      texte: PLAFOND_TENTATIVES + ' tentatives épuisées — à reprendre à la main dans « Relances »',
    };
  }
  if (rienTente) {
    return { code: 'rien-tente', texte: 'Rien n’a été tenté — à signaler', gravite: 'alerte' };
  }

  const suivante = prochaineEtapeAutomatique(rail);
  if (suivante && r.date_echeance) {
    const quand = decalerJours(r.date_echeance, ecartEcheance(suivante));
    // ⚠️ Sur une journée ANCIENNE, le rendez-vous annoncé peut être déjà passé. Écrire
    // « reprise le 15/09 » un 21/09 laisserait croire que c'est fait — alors que c'est
    // justement la journée qu'il reste à contrôler.
    if (quand < auj) {
      return {
        code: 'reprise-passee', gravite: 'attente',
        texte: 'Devait être reprise à l’étape ' + suivante.libelle + ' le ' + formatDate(quand)
          + ' — à contrôler sur cette journée-là',
      };
    }
    return {
      code: 'reprise', gravite: 'attente',
      texte: 'Reprise automatique à l’étape ' + suivante.libelle + ', le ' + formatDate(quand),
    };
  }
  return {
    code: 'fin-parcours', gravite: 'alerte',
    texte: 'Plus aucune étape automatique — à reprendre à la main dans « Relances »',
  };
}

/**
 * ── L'ORDRE DES LIGNES : CE QU'IL Y A À FAIRE D'ABORD ─────────────────────────
 *
 * Sans ce classement, les lignes sortent dans l'ordre de la base : une journée de 180
 * patientes oblige à la faire défiler en entier pour trouver les trois qui demandent
 * quelque chose. Demande du client, 2026-09-21.
 *
 * ⚠️ L'ordre suit les CODES d'action, pas la gravité : « Vérifier » est rangé en tête
 * alors que sa gravité est `attente`, parce que la patiente est SILENCIÉE tant que
 * personne ne vérifie. Un tri sur la gravité l'aurait noyé au milieu des reprises
 * automatiques.
 *
 * ⚠️ Un code absent de cette table prend le rang 99 : il descend en bas plutôt que de
 * remonter par accident. Une action nouvelle qu'on aurait oublié de classer ne doit pas
 * se retrouver en tête de la liste des choses à faire.
 */
const RANG_ACTION: Record<ActionDossier['code'], number> = {
  verifier: 0,        // silenciée tant que personne ne vérifie
  'rien-tente': 1,    // personne n'a rien essayé — le cas grave
  quota: 2,           // 5 tentatives, le parcours ne la reprendra plus
  'fin-parcours': 3,  // sortie sans avoir été jointe
  'reprise-passee': 4,// un rendez-vous déjà passé, à contrôler sur sa journée
  reprise: 5,         // le parcours s'en charge
  'en-cours': 6,      // la journée n'est pas finie
  pause: 7,
  'week-end': 8,
  jointe: 9,          // rien à faire
};

/**
 * Une ligne TRAITÉE descend sous tout ce qui reste à faire, juste au-dessus des jointes :
 * elle est réglée, mais c'est encore elle qu'on cherche des yeux juste après l'avoir
 * traitée.
 */
const RANG_TRAITEE = 8.5;

export function rangAction(b: Bilan, traitee = false): number {
  if (traitee) return RANG_TRAITEE;
  const r = RANG_ACTION[b.action.code];
  return r === undefined ? 99 : r;
}

/**
 * Trie une journée : d'abord ce qui demande une action, ensuite le reste.
 *
 * ⚠️ `sort` de JavaScript est STABLE depuis ES2019 : à rang égal, l'ordre d'origine est
 * conservé. On ne réinvente donc pas un second critère qui divergerait de celui de
 * l'API — et deux lectures de la même journée donnent la même liste.
 *
 * `traitees` : les dossiers déjà traités par l'équipe CE JOUR-LÀ (clé = `relance.id`).
 */
export function parOrdreDAction(bilans: Bilan[], traitees?: ReadonlyMap<number, unknown>): Bilan[] {
  const rang = (b: Bilan) => rangAction(b, Boolean(traitees?.has(b.r.id)));
  return [...bilans].sort((a, b) => rang(a) - rang(b));
}

/**
 * ── CE QUI APPELLE UN GESTE DE L'ÉQUIPE (2026-09-23) ────────────────────────────
 *
 * Demande du client, au sortir d'une réunion : *« pour ceux qui ne sont pas vert, mettre
 * un bouton d'action, qu'on puisse voir traité par + nom de celui qui a traité, avec un
 * commentaire, et ensuite ça doit passer au vert »*.
 *
 * ⚠️⚠️ LES LIGNES GRISES (« En attente ») N'ONT PAS DE BOUTON, et c'est délibéré. Elles
 * ne sont grises QUE lorsque le contexte explique tout : week-end, module en pause, ou
 * journée pas encore finie. Les « traiter » à 10h du matin les passerait au vert AVANT
 * que les appels de 12h30 aient eu lieu — et si ces appels échouaient, la ligne resterait
 * verte sur un manquement réel. Un vert posé trop tôt est pire qu'un gris.
 *
 * ⚠️ « Vérifier » (la patiente dit avoir envoyé) est un geste MÊME sur une ligne jointe :
 * elle a parlé, c'est justement pendant cet appel qu'elle l'a dit.
 */
export function demandeUnGeste(b: Bilan): boolean {
  if (b.action.code === 'verifier') return true;
  if (b.jointe) return false;
  return b.action.gravite === 'alerte' || b.action.gravite === 'attente';
}

/**
 * Le DERNIER traitement de chaque dossier, parmi ceux d'une journée.
 *
 * ⚠️ Départagé par l'`id`, pas par l'horodatage : deux gestes posés dans la même requête
 * portent le même `NOW()`, et l'`id` croît avec l'insertion.
 */
export function dernierTraitementParDossier<T extends { id: number; relance_id: number }>(ts: T[]): Map<number, T> {
  const m = new Map<number, T>();
  for (const t of ts) {
    const p = m.get(t.relance_id);
    if (!p || t.id > p.id) m.set(t.relance_id, t);
  }
  return m;
}

/** Un dossier vu à travers son étape : tout ce qu'une ligne du tableau affiche. */
export interface Bilan {
  r: Relance;
  jointe: boolean;
  rienTente: boolean;
  appel: EtatCanal;
  sms: EtatCanal;
  mail: EtatCanal;
  action: ActionDossier;
}

/** LE BILAN D'UN DOSSIER SUR SON ÉTAPE — le point d'entrée de l'écran, et des contrôles. */
export function bilanDossier(r: Relance, rail: Rail, jour: string, ctx: ContexteJournee): Bilan {
  const entree = entreeDansLeRail(r, rail);
  const appel = canalAppel(r, entree);
  const sms = canalSms(r, entree);
  const mail = canalMail(r, rail, entree);
  // ⚠️⚠️ `jointe` vient des HELPERS CANONIQUES, jamais des trois puces ci-dessus. Les
  // puces DÉCRIVENT, elles ne jugent pas : deux façons de répondre à « a-t-elle été
  // jointe ? » finiraient par diverger, et c'est le défaut que ce projet paie le plus cher.
  const jointe = estJointe(r, rail, jour);
  const rienTente = !appel.tente && !sms.tente && !mail.tente;
  return { r, jointe, rienTente, appel, sms, mail, action: actionDuDossier(r, rail, jointe, rienTente, ctx) };
}
