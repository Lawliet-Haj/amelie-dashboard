import { useState, useMemo } from 'react';
import { CheckCircle, AlertTriangle, CalendarDays, PhoneOff, PauseCircle, Clock, MessageSquareWarning } from 'lucide-react';
import type { Relance } from '../types';
import { Chip, DataTable, tdStyle, tdDiscret } from '../ui';
import {
  RAILS_RELANCES, lignesDuRail, jointVoixDansLeRail, jointParEcritDansLeRail,
  ecartEcheance, railAtteint, estSortie, couverteAujourdhui, type Rail,
} from '../lib/rails';
import { aujourdhuiIso, decalerJours, jourLocal, formatDate, formatDateLongue } from '../lib/format';

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
 * CONTRÔLER UNE JOURNÉE — écran de LECTURE SEULE.
 *
 * Il répond à une seule question : **parmi les patientes qui avaient un rendez-vous ce
 * jour-là, lesquelles n'ont été jointes par personne ?**
 *
 * ⚠️⚠️ AUCUN BOUTON D'ACTION ICI, et c'est le point. Demande du client (2026-09-17) :
 * « ils n'auront pas besoin de lancer des appels ou d'envoyer des SMS, ils vont juste
 * contrôler ce qui s'est passé ». L'onglet « Relances » porte déjà tout l'outillage
 * d'action — sélection, appel, envoi, import. Le mélanger avec un contrôle oblige à lire
 * un écran chargé pour répondre à une question simple, et met un bouton « Appeler » sous
 * la main de quelqu'un qui n'est venu que vérifier.
 *
 * 👉 Si une action s'impose après lecture, elle se fait dans « Relances ». Ne pas ajouter
 * de bouton ici « parce que ce serait pratique » : ce serait revenir à l'écran d'avant.
 */

/**
 * « Jointe » veut dire QUELQUE CHOSE LUI EST PARVENU, pas qu'on a essayé.
 *
 * ⚠️ C'est la définition arbitrée par le client le 2026-09-17, et elle se lit AU RAIL :
 * une patiente jointe la semaine dernière, à l'étape précédente, compte comme non jointe
 * sur celle-ci — c'est la raison d'être d'une nouvelle étape. Voir `jointVoixDansLeRail`
 * et `jointParEcritDansLeRail`, qui comparent tout à la date d'entrée dans le rail.
 */
function sansAucunContact(r: Relance, rail: Rail, jour: string): boolean {
  return !jointVoixDansLeRail(r, rail, jour) && !jointParEcritDansLeRail(r, rail, jour);
}

/**
 * Ce qui a été TENTÉ depuis l'entrée dans ce rail — à ne pas confondre avec ce qui a abouti.
 *
 * ⚠️ Les trois canaux se datent différemment (`dernier_appel`, `sms_le`, `email_le`) et se
 * comparent tous à la date d'entrée dans le rail : un SMS livré la semaine dernière, à
 * l'étape précédente, n'est pas une tentative de CETTE étape.
 *
 * 👉 Les trois à `false` = **on n'a rien tenté du tout**. C'est le cas grave : ce n'est pas
 * une patiente injoignable, c'est une patiente oubliée — module en pause, n8n à terre, ou
 * cohorte jamais reprise.
 */
function tentatives(r: Relance, rail: Rail) {
  const entree = r.date_echeance ? decalerJours(r.date_echeance, ecartEcheance(rail)) : null;
  const depuis = (ts?: string | null) => {
    if (!entree || !ts) return false;
    const j = jourLocal(ts);
    return Boolean(j) && j! >= entree;
  };
  const appel = depuis(r.dernier_appel);
  const sms = Boolean(r.sms_statut) && depuis(r.sms_le);
  const mail = Boolean(r.email_statut) && depuis(r.email_le);
  return { appel, sms, mail, rien: !appel && !sms && !mail };
}

