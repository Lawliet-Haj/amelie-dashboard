import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  CheckCircle, AlertTriangle, CalendarDays, PhoneOff, PauseCircle, Clock,
  MessageSquareWarning, BookOpen, UserCheck, History, Search,
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
  bilanDossier, parOrdreDAction, demandeUnGeste, dernierTraitementParDossier,
  type Bilan, type ContexteJournee, type GraviteAction,
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
 * ⚠️⚠️ IL MONTRE TOUTE LA JOURNÉE, PAS SEULEMENT LES MANQUANTS (2026-09-21).
 * Demande du client : « sur contrôle on devrait plutôt montrer tout ceux qui ont été
 * appelés, mais il faudrait distinguer les cas qu'on n'a vraiment pas pu contacter, et
 * qu'on puisse voir quelle action réaliser et ce qui a déjà été fait. »
 *
 * L'écran porte **une ligne par patiente attendue**, et chaque ligne répond aux trois
 * questions du client :
 *
 *   1. où en est-elle       → la colonne « État » — rouge = action requise, vert = traitée
 *   2. ce qui a été fait    → les trois canaux, datés DANS LE RAIL
 *   3. quoi faire ensuite   → la colonne « Action à réaliser »
 *
 * ⚠️⚠️ AUCUN CONTACT SORTANT ICI — rien qui atteigne une patiente. Demande du client
 * (2026-09-17) : « ils n'auront pas besoin de lancer des appels ou d'envoyer des SMS, ils
 * vont juste contrôler ce qui s'est passé ». L'onglet « Relances » porte déjà tout
 * l'outillage d'action ; un bouton « Appeler » n'a rien à faire sous la main de quelqu'un
 * qui n'est venu que vérifier.
 *
 * ⚠️⚠️ CHAQUE LIGNE QUI N'EST PAS VERTE A SON BOUTON, ET SON TRAITEMENT EST SIGNÉ
 * (2026-09-23, au sortir d'une réunion client) : « pour ceux qui ne sont pas vert, mettre
 * un bouton d'action, qu'on puisse voir traité par + nom de celui qui a traité, et
 * rajouter la possibilité de mettre un commentaire — ensuite ça doit passer au vert ».
 * Ce revirement précise la règle du 21/09 (« le seul libellé cliquable est Vérifier »),
 * il ne la contredit pas : « Traiter » ne CONTACTE personne, il CONSIGNE ce que l'équipe
 * a fait, qui et quand. La règle qui tient toujours est celle du contact sortant.
 *
 * ⚠️ Le nom de celle qui traite vient du JETON, côté serveur — jamais du navigateur.
 */
const COULEUR_ACTION: Record<GraviteAction, string> = {
  ok: '#15803d', attente: '#92400e', alerte: '#b91c1c', neutre: 'var(--muted)',
};

/**
 * L'étiquette d'une étape. Un badge plutôt qu'un simple titre : c'est ce qui rend les
 * blocs distinguables d'un coup d'œil quand on fait défiler plusieurs rails.
 */
function BadgeRail({ rail }: { rail: Rail | null }) {
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 999,
      fontFamily: 'Lexend,sans-serif', fontSize: 12, fontWeight: 800,
      background: rail ? 'var(--blue-faint)' : 'var(--st-neutre-bg)',
      color: rail ? 'var(--blue)' : 'var(--muted)',
      border: '1px solid ' + (rail ? 'var(--blue-mid)' : 'var(--border)'),
    }}>{rail ? rail.libelle : 'hors étape'}</span>
  );
}

/**
 * ROUGE = action requise · VERT = traitée. La lecture demandée par le client.
 *
 * ⚠️⚠️ ELLE SE TAIT QUAND LE CONTEXTE EXPLIQUE TOUT. Un week-end, une pause, ou une
 * journée qui n'a pas encore atteint 12h30 : la patiente n'a rien reçu, et c'est
 * parfaitement normal. La peindre en rouge à 8h du matin ferait hurler l'écran TOUS LES
 * JOURS — et cet onglet est la vue par défaut du Recouvrement.
 *
 * ⚠️ Le juge est `action.gravite`, pas une seconde lecture du contexte : les trois cas
 * neutres sont exactement ceux que l'escalier de `actionDuDossier` range en `neutre`.
 *
 * ⚠️ Une ligne TRAITÉE par l'équipe passe au vert : c'est la demande du 2026-09-23. Le
 * vert dit « plus rien à faire ici », pas « elle a été jointe » — la puce « Traitée » le
 * distingue de « Jointe », et la colonne d'à côté dit toujours ce qui lui est parvenu.
 */
