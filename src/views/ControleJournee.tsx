import { useState, useMemo, useEffect, useCallback, type ReactNode } from 'react';
import {
  CheckCircle, AlertTriangle, CalendarDays, PauseCircle, Clock, BookOpen, UserCheck, History,
  Phone, MessageSquare, Mail, ShieldCheck, ChevronRight, ChevronDown, ClipboardCheck,
} from 'lucide-react';
import type { Relance } from '../types';
import { Chip, DataTable, tdStyle, tdDiscret, TranscriptPanel, BoutonTranscript, SearchInput } from '../ui';
import {
  RAILS_RELANCES, lignesDuRail, jointVoixDansLeRail, jointParEcritDansLeRail,
  railAtteint, estSortie, couverteAujourdhui, PLAFOND_TENTATIVES, type Rail,
} from '../lib/rails';
// ⚠️ Le JUGEMENT vit dans `src/lib/controle.ts`, pas ici : c'est ce qui permet de
// l'éprouver sur les vraies données sans charger React. Cette vue ne fait que DESSINER
// ce qu'il rend — elle ne rejuge rien.
import {
  bilanDossier, parOrdreDAction, rangAction, rangeeDeLaLigne, dernierTraitementParDossier,
  type Bilan, type ContexteJournee, type GraviteAction, type EtatCanal, type ActionDossier,
} from '../lib/controle';
import { traiterLigne, traitementsDuJour, type Traitement } from '../lib/controleApi';
import { rechercherPatientes } from '../lib/parcours';
import { ParcoursPatiente } from './ParcoursPatiente';
import {
  aujourdhuiIso, decalerJours, jourLocal, jourSemaineIso, formatDate, formatDateLongue, formatDateTime,
} from '../lib/format';

/**
 * La fenêtre pendant laquelle les automates travaillent, heure de Paris.
 *
 * ⚠️ Les appels passent de 12h30 à 13h55, puis le repli SMS/mail et le compte rendu à
 * 14h30. Contrôler la journée EN COURS avant ce terme montre donc forcément tout le monde
 * comme non joint — ce n'est pas un manquement, c'est un contrôle prématuré.
 */
const FIN_FENETRE_HHMM = 1430;
function hhmmParis(): number {
  const h = new Date().toLocaleTimeString('fr-FR', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return Number(h.slice(0, 2)) * 100 + Number(h.slice(3, 5));
}

/**
 * CONTRÔLER UNE JOURNÉE — l'écran de vérification du recouvrement.
 *
 * ⚠️⚠️ UNE FILE DE TRAVAIL D'ABORD, LA JOURNÉE ENSUITE (refonte du 2026-09-23, maquette
 * validée par le client). L'écran empilait la recherche, la journée, le verdict, le
 * tableau par étape, deux onglets et six filtres AVANT la première ligne à traiter — et une
 * journée type en compte 3 sur 73. L'équipe vient savoir ce qu'il lui reste à faire :
 *
 *   1. une barre     → la journée, la recherche, le mode d'emploi
 *   2. « À faire »   → ce qui attend un geste, avec la progression ; à zéro, « Journée
 *                      contrôlée ». Les déclarations « Dit avoir envoyé » y sont AUSSI —
 *                      un onglet séparé, avec son compteur gris, se laissait oublier
 *   3. le reste      → les patientes jointes et les chiffres par étape, repliés, à un clic
 *
 * ⚠️ La demande du 2026-09-21 tient toujours — « montrer tous ceux qui ont été appelés » :
 * la file + le reste de la journée font TOUTE la journée. Rien n'est retiré, c'est rangé.
 *
 * ⚠️⚠️ AUCUN CONTACT SORTANT ICI — rien qui atteigne une patiente. Demande du client
 * (2026-09-17) : « ils n'auront pas besoin de lancer des appels ou d'envoyer des SMS, ils
 * vont juste contrôler ce qui s'est passé ». « Traiter » et « Vérifier » ne CONTACTENT
 * personne : ils CONSIGNENT ce que l'équipe a fait, qui et quand (2026-09-23).
 *
 * ⚠️ Le nom de celle qui traite vient du JETON, côté serveur — jamais du navigateur.
 */
const COULEUR_ACTION: Record<GraviteAction, string> = {
  ok: '#15803d', attente: '#92400e', alerte: '#b91c1c', neutre: 'var(--muted)',
};

/**
 * Ce que l'écran demandait au moment du geste, pour la ligne « Déjà traitées ».
 *
 * ⚠️ Lu dans `action_code`, ce que le SERVEUR a enregistré — et non recalculé : entre-temps
 * la ligne a pu devenir jointe (un SMS livré dans la nuit), et la consigne d'aujourd'hui ne
 * dirait plus ce qu'on a traité.
 */
const LIB_GESTE: Partial<Record<ActionDossier['code'], string>> = {
  'rien-tente': 'Rien n’avait été tenté',
  quota: PLAFOND_TENTATIVES + ' tentatives épuisées',
  'fin-parcours': 'Plus aucune étape automatique',
  'reprise-passee': 'Reprise prévue, date déjà passée',
  reprise: 'Reprise automatique prévue',
  verifier: 'Disait avoir déjà envoyé son ordonnance',
};

/**
 * L'étiquette d'une étape. Un badge plutôt qu'un simple titre : c'est ce qui rend les
 * lignes de plusieurs étapes distinguables d'un coup d'œil, maintenant qu'elles sont dans
 * la même file.
 */
function BadgeRail({ rail }: { rail: Rail | null }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap',
      fontFamily: 'Lexend,sans-serif', fontSize: 11.5, fontWeight: 800,
      background: rail ? 'var(--blue-faint)' : 'var(--st-neutre-bg)',
      color: rail ? 'var(--blue)' : 'var(--muted)',
      border: '1px solid ' + (rail ? 'var(--blue-mid)' : 'var(--border)'),
    }}>{rail ? rail.libelle : 'hors étape'}</span>
  );
}

/**
 * ROUGE = action requise · VERT = rien à faire. La lecture demandée par le client.
 *
 * ⚠️⚠️ ELLE SE TAIT QUAND LE CONTEXTE EXPLIQUE TOUT. Un week-end, une pause, ou une
 * journée qui n'a pas encore atteint 12h30 : la patiente n'a rien reçu, et c'est
 * parfaitement normal. Le juge est `action.gravite` : les trois cas neutres sont
 * exactement ceux que l'escalier de `actionDuDossier` range en `neutre`.
 */