/**
 * Les états d'acheminement, EN FRANÇAIS.
 *
 * ⚠️ Les valeurs brutes de la base (« echec_envoi », « envoye ») n’ont rien à faire sous
 * les yeux d’une conseillère : le reste du dashboard les traduit partout ailleurs.
 *
 * ⚠️ « livre », « ouvert » et « clique » ne devraient JAMAIS apparaître ici — une patiente
 * dont un écrit a abouti dans ce rail n’est pas « sans aucun contact » et ne figure donc
 * pas dans la liste. Ils sont traduits quand même : si l’un d’eux s’affichait, ce serait
 * le signe que les deux définitions ont divergé, et mieux vaut le LIRE que le deviner.
 */
const LIB_SMS: Record<string, string> = {
  livre: 'SMS livré',
  envoye: 'SMS envoyé, livraison non confirmée',
  echec: 'SMS non livré',
  echec_envoi: 'SMS jamais parti',
};
const LIB_MAIL: Record<string, string> = {
  clique: 'mail cliqué',
  ouvert: 'mail ouvert',
  livre: 'mail livré',
  envoye: 'mail envoyé, livraison non confirmée',
  echec: 'mail non livré',
  echec_envoi: 'mail jamais parti',
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

/** Une phrase, pas trois pastilles : on lit une ligne pour comprendre pourquoi rien n'est passé. */
function PourquoiRien({ r, rail }: { r: Relance; rail: Rail }) {
  const t = tentatives(r, rail);
  if (t.rien) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#b91c1c', fontWeight: 700 }}>
        <PhoneOff size={12} />
        Rien n’a été tenté
      </span>
    );
  }
  const bouts: string[] = [];
  if (t.appel) {
    // ⚠️ Un statut resté sur « À appeler » APRÈS un appel n'est pas une contradiction : le
    // lancement a été refusé (limite CPS du tronc SIP) ou le post-call n’a pas tourné. Le
    // recopier tel quel donne « appelée (À appeler) », qui ne veut rien dire pour la
    // lectrice — alors que c'est justement un cas qu'un contrôle doit faire remonter.
    if (r.statut === 'Non répondu') bouts.push('appelée, sans réponse');
    else if (r.statut === 'À appeler') {
      bouts.push(r.echec_motif
        ? `appel non abouti (${String(r.echec_motif).toLowerCase()})`
        : 'appel lancé, aucun résultat enregistré');
    } else bouts.push(`appelée — ${String(r.statut ?? '').toLowerCase()}`);
  }
  if (t.sms) bouts.push(LIB_SMS[String(r.sms_statut)] ?? `SMS : ${r.sms_statut}`);
  if (t.mail) bouts.push(LIB_MAIL[String(r.email_statut)] ?? `mail : ${r.email_statut}`);
  return <span style={{ color: 'var(--muted)' }}>{bouts.join(' · ')}</span>;
}