function PastilleEtat({ b, t }: { b: Bilan; t?: Traitement }) {
  if (t) return <Chip texte="Traitée" ton="ok" titre={'Traitée par ' + t.traite_par + ' le ' + formatDateTime(t.traite_le)} />;
  if (b.jointe) return <Chip texte="Jointe" ton="ok" titre="Quelque chose lui est parvenu à cette étape" />;
  if (b.action.gravite === 'neutre') {
    return <Chip texte="En attente" ton="neutre" titre={b.action.texte} />;
  }
  if (b.rienTente) {
    return <Chip texte="Rien tenté" ton="echec" titre="Ni appel, ni SMS, ni mail depuis l’entrée dans cette étape" />;
  }
  return <Chip texte="Sans contact" ton="attente" titre="On a essayé, mais rien ne lui est parvenu" />;
}

/** Ce qui a été consigné : qui, quand, et le commentaire. Affiché sous l'action. */
function BlocTraite({ t }: { t: Traitement }) {
  return (
    <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
      <p style={{ margin: 0, fontSize: 12, color: '#15803d', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <UserCheck size={13} />
        {t.verif_orthop ? 'Vérifiée' : 'Traitée'} par {t.traite_par}
        <span style={{ fontWeight: 500, color: '#166534' }}>· {formatDateTime(t.traite_le)}</span>
      </p>
      {t.verif_orthop && (
        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#166534' }}>
          ORTHOP : {t.verif_orthop === 'recue' ? 'ordonnance reçue' : 'ordonnance pas encore reçue'}
        </p>
      )}
      {t.commentaire && (
        <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
          « {t.commentaire} »
        </p>
      )}
    </div>
  );
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
        padding: '5px 12px', borderRadius: 'var(--r-md)', fontFamily: 'Lexend,sans-serif',
        fontSize: 11.5, fontWeight: 700, border: '1px solid ' + couleur, background: fond, color: couleur,
        cursor: envoi ? 'not-allowed' : 'pointer', opacity: envoi ? 0.55 : 1,
      }}>{texte}</button>
  );
  return (
    <div style={{ marginTop: 7, padding: '9px 10px', borderRadius: 9, background: '#f8fafc', border: '1px solid var(--border)', maxWidth: 440 }}>
      {mode === 'verifier' && (
        <p style={{ margin: '0 0 6px', fontSize: 11.5, color: 'var(--muted)' }}>
          Contrôlez dans ORTHOP, puis indiquez ce que vous y avez vu.
        </p>
      )}
      <textarea
        autoFocus value={commentaire} maxLength={1000} rows={2} disabled={envoi}
        onChange={e => setCommentaire(e.target.value)}
        placeholder="Commentaire (facultatif) — ce que vous avez fait ou constaté"
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '6px 8px',
          borderRadius: 7, border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 12.5,
          color: 'var(--text)', background: 'white',
        }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginTop: 6 }}>
        {mode === 'verifier' ? (
          <>
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Dans ORTHOP :</span>
            {bouton('Ordonnance reçue', '#047857', '#ecfdf5', () => valider('recue'))}
            {bouton('Pas encore reçue', '#b45309', '#fffbeb', () => valider('pas_recue'))}
          </>
        ) : bouton('Marquer comme traité', '#047857', '#ecfdf5', () => valider())}
        <button onClick={onAnnuler} disabled={envoi}
          style={{ border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, padding: '4px 6px' }}>
          Annuler
        </button>
        {envoi && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Enregistrement…</span>}
      </div>
      {erreur && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#b91c1c' }}>Non enregistré : {erreur}.</p>}
    </div>
  );
}