function PastilleEtat({ b }: { b: Bilan }) {
  if (b.jointe) return <Chip texte="Jointe" ton="ok" titre="Quelque chose lui est parvenu à cette étape" />;
  if (b.action.gravite === 'neutre') return <Chip texte="En attente" ton="neutre" titre={b.action.texte} />;
  if (b.rienTente) {
    return <Chip texte="Rien tenté" ton="echec" titre="Ni appel, ni SMS, ni mail depuis l’entrée dans cette étape" />;
  }
  return <Chip texte="Sans contact" ton="attente" titre="On a essayé, mais rien ne lui est parvenu" />;
}

/**
 * Un canal, en une puce : l'icône dit LEQUEL, le mot dit OÙ il en est.
 *
 * ⚠️ Jamais la couleur seule : l'icône nomme le canal, le mot nomme l'état, et la phrase
 * complète reste au survol et pour les lecteurs d'écran (`lecteur`).
 */
const ICONE_CANAL = { appel: Phone, sms: MessageSquare, mail: Mail } as const;
const NOM_CANAL = { appel: 'Appel', sms: 'SMS', mail: 'Mail' } as const;
function PuceCanal({ canal, e }: { canal: keyof typeof ICONE_CANAL; e: EtatCanal }) {
  const Icone = ICONE_CANAL[canal];
  const phrase = NOM_CANAL[canal] + ' : ' + e.texte;
  return <Chip texte={e.court} ton={e.ton} titre={phrase} lecteur={phrase} icone={<Icone size={11} />} />;
}

/**
 * LE FORMULAIRE DE TRAITEMENT — un commentaire facultatif, et le bouton qui valide.
 *
 * ⚠️ C'est un VRAI composant, déclaré hors de la vue, avec son propre état : défini à
 * l'intérieur, React le recréerait à chaque frappe (nouveau type de composant à chaque
 * rendu) et la zone de texte perdrait le focus après chaque lettre.
 *
 * ⚠️ En mode « vérifier », les deux réponses ORTHOP SONT les boutons de validation : il
 * n'y a pas d'étape de plus, et on ne peut pas valider sans avoir dit ce qu'on a vu.
 */
function FormGeste({ mode, onValider, onAnnuler }: {
  mode: 'traiter' | 'verifier';
  onValider: (commentaire: string, verif?: 'recue' | 'pas_recue') => Promise<string | null>;
  onAnnuler: () => void;
}) {
  const [commentaire, setCommentaire] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const valider = async (verif?: 'recue' | 'pas_recue') => {
    setEnvoi(true); setErreur(null);
    const e = await onValider(commentaire, verif);
    // En cas de succès le formulaire disparaît : le parent le referme. On ne touche plus
    // à l'état d'un composant démonté.
    if (e) { setErreur(e); setEnvoi(false); }
  };
  const bouton = (texte: string, couleur: string, fond: string, action: () => void) => (
    <button
      onClick={action} disabled={envoi}
      style={{
        padding: '0 13px', minHeight: 32, borderRadius: 'var(--r-md)', fontFamily: 'Lexend,sans-serif',
        fontSize: 12, fontWeight: 700, border: '1px solid ' + couleur, background: fond, color: couleur,
        cursor: envoi ? 'not-allowed' : 'pointer', opacity: envoi ? 0.55 : 1,
      }}>{texte}</button>
  );
  return (
    <div className="ctl-form" style={{ padding: '10px 12px', borderRadius: 10, background: '#f8fafc', border: '1px solid var(--border)', maxWidth: 560 }}>
      {mode === 'verifier' && (
        <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--muted)' }}>
          Contrôlez dans ORTHOP, puis indiquez ce que vous y avez vu.
        </p>
      )}
      <textarea
        autoFocus value={commentaire} maxLength={1000} rows={2} disabled={envoi}
        onChange={e => setCommentaire(e.target.value)}
        placeholder="Commentaire (facultatif) — ce que vous avez fait ou constaté"
        aria-label="Commentaire (facultatif)"
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '7px 9px',
          borderRadius: 8, border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 12.5,
          color: 'var(--text)', background: 'white',
        }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 7 }}>
        {mode === 'verifier' ? (
          <>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Dans ORTHOP :</span>
            {bouton('Ordonnance reçue', '#047857', '#ecfdf5', () => valider('recue'))}
            {bouton('Pas encore reçue', '#b45309', '#fffbeb', () => valider('pas_recue'))}
          </>
        ) : bouton('Marquer comme traité', '#047857', '#ecfdf5', () => valider())}
        <button onClick={onAnnuler} disabled={envoi}
          style={{ border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '4px 6px' }}>
          Annuler
        </button>
        {envoi && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Enregistrement…</span>}
      </div>
      {erreur && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#b91c1c' }}>Non enregistré : {erreur}.</p>}
    </div>
  );
}

/** Un bandeau de contexte : ce qui explique qu'une journée paraisse vide. */
function Bandeau({ icone, fond, bord, couleur, children }: {
  icone: ReactNode; fond: string; bord: string; couleur: string; children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px',
                  background: fond, border: '1px solid ' + bord, borderRadius: 'var(--r-lg)',
                  marginBottom: 'var(--sp-3)' }}>
      <span style={{ color: couleur, flexShrink: 0, marginTop: 1, display: 'inline-flex' }}>{icone}</span>
      <p style={{ fontSize: 12.5, color: couleur === 'var(--muted)' ? 'var(--text)' : couleur, margin: 0, lineHeight: 1.55 }}>
        {children}
      </p>
    </div>
  );
}

/** L'en-tête d'un groupe de la file : un titre, un compte, une phrase d'aide. */
function EnteteGroupe({ titre, n, aide }: { titre: string; n: number; aide: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', padding: '9px var(--sp-4) 7px',
                  background: '#f8fafc', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--blue-faint)' }}>
      <span style={{ fontFamily: 'Lexend,sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '.5px',
                     textTransform: 'uppercase', color: 'var(--text-2)' }}>{titre}</span>
      <span style={{ fontFamily: 'Lexend,sans-serif', fontSize: 11, fontWeight: 800, padding: '0 7px', borderRadius: 999,
                     background: 'var(--st-neutre-bg)', border: '1px solid var(--st-neutre-bd)', color: 'var(--muted)' }}>{n}</span>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{aide}</span>
    </div>
  );
}