export function ControleJournee({ relances, enPause, motifPause }: {
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
}) {
  const ajd = aujourdhuiIso();
  const [jour, setJour] = useState(ajd);
  const hier = decalerJours(ajd, -1);

  /**
   * Un calcul par étape, pour la journée choisie.
   *
   * ⚠️ `lignesDuRail` porte déjà les deux exclusions qui comptent : les ordonnances REÇUES
   * et les patientes COUVERTES par une ordonnance en cours. On ne contrôle donc que les
   * dossiers pour lesquels un contact était réellement dû ce jour-là.
   *
   * ⚠️ Toutes les fonctions prennent `jour` en paramètre — c'est ce qui rend l'écran
   * capable de regarder hier. Aucune date n'est recalculée ici : une copie de plus de
   * `ecartEcheance()` et les chiffres divergeraient du reste du dashboard.
   */
  const parEtape = useMemo(() => RAILS_RELANCES.map(rail => {
    const surEtape = lignesDuRail(relances, rail, 'jour', jour);
    const manques = surEtape.filter(r => sansAucunContact(r, rail, jour));
    return {
      rail,
      surEtape: surEtape.length,
      voix: surEtape.filter(r => jointVoixDansLeRail(r, rail, jour)).length,
      ecrit: surEtape.filter(r => jointParEcritDansLeRail(r, rail, jour)).length,
      manques,
      // Le sous-ensemble alarmant : personne n'a rien tenté, sur aucun canal.
      jamaisTente: manques.filter(r => tentatives(r, rail).rien).length,
    };
  }), [relances, jour]);

  /**
   * ⚠️⚠️ LE VERDICT NE COMPTE QUE LES ÉTAPES EN SERVICE. Les étapes J+14 et au-delà n'ont
   * ni agent ni cron : *tous* leurs dossiers sont « sans aucun contact » par construction.
   * Les mélanger ferait afficher un chiffre alarmant qui ne décrit aucun manquement — et
   * un écran qui crie tous les jours cesse d'être lu.
   */
  const [liste, setListe] = useState<'sans-contact' | 'declare'>('sans-contact');

  /**
   * LES PATIENTES QUI DISENT AVOIR ENVOYÉ LEUR ORDONNANCE, et que personne n'a encore
   * vérifiées.
   *
   * ⚠️⚠️ CETTE LISTE N’EST PAS BORNÉE À LA JOURNÉE, et c’est délibéré (arbitrage client
   * du 2026-09-17). Le drapeau est COLLANT : seul le bouton « Vérifié » de l’onglet
   * Relances le lève. Une patiente signalée lundi et jamais vérifiée doit donc rester
   * visible vendredi — c’est une file d’attente, pas un événement du jour.
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

  const enService = parEtape.filter(e => e.rail.actif);
  const aVenir = parEtape.filter(e => !e.rail.actif && e.surEtape > 0);
  const totalDu = enService.reduce((n, e) => n + e.surEtape, 0);
  const totalManques = enService.reduce((n, e) => n + e.manques.length, 0);
  const totalJamaisTente = enService.reduce((n, e) => n + e.jamaisTente, 0);

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
      </div>

      {/* ⚠️ Deux raisons parfaitement NORMALES de ne voir personne de joint. Les taire
          ferait passer une décision, ou une heure trop matinale, pour une panne. */}
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
      {jour === ajd && hhmmParis() < FIN_FENETRE_HHMM && (
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
        background: totalManques === 0 ? '#f0fdf4' : '#fffbeb',
        border: '1px solid ' + (totalManques === 0 ? '#86efac' : '#fde68a'),
      }}>
        {totalManques === 0
          ? <CheckCircle size={20} style={{ color: '#15803d', flexShrink: 0, marginTop: 1 }} />
          : <AlertTriangle size={20} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />}
        <div>
          <p style={{
            margin: 0, fontFamily: 'Lexend,sans-serif', fontSize: 15, fontWeight: 800,
            color: totalManques === 0 ? '#15803d' : '#92400e',
          }}>
            {totalDu === 0
              ? 'Aucune étape ne tombait ce jour-là.'
              : totalManques === 0
                ? `Les ${totalDu} patientes attendues ont toutes été jointes.`
                : `${totalManques} patiente${totalManques > 1 ? 's' : ''} sur ${totalDu} n’${totalManques > 1 ? 'ont' : 'a'} été jointe${totalManques > 1 ? 's' : ''} par personne.`}
          </p>
          <p style={{ margin: '5px 0 0', fontSize: 12.5, color: totalManques === 0 ? '#15803d' : '#92400e', lineHeight: 1.55 }}>
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
                {e.manques.length === 0
                  ? <Chip texte="0" ton="ok" />
                  : <Chip texte={String(e.manques.length)} ton="attente" />}
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
          blocs empilés, visibles d'un seul coup d'œil. Avec 0 à 4 patientes par étape,
          masquer le J+7 derrière un onglet coûterait un clic pour apprendre qu'il va bien. */}
      <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 11, padding: 3, gap: 2, marginBottom: 'var(--sp-3)' }}>
        {([
          { id: 'sans-contact' as const, label: 'Sans aucun contact', n: totalManques },
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
                background: o.n > 0 ? 'var(--st-attente-bg)' : 'var(--st-ok-bg)',
                color: o.n > 0 ? 'var(--st-attente-fg)' : 'var(--st-ok-fg)',
              }}>{o.n}</span>
            </button>
          );
        })}
      </div>

      {/* ── Liste 1 : personne ne les a jointes ────────────────────────────── */}
      {liste === 'sans-contact' && (totalManques === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 2px 0' }}>
          Personne n’est resté sans contact sur les étapes en service ce jour-là.
        </p>
      ) : (
        <>
          {enService.filter(e => e.manques.length > 0).map(e => (
            <div key={e.rail.code} style={{ marginBottom: 'var(--sp-4)' }}>
              <p style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '0 0 7px' }}>
                <BadgeRail rail={e.rail} />
                <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  {e.manques.length} patiente{e.manques.length > 1 ? 's' : ''} sur {e.surEtape} attendues
                </span>
              </p>
              <DataTable colonnes={['Nom', 'Téléphone', 'Fin de location', 'Dernier appel', 'Ce qui a été tenté']}>
                {e.manques.map(r => (
                  <tr key={r.id}>
                    <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {[r.nom, r.prenom].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td style={{ ...tdDiscret, whiteSpace: 'nowrap' }}>{r.telephone || '—'}</td>
                    <td style={{ ...tdDiscret, whiteSpace: 'nowrap' }}>
                      {/* La FIN DE LOCATION, pas l'« applicable du » : c'est la date que la
                          patiente connaît, et celle qu'annoncent les SMS. */}
                      {r.date_echeance ? formatDate(decalerJours(r.date_echeance, -1)) : '—'}
                    </td>
                    {/* ⚠️ La DATE, pas le compteur `nb_tentatives` : celui-ci porte sur TOUT
                        le parcours, donc « 1 » s'afficherait à côté de « rien n'a été tenté »
                        — les deux vrais, et contradictoires à la lecture. Une date antérieure
                        à l'ouverture de l'étape se comprend d'un coup d'œil. */}
                    <td style={{ ...tdDiscret, whiteSpace: 'nowrap' }}>
                      {r.dernier_appel
                        ? formatDate(jourLocal(r.dernier_appel))
                        : <span style={{ color: '#b91c1c', fontWeight: 700 }}>jamais</span>}
                    </td>
                    <td style={tdStyle}><PourquoiRien r={r} rail={e.rail} /></td>
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
              <strong> Cette liste n’est pas limitée à la journée choisie</strong> : elle reste
              affichée tant que personne n’a vérifié. La vérification se fait depuis l’onglet
              « Relances », avec le bouton « Vérifié ».
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
              <DataTable colonnes={['Nom', 'Téléphone', 'Fin de location', 'L’a dit le', 'Ce qu’ORTHOP en dit']}>
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
                    <td style={{ ...tdDiscret, whiteSpace: 'nowrap' }}>
                      {r.dernier_appel ? formatDate(jourLocal(r.dernier_appel)) : '—'}
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
                            ORTHOP la réclame toujours — à vérifier
                          </span>}
                    </td>
                  </tr>
                ))}
              </DataTable>
            </div>
          ))}
        </>
      ))}

      <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '18px 2px 0', lineHeight: 1.6 }}>
        Cet écran ne déclenche rien : il se contente de lire. Les chiffres reflètent l’état
        <strong> de maintenant</strong> — un SMS livré cette nuit apparaît donc sur la journée d’hier, ce
        qui est voulu. Les patientes dont l’ordonnance est arrivée, ou couvertes par une ordonnance en
        cours, ne sont pas comptées : aucun contact ne leur était dû.
      </p>
    </div>
  );
}