type FiltreJournee = 'tout' | 'a-traiter' | 'traitees' | 'jointes' | 'sans-contact' | 'rien-tente';

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
  const [liste, setListe] = useState<'journee' | 'declare'>('journee');
  const [filtre, setFiltre] = useState<FiltreJournee>('tout');
  /** La ligne dont le formulaire de traitement est ouvert (une seule à la fois). */
  const [formOuvert, setFormOuvert] = useState<number | null>(null);
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
   * au J+1 ne dit rien du J+7. Et le lundi regroupe les cohortes du week-end — les deux
   * journées sont contrôlées séparément. On recharge donc à chaque changement de jour.
   *
   * ⚠️ Si la lecture échoue, on le DIT : sans traitements, toutes les lignes traitées
   * redeviendraient rouges et l'équipe les retraiterait.
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
   * ⚠️⚠️ LE WEEK-END N'EST PAS UN MANQUEMENT (2026-09-18).
   *
   * Les crons d'appel ne tournent plus que du lundi au vendredi, et la cohorte du samedi
   * et du dimanche est reprise le lundi. On ne masque rien : la population reste affichée,
   * seul le VERDICT cesse d'alerter.
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
    // ⚠️ TRIÉ : ce qui demande une action remonte en tête, ce qui a été TRAITÉ redescend.
    //    Le classement vit dans `controle.ts`, avec les actions.
    //    ⚠️ Le tri ne change AUCUN compteur : l'ordre n'entre dans aucun total.
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
      aTraiter: bilans.filter(b => demandeUnGeste(b) && !traitements.has(b.r.id)).length,
      traitees: bilans.filter(b => traitements.has(b.r.id)).length,
    };
  }), [relances, jour, estWeekEnd, enPause, journeeEnCours, traitements]);

  /**
   * LES PATIENTES QUI DISENT AVOIR ENVOYÉ LEUR ORDONNANCE, et que personne n'a encore
   * vérifiées.
   *
   * ⚠️⚠️ CETTE LISTE N’EST PAS BORNÉE À LA JOURNÉE, et c’est délibéré (arbitrage client
   * du 2026-09-17, reconfirmé le 21/09). Le drapeau est COLLANT : seule la vérification
   * le lève. C’est une file d’attente, pas un événement du jour.
   *
   * ⚠️ On écarte celles dont l’ordonnance est ARRIVÉE (`estSortie`) : leur déclaration
   * est confirmée par ORTHOP, il n’y a plus rien à vérifier.
   *
   * ⚠️ Groupé par `railAtteint` (la dernière étape DÉPASSÉE) : ces patientes sont
   * réparties partout dans le parcours, pas sur l’étape du jour.
   */
  const declares = useMemo(() => {
    const lg = relances.filter(r => r.ordonnance_deja_envoyee && !estSortie(r));
    const m = new Map<string, { rail: Rail | null; lignes: Relance[] }>();
    for (const r of lg) {
      const rail = railAtteint(r, jour);
      const cle = rail ? rail.code : '—';
      const g = m.get(cle) ?? { rail, lignes: [] };
      g.lignes.push(r);
      m.set(cle, g);
    }
    return { total: lg.length, groupes: [...m.values()].sort((a, b) => (b.rail?.jour ?? 0) - (a.rail?.jour ?? 0)) };
  }, [relances, jour]);

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
  const totalATraiter = enService.reduce((n, e) => n + e.aTraiter, 0);
  const totalTraitees = enService.reduce((n, e) => n + e.traitees, 0);
  /**
   * ⚠️⚠️ TROIS RAISONS PARFAITEMENT NORMALES DE N'AVOIR JOINT PERSONNE, et aucune n'est un
   * manquement : le week-end, une pause décidée, et une journée qui n'a pas encore atteint
   * 12h30. Elles ÉTEIGNENT L'ALARME.
   *
   * ⚠️ Depuis le 2026-09-23, l'alarme porte sur ce qui reste À TRAITER, et non plus sur les
   * patientes sans contact : une journée dont l'équipe a traité chaque ligne rouge est une
   * journée contrôlée. Le nombre de patientes sans contact reste écrit, lui, en toutes
   * lettres — c'est un fait, que le traitement ne change pas.
   */
  const contexteExplique = estWeekEnd || enPause === true || journeeEnCours;
  const alerte = totalATraiter > 0 && !contexteExplique;

  /** Les vues de la journée. Le compteur est celui du périmètre que le clic affichera. */
  const VUES: { id: FiltreJournee; label: string; n: number; alerte: boolean }[] = [
    { id: 'tout',         label: 'Toutes',        n: totalDu,          alerte: false },
    { id: 'a-traiter',    label: 'À traiter',     n: totalATraiter,    alerte: !contexteExplique },
    { id: 'traitees',     label: 'Traitées',      n: totalTraitees,    alerte: false },
    { id: 'jointes',      label: 'Jointes',       n: totalJointes,     alerte: false },
    { id: 'sans-contact', label: 'Sans contact',  n: totalManques,     alerte: false },
    { id: 'rien-tente',   label: 'Rien tenté',    n: totalJamaisTente, alerte: !contexteExplique },
  ];

  const passeFiltre = (b: Bilan): boolean => {
    if (filtre === 'a-traiter') return demandeUnGeste(b) && !traitements.has(b.r.id);
    if (filtre === 'traitees') return traitements.has(b.r.id);
    if (filtre === 'jointes') return b.jointe;
    if (filtre === 'sans-contact') return !b.jointe;
    if (filtre === 'rien-tente') return !b.jointe && b.rienTente;
    return true;
  };
  const etapesAffichees = enService
    .map(e => ({ ...e, visibles: e.bilans.filter(passeFiltre) }))
    .filter(e => e.visibles.length > 0);
  const totalAffiche = etapesAffichees.reduce((n, e) => n + e.visibles.length, 0);

  /**
   * Consigner un geste. Renvoie un message d'erreur, ou `null` si c'est enregistré.
   *
   * ⚠️ La ligne ne passe au vert QU'APRÈS la réponse du serveur, avec ce qu'il a écrit
   * (son nom, son heure). Afficher « traitée » avant, c'est risquer un vert que la base ne
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

  /**
   * Le geste d'une ligne : son bouton, son formulaire, ou ce qui a été consigné.
   *
   * ⚠️ Une fonction appelée, pas un composant `<Geste/>` : déclarée ici, elle serait
   * recréée à chaque rendu et démonterait le formulaire à chaque frappe.
   */
  const geste = (r: Relance, rail: Rail | null, actionCode: string | null, mode: 'traiter' | 'verifier') => {
    const t = traitements.get(r.id);
    if (formOuvert === r.id) {
      return (
        <FormGeste
          mode={mode}
          onAnnuler={() => setFormOuvert(null)}
          onValider={(c, v) => consigner(r, rail, actionCode, c, v)} />
      );
    }
    const occupe = formOuvert !== null;
    return (
      <button
        onClick={() => setFormOuvert(r.id)}
        disabled={occupe || etatTraitements === 'chargement'}
        title={mode === 'verifier'
          ? 'Contrôlez dans ORTHOP, puis indiquez si l’ordonnance y est — le signalement sera retiré'
          : 'Consigner ce que vous avez fait : la ligne passera au vert, avec votre nom'}
        style={{
          marginTop: 6, padding: '4px 12px', borderRadius: 'var(--r-md)',
          fontFamily: 'Lexend,sans-serif', fontSize: 11.5, fontWeight: 700,
          border: '1px solid ' + (occupe ? 'var(--border)' : '#a7f3d0'),
          background: 'white', color: occupe ? 'var(--muted)' : '#047857',
          cursor: occupe ? 'not-allowed' : 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
        <UserCheck size={12} /> {mode === 'verifier' ? 'Vérifier' : (t ? 'Traiter à nouveau' : 'Traiter')}
      </button>
    );
  };

  const boutonJour = (val: string, texte: string) => (
    <button
      onClick={() => choisirJour(val)}
      style={{
        padding: '6px 14px', borderRadius: 'var(--r-md)', fontFamily: 'Lexend,sans-serif',
        fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
        border: '1px solid ' + (jour === val ? 'var(--blue)' : 'var(--border)'),
        background: jour === val ? 'var(--blue)' : 'white',
        color: jour === val ? 'white' : 'var(--text)',
      }}>{texte}</button>
  );

  /** Le nom d'une patiente, cliquable : il ouvre tout son parcours. */
  const nomCliquable = (r: Relance) => {
    const nom = [r.nom, r.prenom].filter(Boolean).join(' ');
    return (
      <button
        onClick={() => setParcours({ ids: [r.id], nom })}
        title="Voir tout son parcours : appels, SMS, mails, gestes de l’équipe"
        style={{
          border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
          fontWeight: 600, color: 'var(--text)', fontSize: 'inherit', fontFamily: 'inherit',
          textDecoration: 'underline', textDecorationColor: 'var(--border)', textUnderlineOffset: 3,
        }}>{nom || '—'}</button>
    );
  };

  return (
    <div>
      {/* ── Retrouver une patiente, quelle que soit sa date d'entrée ────────── */}
      {/* ⚠️ Cherche dans TOUT le stock chargé (trois mois, purge RGPD), pas dans la journée
          choisie : c'est ce que le client a demandé — « peu importe quand elle a été
          insérée dans le parcours ». */}
      <div style={{
        padding: '12px 16px', background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)', marginBottom: 'var(--sp-3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <Search size={15} style={{ color: 'var(--muted)' }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)' }}>RETROUVER UNE PATIENTE</span>
          <SearchInput
            valeur={recherche} onChange={setRecherche} largeur={340}
            placeholder="Nom, prénom, téléphone ou e-mail…" />
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            sur tout le parcours, quelle que soit sa date d’entrée
          </span>
        </div>
        {recherche.trim().length >= 2 && (
          <div style={{ marginTop: 10 }}>
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

      {/* ── Le jour contrôlé ───────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap',
        padding: '12px 16px', background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)', marginBottom: 'var(--sp-4)',
      }}>
        <CalendarDays size={15} style={{ color: 'var(--muted)' }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)' }}>JOURNÉE CONTRÔLÉE</span>
        {boutonJour(ajd, 'Aujourd’hui')}
        {boutonJour(hier, 'Hier')}
        <input
          type="date" value={jour} max={ajd}
          onChange={e => { if (e.target.value) choisirJour(e.target.value); }}
          style={{
            padding: '5px 9px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)',
            fontSize: 12.5, fontFamily: 'inherit', color: 'var(--text)',
          }} />
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
          {formatDateLongue(jour)}
        </span>
        {/* ⚠️ Le mode opératoire est servi par nginx depuis `public/docs/` : un lien, pas
            un fichier à retrouver dans le dépôt. Chemin ABSOLU — l'application est une SPA,
            un chemin relatif dépendrait de la route affichée. */}
        <a
          href="/docs/mode-op-controle-journee.html" target="_blank" rel="noopener noreferrer"
          title="Comment contrôler la journée — document imprimable, s’ouvre dans un onglet"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none',
            padding: '5px 11px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)',
            background: 'white', color: 'var(--muted)', fontSize: 12, fontWeight: 600,
          }}>
          <BookOpen size={13} /> Mode d’emploi
        </a>
      </div>

      {/* ⚠️ Sans les traitements, toutes les lignes traitées redeviendraient rouges et
          l'équipe les retraiterait : l'échec de lecture se dit, et bloque les boutons. */}
      {etatTraitements === 'erreur' && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px',
                      background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--r-lg)',
                      marginBottom: 'var(--sp-3)' }}>
          <AlertTriangle size={16} style={{ color: '#b91c1c', flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 12.5, color: '#991b1b', margin: 0, lineHeight: 1.55 }}>
            <strong>Les traitements déjà consignés n’ont pas pu être lus.</strong> Des lignes déjà
            traitées peuvent apparaître en rouge. Rechargez la page avant de traiter quoi que ce soit.
          </p>
        </div>
      )}

      {/* ⚠️ TROIS raisons parfaitement NORMALES de ne voir personne de joint. Les taire
          ferait passer une décision, un week-end, ou une heure trop matinale, pour une panne. */}
      {estWeekEnd && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px',
                      background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                      marginBottom: 'var(--sp-3)' }}>
          <CalendarDays size={16} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 12.5, color: 'var(--text)', margin: 0, lineHeight: 1.55 }}>
            <strong>C’est le week-end — aucun appel n’est prévu.</strong> Depuis le 18/09, le
            recouvrement ne sollicite personne le samedi ni le dimanche : ni appel, ni SMS, ni
            mail. Les patientes ci-dessous sont bien attendues, mais elles seront traitées
            <strong> lundi</strong>, avec la cohorte du lundi. Rien à signaler ici.
          </p>
        </div>
      )}
      {enPause === true && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px',
                      background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 'var(--r-lg)',
                      marginBottom: 'var(--sp-3)' }}>
          <PauseCircle size={16} style={{ color: '#4338ca', flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 12.5, color: '#3730a3', margin: 0, lineHeight: 1.55 }}>
            <strong>Le recouvrement est en pause.</strong> Aucun appel, SMS ou mail automatique ne
            part — il est donc normal que des patientes apparaissent ci-dessous comme non jointes.
            {motifPause ? <> Motif : {motifPause}.</> : null}
          </p>
        </div>
      )}
      {journeeEnCours && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px',
                      background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                      marginBottom: 'var(--sp-3)' }}>
          <Clock size={16} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 12.5, color: 'var(--text)', margin: 0, lineHeight: 1.55 }}>
            <strong>La journée n’est pas finie.</strong> Les appels passent de 12h30 à 13h55 et les
            écrits de rattrapage à 14h30 : avant cette heure, il est normal que peu de patientes
            aient été jointes. <strong>Pour un vrai contrôle, revenez après 14h30, ou regardez « Hier ».</strong>
          </p>
        </div>
      )}

      {/* ── Le verdict, en une phrase ──────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 18px',
        borderRadius: 'var(--r-lg)', marginBottom: 'var(--sp-4)',
        background: alerte ? '#fffbeb' : '#f0fdf4',
        border: '1px solid ' + (alerte ? '#fde68a' : '#86efac'),
      }}>
        {alerte
          ? <AlertTriangle size={20} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />
          : <CheckCircle size={20} style={{ color: '#15803d', flexShrink: 0, marginTop: 1 }} />}
        <div>
          <p style={{
            margin: 0, fontFamily: 'Lexend,sans-serif', fontSize: 15, fontWeight: 800,
            color: alerte ? '#92400e' : '#15803d',
          }}>
            {/* ⚠️ La phrase suit le CONTEXTE, pas seulement les chiffres. « 0 patiente jointe
                sur 135 » est exact à 8h du matin, et c'est pourtant le pire résumé
                possible : la journée n'a pas commencé. */}
            {totalDu === 0
              ? 'Aucune étape ne tombait ce jour-là.'
              : estWeekEnd
                ? `${totalDu} patientes attendues — reportées à lundi.`
                : enPause === true && totalJointes === 0
                  ? `${totalDu} patientes attendues — le module est en pause.`
                  : journeeEnCours && totalJointes === 0
                    ? `${totalDu} patientes attendues aujourd’hui — les appels commencent à 12h30.`
                    : totalManques === 0
                      ? `Les ${totalDu} patientes attendues ont toutes été jointes.`
                      : `${totalJointes} patiente${totalJointes > 1 ? 's' : ''} jointe${totalJointes > 1 ? 's' : ''} sur ${totalDu} — ${totalManques} sans aucun contact.`}
          </p>
          <p style={{ margin: '5px 0 0', fontSize: 12.5, color: alerte ? '#92400e' : '#15803d', lineHeight: 1.55 }}>
            {totalDu === 0
              ? 'Les étapes du parcours tombent à des jours précis : il est normal qu’une journée soit vide.'
              : <>
                  {!contexteExplique && (totalATraiter > 0
                    ? <><strong>{totalATraiter} ligne{totalATraiter > 1 ? 's' : ''} à traiter</strong>{totalTraitees > 0 ? ` · ${totalTraitees} déjà traitée${totalTraitees > 1 ? 's' : ''}` : ''}. </>
                    : totalTraitees > 0
                      ? <><strong>Toutes les lignes qui le demandaient ont été traitées</strong> ({totalTraitees}). </>
                      : null)}
                  « Jointe » veut dire que <strong>quelque chose lui est parvenu</strong> : elle a parlé, un
                  message vocal a été déposé, ou un SMS / mail a été <strong>livré</strong>. Un appel qui sonne
                  dans le vide ne compte pas.
                  {totalJamaisTente > 0 && (
                    <> <strong>Dont {totalJamaisTente} pour {totalJamaisTente > 1 ? 'lesquelles' : 'laquelle'} rien n’a même
                    été tenté</strong> — ni appel, ni SMS, ni mail.</>
                  )}
                </>}
          </p>
        </div>
      </div>

      {/* ── Le compte par étape ────────────────────────────────────────────── */}
      <h3 style={{ fontFamily: 'Lexend,sans-serif', fontSize: 13, fontWeight: 800, color: 'var(--text)', margin: '0 0 10px' }}>
        Par étape
      </h3>
      <div style={{ marginBottom: 'var(--sp-5)' }}>
        <DataTable colonnes={['Étape', 'Attendues', 'Jointes à la voix', 'Jointes par écrit', 'Sans aucun contact', 'Reste à traiter']}>
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
                {e.manques === 0
                  ? <Chip texte="0" ton="ok" />
                  : <Chip texte={String(e.manques)} ton="attente" />}
              </td>
              <td style={tdStyle}>
                {e.aTraiter === 0
                  ? <Chip texte="0" ton="ok" />
                  : <Chip texte={String(e.aTraiter)} ton={contexteExplique ? 'neutre' : 'echec'} />}
              </td>
            </tr>
          ))}
        </DataTable>
        {aVenir.length > 0 && (
          /* ⚠️ Montrées SÉPARÉMENT et hors du verdict : sans agent ni cron, 100 % de leurs
             dossiers sont « sans contact » — ce n'est pas un manquement, c'est une étape
             qui n'existe pas encore. */
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 2px 0', lineHeight: 1.6 }}>
            Étapes pas encore automatisées ce jour-là, volontairement hors du compte ci-dessus :{' '}
            {aVenir.map(e => `${e.rail.libelle} (${e.surEtape} dossiers)`).join(', ')}. Aucun agent ni
            envoi automatique n’y est branché — il est normal que personne n’y ait été contacté.
          </p>
        )}
      </div>

      {/* ── Les deux listes, en petits onglets ─────────────────────────────── */}
      <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 11, padding: 3, gap: 2, marginBottom: 'var(--sp-3)' }}>
        {([
          { id: 'journee' as const, label: 'La journée', n: totalDu },
          { id: 'declare' as const, label: 'Disent avoir envoyé', n: declares.total },
        ]).map(o => {
          const actif = liste === o.id;
          return (
            <button key={o.id} onClick={() => { setListe(o.id); setFormOuvert(null); }} style={{
              padding: '6px 15px', border: 'none', borderRadius: 9, cursor: 'pointer',
              fontFamily: 'Lexend,sans-serif', fontSize: 12.5, fontWeight: actif ? 800 : 600,
              background: actif ? 'white' : 'transparent',
              color: actif ? 'var(--blue)' : 'var(--muted)',
              boxShadow: actif ? '0 1px 4px rgba(0,0,0,.1)' : 'none',
              display: 'flex', alignItems: 'center', gap: 7,
            }}>
              {o.label}
              <span style={{
                padding: '1px 7px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                background: o.n > 0 ? 'var(--st-neutre-bg)' : 'var(--st-ok-bg)',
                color: o.n > 0 ? 'var(--muted)' : 'var(--st-ok-fg)',
              }}>{o.n}</span>
            </button>
          );
        })}
      </div>

      {/* ── Liste 1 : TOUTE la journée, une ligne par patiente ─────────────── */}
      {liste === 'journee' && (totalDu === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 2px 0' }}>
          Aucune patiente n’était attendue sur les étapes en service ce jour-là.
        </p>
      ) : (
        <>
          {/* Les vues. ⚠️ Le compteur est celui du périmètre que le clic affichera — une
              pastille qui annonce un nombre et ouvre un tableau différent est la panne
              exacte relevée le 2026-09-16 sur les tuiles du Parcours. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 'var(--sp-3)' }}>
            {VUES.map(v => {
              const on = filtre === v.id;
              const crie = v.alerte && v.n > 0;
              return (
                <button key={v.id} onClick={() => setFiltre(v.id)} style={{
                  padding: '5px 13px', borderRadius: 999, cursor: 'pointer',
                  fontFamily: 'Lexend,sans-serif', fontSize: 12, fontWeight: on ? 800 : 600,
                  border: '1px solid ' + (on ? 'var(--blue)' : 'var(--border)'),
                  background: on ? 'var(--blue)' : 'white',
                  color: on ? 'white' : 'var(--text)',
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                }}>
                  {v.label}
                  <span style={{
                    padding: '0 6px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                    background: on ? 'rgba(255,255,255,.25)' : (crie ? 'var(--st-echec-bg)' : 'var(--st-neutre-bg)'),
                    color: on ? 'white' : (crie ? 'var(--st-echec-fg)' : 'var(--muted)'),
                  }}>{v.n}</span>
                </button>
              );
            })}
          </div>

          {totalAffiche === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 2px 0' }}>
              Aucune patiente dans cette vue pour la journée choisie.
            </p>
          ) : etapesAffichees.map(e => (
            <div key={e.rail.code} style={{ marginBottom: 'var(--sp-4)' }}>
              <p style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '0 0 7px', flexWrap: 'wrap' }}>
                <BadgeRail rail={e.rail} />
                <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  {e.visibles.length === e.surEtape
                    ? `${e.surEtape} patiente${e.surEtape > 1 ? 's' : ''} attendue${e.surEtape > 1 ? 's' : ''}`
                    : `${e.visibles.length} sur ${e.surEtape} attendues`}
                  {' · '}{e.jointes} jointe{e.jointes > 1 ? 's' : ''}
                  {e.manques > 0 && <> · <strong style={{ color: '#b91c1c' }}>{e.manques} sans contact</strong></>}
                  {e.traitees > 0 && <> · <strong style={{ color: '#15803d' }}>{e.traitees} traitée{e.traitees > 1 ? 's' : ''}</strong></>}
                </span>
              </p>
              <DataTable colonnes={['État', 'Patiente', 'Fin de location', 'Ce qui a été fait', 'Action à réaliser']}>
                {e.visibles.map(b => {
                  const t = traitements.get(b.r.id);
                  const aFaire = demandeUnGeste(b);
                  return (
                    <tr key={b.r.id}>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        <PastilleEtat b={b} t={t} />
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        {nomCliquable(b.r)}
                        <br />
                        <span style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>
                          {b.r.telephone || 'pas de téléphone'}
                        </span>
                      </td>
                      <td style={{ ...tdDiscret, whiteSpace: 'nowrap' }}>
                        {/* La FIN DE LOCATION, pas l'« applicable du » : c'est la date que la
                            patiente connaît, et celle qu'annoncent les SMS. */}
                        {b.r.date_echeance ? formatDate(decalerJours(b.r.date_echeance, -1)) : '—'}
                      </td>
                      {/* ⚠️ CE QUI A ÉTÉ FAIT — les trois canaux, tous datés DANS LE RAIL. */}
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <Chip texte={b.appel.texte} ton={b.appel.ton} />
                            {b.appel.tente && (
                              <BoutonTranscript relance={b.r} onOuvrir={setTranscrit} taille={22} />
                            )}
                          </span>
                          <Chip texte={b.sms.texte} ton={b.sms.ton} />
                          <Chip texte={b.mail.texte} ton={b.mail.ton} />
                          {b.r.dernier_appel && (
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                              dernier appel le {formatDate(jourLocal(b.r.dernier_appel))}
                              {' · '}{b.r.nb_tentatives ?? 0}/{PLAFOND_TENTATIVES} tentatives
                            </span>
                          )}
                        </div>
                      </td>
                      {/* ⚠️ La consigne reste écrite même une fois la ligne traitée : c'est ce
                          qu'on a traité, et le commentaire n'a de sens qu'à côté d'elle. */}
                      <td style={tdStyle}>
                        <span style={{
                          color: t ? 'var(--muted)' : COULEUR_ACTION[b.action.gravite],
                          fontWeight: !t && b.action.gravite === 'alerte' ? 700 : 500,
                        }}>
                          {!t && b.action.gravite === 'alerte' && (
                            <PhoneOff size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
                          )}
                          {b.action.texte}
                        </span>
                        {t && <BlocTraite t={t} />}
                        {/* ⚠️ Pas de bouton sur une ligne déjà traitée : on ne retraite pas une
                            ligne verte par mégarde. Seule une vérification ORTHOP encore due
                            (le drapeau est toujours levé) garde son bouton. */}
                        {aFaire && (!t || b.action.code === 'verifier') && (
                          <div>{geste(b.r, e.rail, b.action.code, b.action.code === 'verifier' ? 'verifier' : 'traiter')}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
            </div>
          ))}
        </>
      ))}

      {/* ── Liste 2 : elles disent avoir envoyé leur ordonnance ────────────── */}
      {liste === 'declare' && (declares.total === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 2px 0' }}>
          Aucune déclaration en attente de vérification.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px',
                        background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 'var(--r-lg)',
                        marginBottom: 'var(--sp-3)' }}>
            <MessageSquareWarning size={16} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 12.5, color: '#92400e', margin: 0, lineHeight: 1.55 }}>
              Ces patientes ont dit, pendant un appel, avoir déjà envoyé leur ordonnance.
              Tant que personne ne vérifie, <strong>elles ne sont plus appelées</strong>.
              <strong> Cette liste n’est pas limitée à la journée choisie</strong> : elle reste
              affichée tant qu’elle n’a pas été traitée. « Vérifier » retire le signalement,
              consigne ce que vous avez vu dans ORTHOP avec votre nom, et remet la patiente
              dans le parcours.
            </p>
          </div>
          {declares.groupes.map(g => (
            <div key={g.rail ? g.rail.code : 'hors'} style={{ marginBottom: 'var(--sp-4)' }}>
              <p style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '0 0 7px' }}>
                <BadgeRail rail={g.rail} />
                <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  {g.lignes.length} patiente{g.lignes.length > 1 ? 's' : ''} — étape atteinte
                </span>
              </p>
              <DataTable colonnes={['Nom', 'Téléphone', 'Fin de location', 'L’a dit le', 'Ce qu’ORTHOP en dit', 'Action à réaliser']}>
                {g.lignes.map(r => (
                  <tr key={r.id}>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{nomCliquable(r)}</td>
                    <td style={{ ...tdDiscret, whiteSpace: 'nowrap' }}>{r.telephone || '—'}</td>
                    <td style={{ ...tdDiscret, whiteSpace: 'nowrap' }}>
                      {r.date_echeance ? formatDate(decalerJours(r.date_echeance, -1)) : '—'}
                    </td>
                    {/* ⚠️ LE TRANSCRIPT COMPTE DOUBLE ICI : la déclaration « j'ai déjà
                        envoyé » est produite par un MODÈLE qui interprète cet appel. */}
                    <td style={{ ...tdDiscret, whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        {r.dernier_appel ? formatDate(jourLocal(r.dernier_appel)) : '—'}
                        {r.dernier_appel && <BoutonTranscript relance={r} onOuvrir={setTranscrit} taille={22} />}
                      </span>
                    </td>
                    {/* ⚠️ LE RECOUPEMENT : la déclaration vient d'un modèle, ORTHOP est la preuve. */}
                    <td style={tdStyle}>
                      {couverteAujourdhui(r, jour)
                        ? <span style={{ color: '#15803d', fontWeight: 700 }}>
                            ordonnance enregistrée — couverte jusqu’au{' '}
                            {formatDate(String(r.fin_application).slice(0, 10))}
                          </span>
                        : <span style={{ color: 'var(--muted)' }}>
                            ORTHOP la réclame toujours — à contrôler
                          </span>}
                    </td>
                    <td style={{ ...tdStyle, minWidth: 190 }}>
                      {geste(r, railAtteint(r, jour), 'verifier', 'verifier')}
                    </td>
                  </tr>
                ))}
              </DataTable>
            </div>
          ))}
        </>
      ))}

      <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '18px 2px 0', lineHeight: 1.6 }}>
        Cet écran n’envoie rien : ni appel, ni SMS, ni mail. « Traiter » et « Vérifier » consignent
        ce que vous avez fait, avec votre nom et l’heure — ils ne contactent personne. Les chiffres
        reflètent l’état <strong>de maintenant</strong> — un SMS livré cette nuit apparaît donc sur la
        journée d’hier, ce qui est voulu. Les patientes dont l’ordonnance est arrivée, ou couvertes
        par une ordonnance en cours, ne sont pas comptées : aucun contact ne leur était dû.
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