/** Une ligne déroulante de la carte « le reste de la journée ». */
function Deplier({ ouvert, onClick, titre, detail, droite }: {
  ouvert: boolean; onClick: () => void; titre: string; detail: string; droite?: ReactNode;
}) {
  return (
    <button onClick={onClick} aria-expanded={ouvert} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px var(--sp-4)',
      border: 'none', background: 'white', cursor: 'pointer', textAlign: 'left', color: 'var(--text)', fontFamily: 'inherit',
    }}>
      {/* Deux icônes plutôt qu'une rotation : l'état se lit même là où un `transform` ne
          s'applique pas (impression, captures du mode opératoire). */}
      {ouvert
        ? <ChevronDown size={15} style={{ color: 'var(--muted)' }} />
        : <ChevronRight size={15} style={{ color: 'var(--muted)' }} />}
      <span style={{ fontFamily: 'Lexend,sans-serif', fontSize: 13, fontWeight: 700 }}>{titre}</span>
      <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{detail}</span>
      {droite && <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>{droite}</span>}
    </button>
  );
}

const pluriel = (n: number, un: string, plusieurs: string) => (n > 1 ? plusieurs : un);

export function ControleJournee({ relances, enPause, motifPause, token, onRelanceMaj }: {
  relances: Relance[];
  /**
   * Le module est-il en pause ? `null` = on n'a pas pu lire l'interrupteur.
   *
   * ⚠️ Sans cette information, « rien n'a été tenté » envoie chercher une panne là où il y
   * a une DÉCISION. La lecture est fermante ailleurs dans le dashboard ; ici elle n'est
   * qu'informative, donc `null` se contente de ne rien affirmer.
   */
  enPause?: boolean | null;
  motifPause?: string | null;
  token: string;
  /**
   * Met à jour UNE ligne de la liste du parent — après une vérification ORTHOP, qui lève
   * la déclaration et complète les notes. Le parent garde la liste ; cette vue ne fait
   * que lui dire ce que le serveur a écrit.
   */
  onRelanceMaj: (id: number, patch: Partial<Relance>) => void;
}) {
  /**
   * Le dossier dont on lit le transcript.
   *
   * ⚠️ LIRE N'EST PAS CONTACTER : le panneau n'appelle personne, n'envoie rien, et
   * n'écrit pas en base.
   */
  const [transcrit, setTranscrit] = useState<Relance | null>(null);
  const ajd = aujourdhuiIso();
  const [jour, setJour] = useState(ajd);
  const hier = decalerJours(ajd, -1);
  /** La ligne dont le formulaire de traitement est ouvert (une seule à la fois). */
  const [formOuvert, setFormOuvert] = useState<number | null>(null);
  const [resteOuvert, setResteOuvert] = useState(false);
  const [chiffresOuverts, setChiffresOuverts] = useState(false);
  /**
   * Les gestes déjà posés, le dernier par dossier — et LA JOURNÉE à laquelle ils
   * appartiennent. Tant que la lecture de la journée affichée n'est pas revenue, on est
   * « en chargement » : c'est déduit, pas posé, donc impossible d'afficher les traitements
   * d'hier sur la journée d'aujourd'hui pendant l'aller-retour.
   */
  const [lus, setLus] = useState<{ jour: string; etat: 'ok' | 'erreur'; map: Map<number, Traitement> } | null>(null);
  const [recherche, setRecherche] = useState('');
  const [parcours, setParcours] = useState<{ ids: number[]; nom: string } | null>(null);
  // Stable : le panneau s'abonne à Échap avec, et le parent se redessine toutes les 30 s.
  const fermerParcours = useCallback(() => setParcours(null), []);

  /**
   * ⚠️⚠️ UN TRAITEMENT APPARTIENT À UNE JOURNÉE CONTRÔLÉE, pas à une patiente pour toujours.
   * Une même patiente revient à l'étape suivante une semaine plus tard : ce qu'on a traité
   * au J+1 ne dit rien du J+7. On recharge donc à chaque changement de jour.
   *
   * ⚠️ Si la lecture échoue, on le DIT : sans traitements, toutes les lignes traitées
   * redeviendraient à faire et l'équipe les retraiterait.
   */
  useEffect(() => {
    let vivant = true;
    traitementsDuJour(token, jour).then(r => {
      if (!vivant) return;
      setLus(r.ok
        ? { jour, etat: 'ok', map: dernierTraitementParDossier(r.data) }
        : { jour, etat: 'erreur', map: new Map() });
    });
    return () => { vivant = false; };
  }, [token, jour]);
  const etatTraitements: 'chargement' | 'ok' | 'erreur' = lus && lus.jour === jour ? lus.etat : 'chargement';
  const traitements = useMemo(
    () => (lus && lus.jour === jour ? lus.map : new Map<number, Traitement>()), [lus, jour]);
  /** Changer de journée referme tout formulaire ouvert : il visait une autre journée. */
  const choisirJour = (j: string) => { setJour(j); setFormOuvert(null); };

  /**
   * ⚠️⚠️ LE WEEK-END N'EST PAS UN MANQUEMENT (2026-09-18). Les crons d'appel ne tournent
   * que du lundi au vendredi. On ne masque rien : seul le verdict cesse d'alerter.
   */
  const estWeekEnd = jourSemaineIso(jour) >= 6;
  const journeeEnCours = jour === ajd && hhmmParis() < FIN_FENETRE_HHMM;

  /**
   * Un bilan par patiente, groupé par étape, pour la journée choisie.
   *
   * ⚠️ `lignesDuRail` porte déjà les deux exclusions qui comptent : les ordonnances REÇUES
   * et les patientes COUVERTES par une ordonnance en cours.
   *
   * ⚠️ Toutes les fonctions prennent `jour` en paramètre — c'est ce qui rend l'écran
   * capable de regarder hier. Aucune date n'est recalculée ici.
   */
  const parEtape = useMemo(() => RAILS_RELANCES.map(rail => {
    const ctx: ContexteJournee = { estWeekEnd, enPause, journeeEnCours };
    // ⚠️ Le tri ne change AUCUN compteur : l'ordre n'entre dans aucun total.
    const bilans = parOrdreDAction(
      lignesDuRail(relances, rail, 'jour', jour).map(r => bilanDossier(r, rail, jour, ctx)), traitements);
    return {
      rail,
      bilans,
      surEtape: bilans.length,
      jointes: bilans.filter(b => b.jointe).length,
      voix: bilans.filter(b => jointVoixDansLeRail(b.r, rail, jour)).length,
      ecrit: bilans.filter(b => jointParEcritDansLeRail(b.r, rail, jour)).length,
      manques: bilans.filter(b => !b.jointe).length,
      // Le sous-ensemble alarmant : personne n'a rien tenté, sur aucun canal.
      jamaisTente: bilans.filter(b => !b.jointe && b.rienTente).length,
      // ⚠️ Les déclarations sont comptées À PART (elles ne dépendent pas de la journée) :
      // ici, seulement les lignes que la file range sous « Sur la journée ».
      aTraiter: bilans.filter(b => rangeeDeLaLigne(b, traitements.has(b.r.id)) === 'a-traiter').length,
    };
  }), [relances, jour, estWeekEnd, enPause, journeeEnCours, traitements]);

  /**
   * LES PATIENTES QUI DISENT AVOIR ENVOYÉ LEUR ORDONNANCE, et que personne n'a encore
   * vérifiées.
   *
   * ⚠️⚠️ CETTE LISTE N’EST PAS BORNÉE À LA JOURNÉE, et c’est délibéré (arbitrage client
   * du 2026-09-17, reconfirmé le 21/09). Le drapeau est COLLANT : seule la vérification
   * le lève, et tant qu'il est posé la patiente n'est plus appelée. C’est une file
   * d’attente, pas un événement du jour.
   *
   * ⚠️ On écarte celles dont l’ordonnance est ARRIVÉE (`estSortie`) : leur déclaration
   * est confirmée par ORTHOP, il n’y a plus rien à vérifier.
   *
   * ⚠️ Classées par la dernière étape DÉPASSÉE (`railAtteint`), la plus avancée d'abord :
   * c'est la plus ancienne des déclarations, celle qui est silenciée depuis le plus longtemps.
   */
  const declares = useMemo(() => relances
    .filter(r => r.ordonnance_deja_envoyee && !estSortie(r))
    .map(r => ({ r, rail: railAtteint(r, jour) }))
    .sort((a, b) => (b.rail?.jour ?? 0) - (a.rail?.jour ?? 0)), [relances, jour]);

  /** La recherche porte sur TOUT le stock chargé, pas sur la journée : c'est la demande. */
  const trouvees = useMemo(() => rechercherPatientes(relances, recherche), [relances, recherche]);

  /**
   * ⚠️⚠️ LE VERDICT NE COMPTE QUE LES ÉTAPES EN SERVICE. Les étapes J+14 et au-delà n'ont
   * ni agent ni cron : *tous* leurs dossiers sont « sans aucun contact » par construction.
   */
  const enService = parEtape.filter(e => e.rail.actif);
  const aVenir = parEtape.filter(e => !e.rail.actif && e.surEtape > 0);
  const totalDu = enService.reduce((n, e) => n + e.surEtape, 0);
  const totalJointes = enService.reduce((n, e) => n + e.jointes, 0);
  const totalManques = enService.reduce((n, e) => n + e.manques, 0);
  const totalJamaisTente = enService.reduce((n, e) => n + e.jamaisTente, 0);
  /**
   * ⚠️⚠️ TROIS RAISONS PARFAITEMENT NORMALES DE N'AVOIR JOINT PERSONNE, et aucune n'est un
   * manquement : le week-end, une pause décidée, et une journée qui n'a pas encore atteint
   * 12h30. Elles ÉTEIGNENT L'ALARME — mais pas les déclarations, qui ne dépendent pas de
   * la journée et restent à vérifier même un dimanche.
   */
  const contexteExplique = estWeekEnd || enPause === true || journeeEnCours;

  /**
   * LA FILE « À FAIRE », en trois groupes.
   *
   * ⚠️ Une ligne de la journée qui porte la déclaration (`verifier`) n'est PAS dans le
   * premier groupe : elle est déjà dans le second, et la montrer deux fois ferait compter
   * deux gestes pour une seule vérification.
   *
   * ⚠️ « Déjà traitées » se lit dans les TRAITEMENTS de la journée, pas dans les lignes du
   * jour : une déclaration vérifiée quitte la liste des déclarations (le drapeau est levé),
   * et c'est ici qu'on la retrouve, avec le nom de celle qui l'a vérifiée.
   */
  const pendants = enService
    .flatMap(e => e.bilans
      .filter(b => rangeeDeLaLigne(b, traitements.has(b.r.id)) === 'a-traiter')
      .map(b => ({ b, rail: e.rail })))
    // ⚠️ `sort` est stable : à rang égal, l'ordre des étapes est conservé.
    .sort((x, y) => rangAction(x.b) - rangAction(y.b));
  const parId = useMemo(() => new Map(relances.map(r => [r.id, r])), [relances]);
  const faites = useMemo(() => [...traitements.values()]
    .map(t => ({ t, r: parId.get(t.relance_id) }))
    // Un dossier purgé (RGPD) entre-temps n'a plus rien à afficher.
    .filter((x): x is { t: Traitement; r: Relance } => Boolean(x.r))
    .sort((a, b) => b.t.id - a.t.id), [traitements, parId]);
  const restant = pendants.length + declares.length;
  const totalFile = restant + faites.length;
  const pct = totalFile ? Math.round(faites.length / totalFile * 100) : 0;

  /**
   * Le reste de la journée : ce qui n'attend rien — jointes, et lignes en attente.
   * ⚠️ File + reste = toute la journée, sans doublon : `rangeeDeLaLigne` en décide seule.
   */
  const reste = enService.flatMap(e => e.bilans
    .filter(b => rangeeDeLaLigne(b, traitements.has(b.r.id)) === 'reste')
    .map(b => ({ b, rail: e.rail })));
  const resteJointes = reste.filter(x => x.b.jointe).length;

  /**
   * Consigner un geste. Renvoie un message d'erreur, ou `null` si c'est enregistré.
   *
   * ⚠️ La ligne ne passe en « Déjà traitées » QU'APRÈS la réponse du serveur, avec ce qu'il
   * a écrit (son nom, son heure). L'afficher avant, c'est risquer un vert que la base ne
   * connaît pas — et que plus personne ne retraitera.
   */
  const consigner = useCallback(async (
    r: Relance, rail: Rail | null, actionCode: string | null,
    commentaire: string, verif?: 'recue' | 'pas_recue',
  ): Promise<string | null> => {
    const res = await traiterLigne(token, {
      relance_id: r.id, jour, etape: rail ? rail.code : null, action_code: actionCode,
      commentaire, verif_orthop: verif,
    });
    if (!res.ok) return res.erreur;
    setLus(prev => prev && prev.jour === jour
      ? { ...prev, map: new Map(prev.map).set(r.id, res.data.traitement) }
      : { jour, etat: 'ok', map: new Map([[r.id, res.data.traitement]]) });
    if (res.data.declaration_levee) {
      onRelanceMaj(r.id, { ordonnance_deja_envoyee: false, notes: res.data.notes });
    }
    setFormOuvert(null);
    return null;
  }, [token, jour, onRelanceMaj]);

  /** Le bouton d'une ligne de la file. Grisé tant qu'un autre formulaire est ouvert. */
  const boutonGeste = (r: Relance, mode: 'traiter' | 'verifier') => {
    if (formOuvert === r.id) return null;
    const occupe = formOuvert !== null || etatTraitements === 'chargement';
    const verif = mode === 'verifier';
    return (
      <button
        onClick={() => setFormOuvert(r.id)}
        disabled={occupe}
        title={verif
          ? 'Contrôlez dans ORTHOP, puis indiquez si l’ordonnance y est — le signalement sera retiré'
          : 'Consigner ce que vous avez fait : la ligne passera dans « Déjà traitées », avec votre nom'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 13px', minHeight: 32,
          borderRadius: 'var(--r-md)', fontFamily: 'Lexend,sans-serif', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
          border: '1px solid ' + (occupe ? 'var(--border)' : verif ? 'var(--st-attente-bd)' : '#a7f3d0'),
          background: 'white', color: occupe ? 'var(--muted)' : verif ? 'var(--st-attente-fg)' : '#047857',
          cursor: occupe ? 'not-allowed' : 'pointer',
        }}>
        {verif ? <ShieldCheck size={13} /> : <UserCheck size={13} />} {verif ? 'Vérifier' : 'Traiter'}
      </button>
    );
  };
  const formGeste = (r: Relance, rail: Rail | null, actionCode: string | null, mode: 'traiter' | 'verifier') =>
    formOuvert === r.id && (
      <FormGeste mode={mode} onAnnuler={() => setFormOuvert(null)}
        onValider={(c, v) => consigner(r, rail, actionCode, c, v)} />
    );

  const boutonJour = (val: string, texte: string) => (
    <button
      onClick={() => choisirJour(val)}
      style={{
        padding: '0 14px', minHeight: 32, borderRadius: 'var(--r-md)', fontFamily: 'Lexend,sans-serif',
        fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
        border: '1px solid ' + (jour === val ? 'var(--blue)' : 'var(--border)'),
        background: jour === val ? 'var(--blue)' : 'white',
        color: jour === val ? 'white' : 'var(--text)',
      }}>{texte}</button>
  );

  /** Le nom d'une patiente, cliquable : il ouvre tout son parcours. Dessous : numéro, fin. */
  const cellulePatiente = (r: Relance) => {
    const nom = [r.nom, r.prenom].filter(Boolean).join(' ');
    return (
      <div className="c-nom">
        <button
          onClick={() => setParcours({ ids: [r.id], nom })}
          title="Voir tout son parcours : appels, SMS, mails, gestes de l’équipe"
          style={{
            border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
            fontWeight: 700, color: 'var(--text)', fontSize: 13, fontFamily: 'inherit',
            textDecoration: 'underline', textDecorationColor: 'var(--border)', textUnderlineOffset: 3,
          }}>{nom || '—'}</button>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>
          {r.telephone || 'pas de téléphone'}
          {/* La FIN DE LOCATION, pas l'« applicable du » : c'est la date que la patiente
              connaît, et celle qu'annoncent les SMS. */}
          {/* Jour et mois seulement : la purge RGPD borne le stock à trois mois, l'année
              n'apprend rien et faisait passer la cellule sur deux lignes. */}
          {/* ⚠️ Le séparateur voyage AVEC la date, dans le même bloc insécable : sinon, sur
              une colonne étroite, la ligne du numéro se terminait par un « · » orphelin. */}
          {r.date_echeance && (
            <span style={{ whiteSpace: 'nowrap' }}> · fin de location {formatDate(decalerJours(r.date_echeance, -1)).slice(0, 5)}</span>
          )}
        </span>
      </div>
    );
  };

  /** CE QUI A ÉTÉ FAIT — les trois canaux côte à côte, tous datés DANS LE RAIL. */
  const celluleCanaux = (b: Bilan) => (
    <div className="c-canaux">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
        <PuceCanal canal="appel" e={b.appel} />
        {b.appel.tente && <BoutonTranscript relance={b.r} onOuvrir={setTranscrit} taille={22} />}
        <PuceCanal canal="sms" e={b.sms} />
        <PuceCanal canal="mail" e={b.mail} />
      </div>
      {b.r.dernier_appel && (
        <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
          dernier appel le {formatDate(jourLocal(b.r.dernier_appel))}
          {' · '}{b.r.nb_tentatives ?? 0}/{PLAFOND_TENTATIVES} tentatives
        </span>
      )}
    </div>
  );

  const celluleConsigne = (b: Bilan) => (
    <div className="c-consigne" style={{
      fontSize: 12.5, lineHeight: 1.45, color: COULEUR_ACTION[b.action.gravite],
      fontWeight: b.action.gravite === 'alerte' ? 700 : b.action.gravite === 'attente' ? 600 : 500,
    }}>{b.action.texte}</div>
  );

  /** Une ligne de la journée : à traiter (avec son bouton) ou du reste (sans). */
  const ligneJournee = ({ b, rail }: { b: Bilan; rail: Rail }, avecGeste: boolean) => (
    <div key={b.r.id} className="ctl-ligne">
      <div className="c-etape"><BadgeRail rail={rail} /></div>
      {cellulePatiente(b.r)}
      <div className="c-etat"><PastilleEtat b={b} /></div>
      {celluleCanaux(b)}
      {celluleConsigne(b)}
      <div className="ctl-act">{avecGeste && boutonGeste(b.r, 'traiter')}</div>
      {avecGeste && formGeste(b.r, rail, b.action.code, 'traiter')}
    </div>
  );

  /**
   * Une déclaration : ce que la patiente a dit, et ce qu'ORTHOP en dit.
   *
   * ⚠️ LE RECOUPEMENT EST LA CONSIGNE : la déclaration vient d'un modèle qui interprète un
   * transcript, ORTHOP est la preuve. « Couverte jusqu'au… » et « ORTHOP la réclame
   * toujours » n'appellent pas du tout la même suite.
   */
  const ligneDeclaration = ({ r, rail }: { r: Relance; rail: Rail | null }) => {
    const couverte = couverteAujourdhui(r, jour);
    return (
      <div key={r.id} className="ctl-ligne">
        <div className="c-etape"><BadgeRail rail={rail} /></div>
        {cellulePatiente(r)}
        <div className="c-etat"><Chip texte="Dit avoir envoyé" ton="attente" titre="Elle l’a dit pendant un appel" /></div>
        <div className="c-canaux">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 12.5, color: 'var(--text-2)' }}>
            {/* ⚠️ LE TRANSCRIPT COMPTE DOUBLE ICI : la déclaration « j'ai déjà envoyé » est
                produite par un MODÈLE qui interprète cet appel. */}
            <span>L’a dit au téléphone le <strong>{r.dernier_appel ? formatDate(jourLocal(r.dernier_appel)) : '—'}</strong></span>
            {r.dernier_appel && <BoutonTranscript relance={r} onOuvrir={setTranscrit} taille={22} />}
          </div>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            elle n’est plus appelée tant que personne n’a vérifié
          </span>
        </div>
        <div className="c-consigne" style={{ fontSize: 12.5, lineHeight: 1.45, fontWeight: 600,
                                             color: couverte ? '#15803d' : 'var(--st-attente-fg)' }}>
          {couverte
            ? <><ShieldCheck size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                Couverte jusqu’au {formatDate(String(r.fin_application).slice(0, 10))} dans ORTHOP — confirmez-le</>
            : 'ORTHOP la réclame toujours — contrôlez dans ORTHOP'}
        </div>
        <div className="ctl-act">{boutonGeste(r, 'verifier')}</div>
        {formGeste(r, rail, 'verifier', 'verifier')}
      </div>
    );
  };

  /** Ce qui a été consigné : qui, quand, la réponse ORTHOP, le commentaire, la consigne. */
  const ligneFaite = ({ t, r }: { t: Traitement; r: Relance }) => {
    const rail = RAILS_RELANCES.find(x => x.code === t.etape) ?? railAtteint(r, jour);
    const verbe = t.verif_orthop ? 'Vérifiée' : 'Traitée';
    const consigne = t.action_code ? LIB_GESTE[t.action_code as ActionDossier['code']] : undefined;
    return (
      <div key={t.id} className="ctl-ligne" style={{ background: '#fbfefc' }}>
        <div className="c-etape"><BadgeRail rail={rail} /></div>
        {cellulePatiente(r)}
        <div className="c-etat"><Chip texte={verbe} ton="ok" titre={verbe + ' par ' + t.traite_par + ' le ' + formatDateTime(t.traite_le)} /></div>
        <div className="c-canaux ctl-large" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12.5, fontWeight: 700, color: '#15803d' }}>
            <UserCheck size={13} /> {verbe} par {t.traite_par}
            <span style={{ fontWeight: 500, color: '#166534' }}>
              · {formatDateTime(t.traite_le)}
              {t.verif_orthop && <> · ORTHOP : {t.verif_orthop === 'recue' ? 'ordonnance reçue' : 'pas encore reçue'}</>}
            </span>
          </span>
          {t.commentaire && (
            <span style={{ fontSize: 12.5, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>« {t.commentaire} »</span>
          )}
          {consigne && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Consigne d’origine : {consigne}</span>}
        </div>
        <div className="ctl-act" />
      </div>
    );
  };

  /* ── Le titre de la file : ce qu'il reste, ou pourquoi il n'y a rien ─────────────── */
  const jourCourt = formatDateLongue(jour);
  const fini = restant === 0 && !contexteExplique && (totalDu > 0 || faites.length > 0);
  const tonFile: 'attente' | 'ok' | 'neutre' = restant > 0 ? 'attente' : fini ? 'ok' : 'neutre';
  const titreFile = restant > 0
    ? (pendants.length > 0
        ? `${restant} ${pluriel(restant, 'ligne', 'lignes')} à traiter`
        : `${restant} ${pluriel(restant, 'déclaration', 'déclarations')} à vérifier`)
    : fini ? 'Journée contrôlée'
    : totalDu === 0 ? 'Rien à traiter'
    : estWeekEnd ? 'Rien à traiter — c’est le week-end'
    : enPause === true ? 'Rien à traiter — le module est en pause'
    : 'Rien à traiter pour l’instant';
  const sousFile = fini && faites.length > 0
    ? `Les ${faites.length} ${pluriel(faites.length, 'ligne qui le demandait a été traitée', 'lignes qui le demandaient ont été traitées')}`
    : fini ? `Les ${totalDu} patientes attendues ont toutes été jointes`
    : totalDu === 0 ? 'Aucune étape ne tombait ce jour-là : il est normal qu’une journée soit vide'
    : journeeEnCours ? 'Les lignes de la journée arriveront ici après 14h30'
    : estWeekEnd ? 'Les patientes attendues sont reportées à lundi'
    : null;

  return (
    <div>
      {/* ── 1. La barre : la journée, la recherche, le mode d'emploi ───────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px 12px', flexWrap: 'wrap',
        padding: '10px 14px', background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)', marginBottom: 'var(--sp-3)',
      }}>
        {boutonJour(ajd, 'Aujourd’hui')}
        {boutonJour(hier, 'Hier')}
        <input
          type="date" value={jour} max={ajd} aria-label="Choisir la journée contrôlée"
          onChange={e => { if (e.target.value) choisirJour(e.target.value); }}
          style={{
            padding: '0 9px', minHeight: 32, borderRadius: 'var(--r-md)', border: '1px solid var(--border)',
            fontSize: 12.5, fontFamily: 'inherit', color: 'var(--text)',
          }} />
        <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>{jourCourt}</span>
        {/* ⚠️ Cherche dans TOUT le stock chargé (trois mois, purge RGPD), pas dans la journée
            choisie : c'est ce que le client a demandé — « peu importe quand elle a été
            insérée dans le parcours ». */}
        <div style={{ flex: '1 1 260px', minWidth: 220 }}>
          <SearchInput
            valeur={recherche} onChange={setRecherche} largeur="100%"
            placeholder="Retrouver une patiente (tout le parcours) — nom, téléphone, e-mail" />
        </div>
        {/* ⚠️ Le mode opératoire est servi par nginx depuis `public/docs/` : un lien, pas
            un fichier à retrouver dans le dépôt. Chemin ABSOLU — l'application est une SPA,
            un chemin relatif dépendrait de la route affichée. */}
        <a
          href="/docs/mode-op-controle-journee.html" target="_blank" rel="noopener noreferrer"
          title="Comment contrôler la journée — document imprimable, s’ouvre dans un onglet"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none',
            padding: '0 11px', minHeight: 32, borderRadius: 'var(--r-md)', border: '1px solid var(--border)',
            background: 'white', color: 'var(--muted)', fontSize: 12, fontWeight: 600,
          }}>
          <BookOpen size={13} /> Mode d’emploi
        </a>
        {recherche.trim().length >= 2 && (
          <div style={{ width: '100%' }}>
            {trouvees.total === 0 ? (
              <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
                Aucune patiente ne correspond. Les dossiers de plus de trois mois sont effacés (RGPD).
              </p>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {trouvees.resultats.map(p => {
                    const r0 = p.lignes[0];
                    const rail = railAtteint(r0, ajd);
                    return (
                      <button key={p.cle}
                        onClick={() => setParcours({ ids: p.lignes.map(l => l.id), nom: p.nom })}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', textAlign: 'left',
                          padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)',
                          background: 'white', cursor: 'pointer', fontFamily: 'inherit',
                        }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', minWidth: 180 }}>{p.nom || '—'}</span>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{p.telephone || 'pas de téléphone'}</span>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                          fin de location {r0.date_echeance ? formatDate(decalerJours(r0.date_echeance, -1)) : '—'}
                          {rail ? ' · étape ' + rail.libelle : ''}
                          {p.lignes.length > 1 ? ' · ' + p.lignes.length + ' dossiers' : ''}
                        </span>
                        {estSortie(r0)
                          ? <Chip texte="Ordonnance reçue" ton="ok" />
                          : couverteAujourdhui(r0) ? <Chip texte="Couverte" ton="ok2" />
                          : r0.ordonnance_deja_envoyee ? <Chip texte="Dit avoir envoyé" ton="attente" /> : null}
                        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--blue)' }}>
                          <History size={13} /> Voir tout son parcours
                        </span>
                      </button>
                    );
                  })}
                </div>
                {trouvees.total > trouvees.resultats.length && (
                  <p style={{ margin: '7px 2px 0', fontSize: 12, color: 'var(--muted)' }}>
                    {trouvees.total} patientes correspondent — seules les {trouvees.resultats.length} plus récentes sont
                    affichées. Précisez la recherche (nom ET prénom, ou le numéro).
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ⚠️ Sans les traitements, toutes les lignes traitées redeviendraient à faire et
          l'équipe les retraiterait : l'échec de lecture se dit, et bloque les boutons. */}
      {etatTraitements === 'erreur' && (
        <Bandeau icone={<AlertTriangle size={16} />} fond="#fef2f2" bord="#fecaca" couleur="#991b1b">
          <strong>Les traitements déjà consignés n’ont pas pu être lus.</strong> Des lignes déjà
          traitées peuvent apparaître comme à faire. Rechargez la page avant de traiter quoi que ce soit.
        </Bandeau>
      )}

      {/* ⚠️ TROIS raisons parfaitement NORMALES de ne voir personne de joint. Les taire
          ferait passer une décision, un week-end, ou une heure trop matinale, pour une panne. */}
      {estWeekEnd && (
        <Bandeau icone={<CalendarDays size={16} />} fond="#f8fafc" bord="var(--border)" couleur="var(--muted)">
          <strong>C’est le week-end — aucun appel n’est prévu.</strong> Le recouvrement ne sollicite
          personne le samedi ni le dimanche : ni appel, ni SMS, ni mail. Les patientes attendues seront
          traitées <strong>lundi</strong>, avec la cohorte du lundi. Rien à signaler ici.
        </Bandeau>
      )}
      {enPause === true && (
        <Bandeau icone={<PauseCircle size={16} />} fond="#eef2ff" bord="#c7d2fe" couleur="#3730a3">
          <strong>Le recouvrement est en pause.</strong> Aucun appel, SMS ou mail automatique ne
          part — il est donc normal que des patientes apparaissent comme non jointes.
          {motifPause ? <> Motif : {motifPause}.</> : null}
        </Bandeau>
      )}
      {journeeEnCours && (
        <Bandeau icone={<Clock size={16} />} fond="#f8fafc" bord="var(--border)" couleur="var(--muted)">
          <strong>La journée n’est pas finie.</strong> Les appels passent de 12h30 à 13h55 et les
          écrits de rattrapage à 14h30 : les lignes de la journée n’entrent dans « À faire »
          qu’après. <strong>Pour un vrai contrôle, revenez après 14h30, ou regardez « Hier ».</strong>
        </Bandeau>
      )}

      {/* ── 2. La file « À faire » ─────────────────────────────────────────── */}
      <section className="ctl-file" aria-labelledby="ctl-file-titre" style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
        overflow: 'hidden', marginBottom: 'var(--sp-3)',
        borderLeft: '4px solid ' + (tonFile === 'attente' ? 'var(--st-attente-bd)' : tonFile === 'ok' ? 'var(--st-ok2-bd)' : 'var(--border)'),
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px 24px',
                      flexWrap: 'wrap', padding: '14px var(--sp-4) 12px' }}>
          <div>
            <p style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontFamily: 'Lexend,sans-serif',
                        fontSize: 11, fontWeight: 800, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--muted)' }}>
              <ClipboardCheck size={12} /> À faire
            </p>
            <p id="ctl-file-titre" style={{
              display: 'flex', alignItems: 'center', gap: 8, margin: '3px 0 0',
              fontFamily: 'Lexend,sans-serif', fontSize: 20, fontWeight: 800, lineHeight: 1.25,
              color: tonFile === 'attente' ? 'var(--st-attente-fg)' : tonFile === 'ok' ? '#15803d' : 'var(--text)',
            }}>
              {tonFile === 'ok' && <CheckCircle size={20} />}{titreFile}
            </p>
            <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
              {sousFile && <>{sousFile} · </>}
              {/* ⚠️ La phrase suit le CONTEXTE, pas seulement les chiffres : « 0 jointe sur
                  135 » est exact à 8h du matin, et c'est pourtant le pire résumé possible. */}
              {totalDu > 0 && <>
                {totalDu} {pluriel(totalDu, 'patiente attendue', 'patientes attendues')} ·{' '}
                <span title="« Jointe » : quelque chose lui est parvenu — elle a parlé, un message vocal a été déposé, ou un SMS / mail a été livré. Un appel qui sonne dans le vide ne compte pas."
                      style={{ textDecoration: 'underline dotted', textUnderlineOffset: 3, cursor: 'help' }}>
                  {totalJointes} {pluriel(totalJointes, 'jointe', 'jointes')}
                </span>
                {totalManques > 0 && !contexteExplique && <> · {totalManques} sans aucun contact
                  {totalJamaisTente > 0 && <>, dont {totalJamaisTente} où rien n’a même été tenté</>}</>}
              </>}
              {etatTraitements === 'chargement' && <> · lecture des traitements…</>}
            </p>
          </div>
          {totalFile > 0 && (
            <div style={{ minWidth: 230 }} aria-label={`${faites.length} traitées sur ${totalFile}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: 'var(--muted)', marginBottom: 5 }}>
                <span><strong style={{ color: 'var(--text)' }}>{faites.length}</strong> {pluriel(faites.length, 'traitée', 'traitées')} sur {totalFile}</span>
                <span>{pct} %</span>
              </div>
              <div style={{ height: 8, borderRadius: 99, background: '#eef3f8', overflow: 'hidden' }}>
                <div style={{ width: pct + '%', height: '100%', borderRadius: 99, background: 'var(--green)', transition: 'width .3s ease-out' }} />
              </div>
            </div>
          )}
        </div>

        {restant > 0 && (
          <div className="ctl-cols">
            <span>Étape</span><span>Patiente</span><span>État</span><span>Ce qui a été fait</span><span>Action à réaliser</span><span />
          </div>
        )}
        {pendants.length > 0 && <>
          <EnteteGroupe titre={'Sur la journée du ' + formatDate(jour).slice(0, 5)} n={pendants.length}
            aide="personne ne leur a parlé et aucun écrit ne leur est parvenu" />
          {pendants.map(x => ligneJournee(x, true))}
        </>}
        {declares.length > 0 && <>
          <EnteteGroupe titre="Disent avoir envoyé leur ordonnance" n={declares.length}
            aide="toutes dates confondues : la ligne reste là tant que personne n’a vérifié" />
          {declares.map(ligneDeclaration)}
        </>}
        {faites.length > 0 && <>
          <EnteteGroupe titre="Déjà traitées" n={faites.length} aide="qui, quand, et le commentaire" />
          {faites.map(ligneFaite)}
        </>}
      </section>

      {/* ── 3. Le reste de la journée, replié ───────────────────────────────── */}
      <section style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                        overflow: 'hidden', marginBottom: 'var(--sp-3)' }}>
        <Deplier
          ouvert={resteOuvert} onClick={() => setResteOuvert(o => !o)}
          titre="Le reste de la journée"
          detail={reste.length === 0
            ? 'aucune autre patiente ce jour-là'
            : reste.length === resteJointes
              ? `${reste.length} ${pluriel(reste.length, 'patiente jointe', 'patientes jointes')} — rien à faire pour elles`
              : `${reste.length} ${pluriel(reste.length, 'patiente', 'patientes')} · ${resteJointes} ${pluriel(resteJointes, 'jointe', 'jointes')} · ${reste.length - resteJointes} en attente`}
          droite={enService.filter(e => e.surEtape > 0).map(e => (
            <Chip key={e.rail.code} texte={`${e.rail.libelle} · ${e.jointes} / ${e.surEtape} ${pluriel(e.jointes, 'jointe', 'jointes')}`}
                  ton={contexteExplique ? 'neutre' : 'ok2'} />
          ))} />
        {resteOuvert && reste.length > 0 && (
          <div className="ctl-file" style={{ borderTop: '1px solid var(--border)' }}>
            {reste.map(x => ligneJournee(x, false))}
          </div>
        )}
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <Deplier
            ouvert={chiffresOuverts} onClick={() => setChiffresOuverts(o => !o)}
            titre="Chiffres par étape" detail="voix, écrit, sans contact, reste à traiter" />
        </div>
        {chiffresOuverts && (
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <DataTable encadre={false} colonnes={['Étape', 'Attendues', 'Jointes à la voix', 'Jointes par écrit', 'Sans aucun contact', 'Reste à traiter']}>
              {enService.map(e => (
                <tr key={e.rail.code}>
                  <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {e.rail.libelle}
                    <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 8, fontSize: 'var(--fs-sm)' }}>
                      {e.rail.titre}
                    </span>
                  </td>
                  <td style={tdStyle}>{e.surEtape}</td>
                  <td style={tdDiscret}>{e.voix}</td>
                  <td style={tdDiscret}>{e.ecrit}</td>
                  <td style={tdStyle}>
                    <Chip texte={String(e.manques)} ton={e.manques === 0 ? 'ok' : 'attente'} />
                  </td>
                  <td style={tdStyle}>
                    {e.aTraiter === 0
                      ? <Chip texte="0" ton="ok" />
                      : <Chip texte={String(e.aTraiter)} ton={contexteExplique ? 'neutre' : 'echec'} />}
                  </td>
                </tr>
              ))}
            </DataTable>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, padding: '10px var(--sp-4) 12px', lineHeight: 1.6,
                        borderTop: '1px solid var(--border)' }}>
              « Reste à traiter » ne compte pas les déclarations : elles ne dépendent pas de la journée.
              {aVenir.length > 0 && (
                /* ⚠️ Montrées SÉPARÉMENT et hors du compte : sans agent ni cron, 100 % de leurs
                   dossiers sont « sans contact » — ce n'est pas un manquement, c'est une étape
                   qui n'existe pas encore. */
                <> Pas encore automatisées ce jour-là, donc hors du contrôle :{' '}
                  {aVenir.map(e => `${e.rail.libelle} (${e.surEtape} dossiers)`).join(', ')}. Aucun agent ni
                  envoi automatique n’y est branché — il est normal que personne n’y ait été contacté.</>
              )}
            </p>
          </div>
        )}
      </section>

      <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '14px 2px 0', lineHeight: 1.6 }}>
        Cet écran ne contacte personne. « Traiter » et « Vérifier » consignent votre geste, avec votre
        nom et l’heure. Les chiffres reflètent l’état <strong>de maintenant</strong> — un SMS livré cette
        nuit apparaît donc sur la journée d’hier, ce qui est voulu. Les patientes dont l’ordonnance est
        arrivée, ou couvertes par une ordonnance en cours, ne sont pas comptées : aucun contact ne leur était dû.
      </p>

      {/* ⚠️ Rendus par un PORTAIL : sans lui, l'animation `fadeUp` de la vue porte un
          `transform` qui devient le bloc conteneur de tout `position: fixed`. */}
      {transcrit && <TranscriptPanel relance={transcrit} onClose={() => setTranscrit(null)} />}
      {parcours && (
        <ParcoursPatiente token={token} ids={parcours.ids} nom={parcours.nom} onClose={fermerParcours} />
      )}
    </div>
  );
}
