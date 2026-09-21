import { useState, useMemo } from 'react';
import {
  CheckCircle, AlertTriangle, CalendarDays, PhoneOff, PauseCircle, Clock,
  MessageSquareWarning, BookOpen,
} from 'lucide-react';
import type { Relance } from '../types';
import { Chip, DataTable, tdStyle, tdDiscret, TranscriptPanel, BoutonTranscript } from '../ui';
import {
  RAILS_RELANCES, lignesDuRail, jointVoixDansLeRail, jointParEcritDansLeRail,
  railAtteint, estSortie, couverteAujourdhui, PLAFOND_TENTATIVES, type Rail,
} from '../lib/rails';
// ⚠️ Le JUGEMENT vit dans `src/lib/controle.ts`, pas ici : c'est ce qui permet de
// l'éprouver sur les vraies données sans charger React. Cette vue ne fait que DESSINER
// ce qu'il rend — elle ne rejuge rien.
import { bilanDossier, type Bilan, type ContexteJournee, type GraviteAction } from '../lib/controle';
import {
  aujourdhuiIso, decalerJours, jourLocal, jourSemaineIso, formatDate, formatDateLongue,
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
 * La version précédente n'affichait QUE les patientes sans aucun contact. Elle répondait
 * donc à « qu'est-ce qui a raté ? » et à rien d'autre : impossible de voir le travail
 * fait, impossible de vérifier qu'une patiente jointe l'avait bien été, et une journée
 * parfaite affichait une page vide qui ne prouvait rien. L'écran porte maintenant **une
 * ligne par patiente attendue**, et chaque ligne répond aux trois questions du client :
 *
 *   1. où en est-elle       → la colonne « État » — rouge = action requise, vert = traitée
 *   2. ce qui a été fait    → les trois canaux, datés DANS LE RAIL
 *   3. quoi faire ensuite   → la colonne « Action à réaliser »
 *
 * ⚠️⚠️ AUCUN CONTACT SORTANT ICI — rien qui atteigne une patiente. Demande du client
 * (2026-09-17) : « ils n'auront pas besoin de lancer des appels ou d'envoyer des SMS, ils
 * vont juste contrôler ce qui s'est passé ». L'onglet « Relances » porte déjà tout
 * l'outillage d'action ; le mélanger avec un contrôle oblige à lire un écran chargé pour
 * répondre à une question simple, et met un bouton « Appeler » sous la main de quelqu'un
 * qui n'est venu que vérifier.
 *
 * ⚠️⚠️ UN SEUL LIBELLÉ CLIQUABLE, ET C'EST « VÉRIFIER » — arbitré par le client le
 * 2026-09-21 : « le libellé cliquable doit juste être vérifier, pour le reste je ne vois
 * pas ce qu'il y aurait à faire ». Tout le reste de la colonne « Action » est du TEXTE :
 * ce sont des consignes, pas des commandes. « Vérifier » ne contacte personne — il lève
 * un drapeau — et c'est la seule suite que cet écran puisse donner lui-même.
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
 * JOURS — et cet onglet est la vue par défaut du Recouvrement, donc c'est la première
 * chose que l'équipe verrait chaque matin. C'est la règle déjà posée pour les étapes sans
 * automate : un écran qui crie tous les jours cesse d'être lu.
 *
 * ⚠️ Le juge est `action.gravite`, pas une seconde lecture du contexte : les trois cas
 * neutres sont exactement ceux que l'escalier de `actionDuDossier` range en `neutre`. Deux
 * façons de répondre à la même question finiraient par diverger.
 */
function PastilleEtat({ b }: { b: Bilan }) {
  if (b.jointe) return <Chip texte="Jointe" ton="ok" titre="Quelque chose lui est parvenu à cette étape" />;
  if (b.action.gravite === 'neutre') {
    return <Chip texte="En attente" ton="neutre" titre={b.action.texte} />;
  }
  if (b.rienTente) {
    return <Chip texte="Rien tenté" ton="echec" titre="Ni appel, ni SMS, ni mail depuis l’entrée dans cette étape" />;
  }
  return <Chip texte="Sans contact" ton="attente" titre="On a essayé, mais rien ne lui est parvenu" />;
}

type FiltreJournee = 'tout' | 'jointes' | 'sans-contact' | 'rien-tente';

export function ControleJournee({ relances, enPause, motifPause, onVerifie }: {
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
  /**
   * Lève le drapeau « dit avoir envoyé » sur un dossier.
   *
   * ⚠️ Fourni PAR LE PARENT (`markOrdoVerified` de RecouvrementView), qui porte déjà
   * l'appel à W-Update-Relance et met à jour sa propre liste — la ligne se met donc à jour
   * d'elle-même. Réécrire le fetch ici en aurait fait une seconde copie, vouée à diverger.
   */
  onVerifie?: (r: Relance) => Promise<void>;
}) {
  // Le dossier dont la vérification est en cours : le bouton se verrouille le temps
  // de l'aller-retour, sinon un double clic part deux fois.
  const [verifEnCours, setVerifEnCours] = useState<number | null>(null);
  /**
   * Le dossier dont on lit le transcript.
   *
   * ⚠️ LIRE N'EST PAS CONTACTER : le panneau n'appelle personne, n'envoie rien, et
   * n'écrit pas en base. Il ne contredit donc pas la doctrine de cet écran — c'est même
   * ce qui la rend tenable, puisqu'on peut enfin juger une ligne sans aller la chercher
   * dans la console de travail.
   */
  const [transcrit, setTranscrit] = useState<Relance | null>(null);
  const ajd = aujourdhuiIso();
  const [jour, setJour] = useState(ajd);
  const hier = decalerJours(ajd, -1);
  const [liste, setListe] = useState<'journee' | 'declare'>('journee');
  const [filtre, setFiltre] = useState<FiltreJournee>('tout');

  /**
   * ⚠️⚠️ LE WEEK-END N'EST PAS UN MANQUEMENT (2026-09-18).
   *
   * Les crons d'appel ne tournent plus que du lundi au vendredi, et la cohorte du samedi
   * et du dimanche est reprise le lundi. Un samedi affiché sans ce repère montre donc
   * TOUTE sa cohorte en « sans aucun contact » et envoie chercher une panne là où il y a
   * une règle — exactement ce que font déjà la pause et l'heure trop matinale.
   *
   * On ne masque rien : la population reste affichée, seul le VERDICT cesse d'alerter.
   */
  const estWeekEnd = jourSemaineIso(jour) >= 6;
  const journeeEnCours = jour === ajd && hhmmParis() < FIN_FENETRE_HHMM;

  /**
   * Un bilan par patiente, groupé par étape, pour la journée choisie.
   *
   * ⚠️ `lignesDuRail` porte déjà les deux exclusions qui comptent : les ordonnances REÇUES
   * et les patientes COUVERTES par une ordonnance en cours. On ne contrôle donc que les
   * dossiers pour lesquels un contact était réellement dû ce jour-là.
   *
   * ⚠️ Toutes les fonctions prennent `jour` en paramètre — c'est ce qui rend l'écran
   * capable de regarder hier. Aucune date n'est recalculée ici.
   */
  const parEtape = useMemo(() => RAILS_RELANCES.map(rail => {
    const ctx: ContexteJournee = { estWeekEnd, enPause, journeeEnCours };
    const bilans = lignesDuRail(relances, rail, 'jour', jour).map(r => bilanDossier(r, rail, jour, ctx));
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
    };
  }), [relances, jour, estWeekEnd, enPause, journeeEnCours]);

  /**
   * LES PATIENTES QUI DISENT AVOIR ENVOYÉ LEUR ORDONNANCE, et que personne n'a encore
   * vérifiées.
   *
   * ⚠️⚠️ CETTE LISTE N’EST PAS BORNÉE À LA JOURNÉE, et c’est délibéré (arbitrage client
   * du 2026-09-17, reconfirmé le 21/09 : « la journée seule + disent avoir envoyé »). Le
   * drapeau est COLLANT : seul le bouton « Vérifier » le lève. Une patiente signalée lundi
   * et jamais vérifiée doit donc rester visible vendredi — c’est une file d’attente, pas
   * un événement du jour.
   *
   * ⚠️ On écarte celles dont l’ordonnance est ARRIVÉE (`estSortie`) : leur déclaration
   * est confirmée par ORTHOP, il n’y a plus rien à vérifier. Les autres restent, y
   * compris les couvertes — leur situation est affichée en clair plutôt que devinée.
   *
   * ⚠️ Groupé par `railAtteint` (la dernière étape DÉPASSÉE) et non `railDeRelance`
   * (« a-t-elle un rendez-vous aujourd’hui ») : ces patientes sont réparties partout
   * dans le parcours, pas sur l’étape du jour.
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
    // Les étapes les plus avancées en premier : ce sont les déclarations les plus vieilles.
    return { total: lg.length, groupes: [...m.values()].sort((a, b) => (b.rail?.jour ?? 0) - (a.rail?.jour ?? 0)) };
  }, [relances, jour]);

  /**
   * ⚠️⚠️ LE VERDICT NE COMPTE QUE LES ÉTAPES EN SERVICE. Les étapes J+14 et au-delà n'ont
   * ni agent ni cron : *tous* leurs dossiers sont « sans aucun contact » par construction.
   * Les mélanger ferait afficher un chiffre alarmant qui ne décrit aucun manquement — et
   * un écran qui crie tous les jours cesse d'être lu.
   */
  const enService = parEtape.filter(e => e.rail.actif);
  const aVenir = parEtape.filter(e => !e.rail.actif && e.surEtape > 0);
  const totalDu = enService.reduce((n, e) => n + e.surEtape, 0);
  const totalJointes = enService.reduce((n, e) => n + e.jointes, 0);
  const totalManques = enService.reduce((n, e) => n + e.manques, 0);
  const totalJamaisTente = enService.reduce((n, e) => n + e.jamaisTente, 0);
  /**
   * ⚠️⚠️ TROIS RAISONS PARFAITEMENT NORMALES DE N'AVOIR JOINT PERSONNE, et aucune n'est un
   * manquement : le week-end (tout est reporté à lundi), une pause décidée, et une journée
   * qui n'a pas encore atteint 12h30. Chacune a déjà son bandeau ; ce qu'il manquait, c'est
   * qu'elles ÉTEIGNENT AUSSI L'ALARME.
   *
   * Sans cela, l'écran vire à l'ambre chaque matin sur l'intégralité de sa cohorte — et
   * comme c'est la vue par DÉFAUT du Recouvrement, c'est la première chose que l'équipe
   * verrait en arrivant, tous les jours. Une alerte qui se déclenche tous les jours n'est
   * plus une alerte : c'est la règle déjà appliquée aux étapes sans automate, et aux mails
   * des crons (« seule la dernière tentative alerte »).
   */
  const contexteExplique = estWeekEnd || enPause === true || journeeEnCours;
  const alerte = totalManques > 0 && !contexteExplique;

  /** Les quatre vues de la journée. Le compteur est celui du périmètre que le clic affichera. */
  const VUES: { id: FiltreJournee; label: string; n: number; alerte: boolean }[] = [
    { id: 'tout',         label: 'Toutes',        n: totalDu,          alerte: false },
    { id: 'jointes',      label: 'Jointes',       n: totalJointes,     alerte: false },
    { id: 'sans-contact', label: 'Sans contact',  n: totalManques,     alerte: !contexteExplique },
    { id: 'rien-tente',   label: 'Rien tenté',    n: totalJamaisTente, alerte: !contexteExplique },
  ];

  const passeFiltre = (b: Bilan): boolean => {
    if (filtre === 'jointes') return b.jointe;
    if (filtre === 'sans-contact') return !b.jointe;
    if (filtre === 'rien-tente') return !b.jointe && b.rienTente;
    return true;
  };
  const etapesAffichees = enService
    .map(e => ({ ...e, visibles: e.bilans.filter(passeFiltre) }))
    .filter(e => e.visibles.length > 0);
  const totalAffiche = etapesAffichees.reduce((n, e) => n + e.visibles.length, 0);

  const boutonJour = (val: string, texte: string) => (
    <button
      onClick={() => setJour(val)}
      style={{
        padding: '6px 14px', borderRadius: 'var(--r-md)', fontFamily: 'Lexend,sans-serif',
        fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
        border: '1px solid ' + (jour === val ? 'var(--blue)' : 'var(--border)'),
        background: jour === val ? 'var(--blue)' : 'white',
        color: jour === val ? 'white' : 'var(--text)',
      }}>{texte}</button>
  );

  /**
   * Le bouton « Vérifier » — LE SEUL LIBELLÉ CLIQUABLE DE CET ÉCRAN.
   *
   * ⚠️ Il ne contacte personne : il lève le drapeau déclaratif, donc la patiente redevient
   * appelable par le parcours. C'est irréversible depuis ici — le drapeau ne se repose que
   * lors d'un prochain appel où elle le redirait.
   *
   * ⚠️ Il se verrouille pendant l'aller-retour, sinon un double clic part deux fois.
   */
  const BoutonVerifier = ({ r }: { r: Relance }) => {
    if (!onVerifie) return null;
    const occupe = verifEnCours !== null;
    return (
      <button
        onClick={async () => {
          setVerifEnCours(r.id);
          await onVerifie(r);
          setVerifEnCours(null);
        }}
        disabled={occupe}
        title="Contrôlez dans ORTHOP, puis cliquez : le signalement est retiré et la patiente revient dans le parcours"
        style={{
          padding: '4px 12px', borderRadius: 'var(--r-md)',
          fontFamily: 'Lexend,sans-serif', fontSize: 11.5, fontWeight: 700,
          border: '1px solid ' + (occupe ? 'var(--border)' : '#a7f3d0'),
          background: verifEnCours === r.id ? '#ecfdf5' : 'white',
          color: occupe ? 'var(--muted)' : '#047857',
          cursor: occupe ? 'not-allowed' : 'pointer',
        }}>
        {verifEnCours === r.id ? 'Enregistrement…' : 'Vérifier'}
      </button>
    );
  };

  return (
    <div>
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
          onChange={e => { if (e.target.value) setJour(e.target.value); }}
          style={{
            padding: '5px 9px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)',
            fontSize: 12.5, fontFamily: 'inherit', color: 'var(--text)',
          }} />
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
          {formatDateLongue(jour)}
        </span>
        {/* ⚠️ Le mode opératoire est servi par nginx depuis `public/docs/` : un lien, pas
            un fichier à retrouver dans le dépôt. Chemin ABSOLU — l'application est une SPA,
            un chemin relatif dépendrait de la route affichée. `noopener` par principe. */}
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
        <DataTable colonnes={['Étape', 'Attendues', 'Jointes à la voix', 'Jointes par écrit', 'Sans aucun contact']}>
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
            </tr>
          ))}
        </DataTable>
        {aVenir.length > 0 && (
          /* ⚠️ Montrées SÉPARÉMENT et hors du verdict : sans agent ni cron, 100 % de leurs
             dossiers sont « sans contact » — ce n'est pas un manquement, c'est une étape
             qui n'existe pas encore. Les compter ferait hurler l'écran tous les jours. */
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 2px 0', lineHeight: 1.6 }}>
            Étapes pas encore automatisées ce jour-là, volontairement hors du compte ci-dessus :{' '}
            {aVenir.map(e => `${e.rail.libelle} (${e.surEtape} dossiers)`).join(', ')}. Aucun agent ni
            envoi automatique n’y est branché — il est normal que personne n’y ait été contacté.
          </p>
        )}
      </div>

      {/* ── Les deux listes, en petits onglets ─────────────────────────────── */}
      {/* ⚠️ Les onglets portent sur les DEUX LISTES, pas sur les rails : ceux-ci restent des
          blocs empilés, visibles d'un seul coup d'œil. Périmètre arrêté avec le client le
          2026-09-21 : « la journée seule + disent avoir envoyé ». */}
      <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 11, padding: 3, gap: 2, marginBottom: 'var(--sp-3)' }}>
        {([
          { id: 'journee' as const, label: 'La journée', n: totalDu },
          { id: 'declare' as const, label: 'Disent avoir envoyé', n: declares.total },
        ]).map(o => {
          const actif = liste === o.id;
          return (
            <button key={o.id} onClick={() => setListe(o.id)} style={{
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
          {/* Les quatre vues. ⚠️ Le compteur est celui du périmètre que le clic affichera —
              une pastille qui annonce un nombre et ouvre un tableau différent est la panne
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
                </span>
              </p>
              <DataTable colonnes={['État', 'Patiente', 'Fin de location', 'Ce qui a été fait', 'Action à réaliser']}>
                {e.visibles.map(b => (
                  <tr key={b.r.id}>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <PastilleEtat b={b} />
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 600 }}>
                        {[b.r.nom, b.r.prenom].filter(Boolean).join(' ') || '—'}
                      </span>
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
                    {/* ⚠️ CE QUI A ÉTÉ FAIT — les trois canaux, tous datés DANS LE RAIL. Un SMS
                        livré la semaine dernière, à l'étape précédente, ne dit rien de
                        celle-ci : c'est la raison d'être de l'étape suivante. */}
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                        {/* ⚠️ LE TRANSCRIPT SE LIT ICI, à côté de ce que l'appel a donné —
                            pas dans la colonne « Action à réaliser », qui ne doit porter
                            qu'un seul libellé cliquable, « Vérifier ». Lire n'est pas une
                            action à réaliser : c'est ce qui permet de juger. Le bouton est
                            une ICÔNE, la même que partout ailleurs dans le dashboard. */}
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Chip texte={b.appel.texte} ton={b.appel.ton} />
                          {b.appel.tente && (
                            <BoutonTranscript relance={b.r} onOuvrir={setTranscrit} taille={22} />
                          )}
                        </span>
                        <Chip texte={b.sms.texte} ton={b.sms.ton} />
                        <Chip texte={b.mail.texte} ton={b.mail.ton} />
                        {/* Repère utile quand on se demande pourquoi elle n'est plus rappelée. */}
                        {b.r.dernier_appel && (
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                            dernier appel le {formatDate(jourLocal(b.r.dernier_appel))}
                            {' · '}{b.r.nb_tentatives ?? 0}/{PLAFOND_TENTATIVES} tentatives
                          </span>
                        )}
                      </div>
                    </td>
                    {/* ⚠️ DU TEXTE, SAUF « Vérifier ». Le client a tranché le 2026-09-21 : c'est
                        le seul libellé cliquable de l'écran. Les autres actions se font dans
                        « Relances », qui porte l'outillage — et les contacts sortants. */}
                    <td style={tdStyle}>
                      <span style={{
                        color: COULEUR_ACTION[b.action.gravite],
                        fontWeight: b.action.gravite === 'alerte' ? 700 : 500,
                      }}>
                        {b.action.gravite === 'alerte' && (
                          <PhoneOff size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
                        )}
                        {b.action.texte}
                      </span>
                      {b.action.bouton === 'verifier' && (
                        <span style={{ marginLeft: 9, display: 'inline-block' }}>
                          <BoutonVerifier r={b.r} />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
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
              affichée tant qu’elle n’a pas été traitée. Le bouton « Vérifier » retire le
              signalement et remet la patiente dans le parcours.
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
                    <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {[r.nom, r.prenom].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td style={{ ...tdDiscret, whiteSpace: 'nowrap' }}>{r.telephone || '—'}</td>
                    <td style={{ ...tdDiscret, whiteSpace: 'nowrap' }}>
                      {r.date_echeance ? formatDate(decalerJours(r.date_echeance, -1)) : '—'}
                    </td>
                    {/* Le drapeau n'a pas de date propre : il est posé par le post-call, donc
                        la date de l'appel qui l'a déclenché est la meilleure approximation. */}
                    {/* ⚠️ LE TRANSCRIPT COMPTE DOUBLE ICI : la déclaration « j'ai déjà
                        envoyé » est produite par un MODÈLE qui interprète cet appel. Sans
                        le texte sous les yeux, on lève un drapeau sur la foi d'une
                        interprétation qu'on n'a pas lue — or ce drapeau fait taire la
                        patiente jusqu'à ce que quelqu'un clique. */}
                    <td style={{ ...tdDiscret, whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        {r.dernier_appel ? formatDate(jourLocal(r.dernier_appel)) : '—'}
                        {r.dernier_appel && <BoutonTranscript relance={r} onOuvrir={setTranscrit} taille={22} />}
                      </span>
                    </td>
                    {/* ⚠️ LE RECOUPEMENT, et c'est l'information utile : la déclaration vient
                        d'un modèle qui interprète un transcript, ORTHOP est la preuve. « Elle
                        avait raison » et « ORTHOP la réclame toujours » n'appellent pas du
                        tout la même suite. */}
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
                    <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <BoutonVerifier r={r} />
                    </td>
                  </tr>
                ))}
              </DataTable>
            </div>
          ))}
        </>
      ))}

      <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '18px 2px 0', lineHeight: 1.6 }}>
        Cet écran n’envoie rien : ni appel, ni SMS, ni mail. « Vérifier » est sa seule action, et
        elle ne contacte personne. Les chiffres reflètent l’état <strong>de maintenant</strong> — un
        SMS livré cette nuit apparaît donc sur la journée d’hier, ce qui est voulu. Les patientes dont
        l’ordonnance est arrivée, ou couvertes par une ordonnance en cours, ne sont pas comptées :
        aucun contact ne leur était dû.
      </p>

      {/* ⚠️ Rendu par un PORTAIL (dans `TranscriptPanel`) : sans lui, l'animation `fadeUp`
          de la vue porte un `transform` qui devient le bloc conteneur de tout
          `position: fixed`, et le panneau s'ouvre hors de l'écran. Ne pas retirer. */}
      {transcrit && <TranscriptPanel relance={transcrit} onClose={() => setTranscrit(null)} />}
    </div>
  );
}
