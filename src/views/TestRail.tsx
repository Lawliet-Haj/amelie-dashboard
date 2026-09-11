/**
 * TESTER UN RAIL — le panneau.
 *
 * Trois questions, dans l'ordre où on se les pose :
 *   1. qui serait appelé sur cette étape, et **pourquoi pas les autres** ;
 *   2. à quoi ressemble l'appel — passé vers MON numéro, avec l'agent du rail ;
 *   3. l'agent a-t-il dit tout le message, ou seulement l'accueil.
 *
 * ⚠️⚠️ L'ÉCART VIENT DE `ecartEcheance(rail)`, JAMAIS DE `rail.jour` NU. `date_echeance`
 * est la date « applicable du » = fin de location + 1, donc un rail J+N tire sur
 * `date_echeance + (N − 1)`. Le serveur n'a aucune copie de cette table : il renvoie la
 * date qu'il a réellement interrogée, et l'écran la **recoupe** avec sa propre prévision
 * plutôt que de supposer qu'elles concordent — c'est déjà ce que fait le modal de la
 * facturation, et c'est ce qui a permis de détecter le décalage d'un jour.
 *
 * ⚠️ Le formulaire d'appel n'apparaît QUE pour les rails dont l'action `appel` est en
 * service : les autres n'ont pas d'agent ElevenLabs dédié, et le serveur refuserait de
 * toute façon. Un champ qu'on ne peut pas soumettre est pire qu'un champ absent.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Phone, RefreshCw, X } from 'lucide-react';
import { Chip, DataTable, Portal, tdDiscret, tdStyle, type Ton } from '../ui';
import { ecartEcheance, type Rail } from '../lib/rails';
import { formatDateLongue, formatDateTime, normalizePhoneFr } from '../lib/format';
import {
  appelTestRail, envoiTestRail, selectionRail, transcriptTest, type EnvoiTest,
  type AppelTest, type Selection, type TranscriptTest,
} from '../lib/railTest';

/** Un verdict bloquant se lit d'un coup d'œil ; « appelable » est le seul état positif. */
function tonVerdict(v: string): Ton {
  if (v === 'appelable') return 'ok';
  if (v === 'ordonnance recue') return 'ok2';
  if (v.startsWith('appelee il y a')) return 'encours';
  if (v === 'sans telephone' || v === 'quota de tentatives epuise') return 'echec';
  return 'neutre';
}

const carte: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-lg)', padding: 'var(--sp-4)',
};

const champ: React.CSSProperties = {
  padding: '8px var(--sp-3)', borderRadius: 'var(--r-md)',
  border: '1px solid var(--border)', fontSize: 'var(--fs-md)',
  background: 'white', color: 'var(--text)',
};

/** Un champ dont on ne devine pas le rôle mérite son étiquette, pas seulement un repère grisé. */
const etiquette: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 3,
  fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--muted)',
  fontFamily: 'Lexend,sans-serif',
};

export function TestRail({ rail, token, onFermer }: { rail: Rail; token: string; onFermer: () => void }) {
  const ecart = ecartEcheance(rail);
  const testableParAppel = rail.actions.some(a => a.canal === 'appel' && a.etat === 'actif');

  const [sel, setSel] = useState<Selection | null>(null);
  const [erreurSel, setErreurSel] = useState('');
  const [chargement, setChargement] = useState(false);

  const [tel, setTel] = useState('');
  /**
   * Ce que l'agent doit croire du dossier appelé. Sans ces trois champs, on ne testait
   * qu'un cas : « Madame Test », échéance = celle de l'étape. Or c'est justement le
   * contenu du message qu'on veut éprouver étape par étape.
   */
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  /**
   * L'échéance annoncée, en ISO. Vide = le serveur prend celle de l'étape.
   *
   * ⚠️ Elle est PRÉ-REMPLIE avec `sel.date_visee`, c'est-à-dire la date que le SERVEUR
   * dit avoir interrogée — jamais une date recalculée ici. C'est la même discipline que
   * partout dans ce projet : l'écran ne redérive pas l'échelle des rails, il affiche ce
   * que le serveur a réellement utilisé.
   */
  const [dateEch, setDateEch] = useState('');
  const [dateTouchee, setDateTouchee] = useState(false);
  const [confirme, setConfirme] = useState(false);

  /**
   * Les ÉCRITS : le SMS et le mail que la production envoie après l'appel.
   *
   * ⚠️ Le mail n'existe pas sur tous les rails — le J+7 en est privé par décision client.
   * On le déduit de la définition du rail (`actions`), sans recopier de table de canaux :
   * le serveur a la sienne, et une seconde copie ici divergerait tôt ou tard.
   */
  const mailEnProd = rail.actions.some(a => a.canal === 'mail' && a.etat === 'actif');
  const [email, setEmail] = useState('');
  const [avecEcrits, setAvecEcrits] = useState(false);
  const [envoi, setEnvoi] = useState<EnvoiTest | null>(null);
  const [erreurEnvoi, setErreurEnvoi] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [appel, setAppel] = useState<AppelTest | null>(null);
  const [erreurAppel, setErreurAppel] = useState('');
  const [appelEnCours, setAppelEnCours] = useState(false);

  const [tr, setTr] = useState<TranscriptTest | null>(null);
  const [erreurTr, setErreurTr] = useState('');
  const [trEnCours, setTrEnCours] = useState(false);

  const charger = useCallback(async () => {
    setChargement(true); setErreurSel('');
    const r = await selectionRail(token, rail.code, ecart);
    if (r.ok) {
      setSel(r.data);
      // La date de l'étape, telle que le serveur l'a interrogée. On ne l'impose qu'une
      // fois : dès que l'opérateur y a touché, son choix l'emporte sur un rechargement.
      if (!dateTouchee) setDateEch(r.data.date_visee);
    } else { setSel(null); setErreurSel(r.erreur); }
    setChargement(false);
  }, [token, rail.code, ecart, dateTouchee]);

  useEffect(() => { void charger(); }, [charger]);

  /** Ce que l'agent doit croire du dossier — commun à l'appel et aux écrits. */
  function identite() {
    return {
      telephone: normalizePhoneFr(tel) || tel,
      // Vides, le serveur retombe sur « Madame Test » et sur la date de l'étape.
      prenom: prenom.trim() || undefined,
      nom: nom.trim() || undefined,
      email: email.trim() || undefined,
      dateEcheance: dateEch || undefined,
    };
  }

  async function lancerAppel() {
    setAppelEnCours(true); setErreurAppel(''); setAppel(null); setTr(null); setErreurTr('');
    setEnvoi(null); setErreurEnvoi('');
    const r = await appelTestRail(token, rail.code, ecart, identite());
    if (r.ok) setAppel(r.data);
    else {
      setErreurAppel(r.erreur);
      // Un refus du garde-fou porte les dossiers concernés : on les garde pour l'afficher.
      const d = r as unknown as AppelTest;
      if (d.dossiers?.length) setAppel(d);
    }
    setAppelEnCours(false);
    // ⚠️ Les écrits ne partent QUE si l'appel a abouti — comme en production, où c'est le
    // post-call qui les déclenche. Les envoyer après un appel refusé donnerait une image
    // fausse de l'enchaînement.
    if (r.ok && avecEcrits) await lancerEcrits();
  }

  async function lancerEcrits() {
    setEnvoiEnCours(true); setErreurEnvoi(''); setEnvoi(null);
    const r = await envoiTestRail(token, rail.code, identite());
    if (r.ok) setEnvoi(r.data);
    else {
      setErreurEnvoi(r.erreur);
      const d = r as unknown as EnvoiTest;
      if (d.dossiers?.length) setEnvoi(d);
    }
    setEnvoiEnCours(false);
  }

  async function relire() {
    if (!appel?.conversation_id) return;
    setTrEnCours(true); setErreurTr('');
    const r = await transcriptTest(token, appel.conversation_id);
    if (r.ok) setTr(r.data); else { setTr(null); setErreurTr(r.erreur); }
    setTrEnCours(false);
  }

  // La date que NOUS prévoyons, pour la recouper avec celle du serveur.
  const prevue = (() => {
    const d = new Date(); d.setUTCHours(12, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ecart);
    return d.toISOString().substring(0, 10);
  })();
  const desaccord = sel && sel.date_visee !== prevue;

  return (
    <Portal>
      {/* ⚠️ LE MODAL EST BORNÉ À L'ÉCRAN, et c'est son CORPS qui défile — pas la page.
          Sans ça, 94 lignes de sélection étirent le modal bien au-delà du viewport :
          l'en-tête part vers le haut, et il faut traverser toute la liste pour atteindre
          l'appel de test. Trois pièces indissociables : `overflow: hidden` sur le fond,
          `maxHeight: 100%` sur le cadre, et `minHeight: 0` sur le corps — sans ce dernier,
          un enfant flex refuse de rétrécir, donc de défiler. */}
      <div
        onClick={onFermer}
        style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 1000,
                 display: 'flex', alignItems: 'center', justifyContent: 'center',
                 padding: 'var(--sp-4)', overflow: 'hidden' }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{ background: 'var(--bg)', borderRadius: 'var(--r-lg)', width: '100%',
                   maxWidth: 960, maxHeight: '100%', display: 'flex',
                   flexDirection: 'column', overflow: 'hidden' }}
        >
          {/* ── En-tête ───────────────────────────────────────────────────── */}
          <div style={{ flexShrink: 0, padding: 'var(--sp-4) var(--sp-5)',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
            <div style={{ flexGrow: 1 }}>
              <h3 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800 }}>
                Tester l’étape {rail.libelle}
              </h3>
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginTop: 2 }}>
                {rail.titre} · écart {ecart} jour{ecart === 1 ? '' : 's'} sur l’échéance
                {sel && <> · date interrogée <strong>{formatDateLongue(sel.date_visee)}</strong></>}
              </p>
            </div>
            <button onClick={onFermer} title="Fermer"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}>
              <X size={20} />
            </button>
          </div>

          {/* Le seul element qui defile. */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto',
                        padding: 'var(--sp-4) var(--sp-5) var(--sp-5)',
                        display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>

          {desaccord && (
            <Bandeau ton="echec" titre="Désaccord sur la date visée">
              L’écran prévoyait <strong>{prevue}</strong>, le serveur a interrogé{' '}
              <strong>{sel!.date_visee}</strong>. Les deux calculs devraient concorder : à
              regarder avant de se fier aux compteurs.
            </Bandeau>
          )}

          {sel?.pause.en_pause && (
            <Bandeau ton="attente" titre="Module Recouvrement en pause">
              La sélection ci-dessous est bien celle du rail, mais <strong>aucun appel ne
              partira</strong> tant que la pause n’est pas levée.
              {sel.pause.motif && <> Motif : {sel.pause.motif}.</>}
            </Bandeau>
          )}

          {/* ── 1. La sélection ───────────────────────────────────────────── */}
          <section style={carte}>
            <EnTete
              texte="Qui serait appelé"
              action={
                <button onClick={() => void charger()} disabled={chargement} style={boutonDiscret}>
                  <RefreshCw size={13} /> {chargement ? 'lecture…' : 'relire'}
                </button>
              }
            />

            {erreurSel && <p style={{ color: 'var(--st-echec-fg)', fontSize: 'var(--fs-md)' }}>{erreurSel}</p>}

            {sel && (
              <>
                <div style={{ display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap',
                              margin: 'var(--sp-3) 0' }}>
                  <Compteur n={sel.sur_etape} libelle="sur l’étape"
                            aide="Population de l'étape, dossiers résolus INCLUS — comme la tuile du parcours." />
                  <Compteur n={sel.actifs} libelle="encore dans le parcours" />
                  <Compteur n={sel.appelables} libelle="appelables" ton="ok" />
                  <Compteur n={sel.au_prochain_passage} libelle="au prochain passage"
                            aide={`Le cron prend au plus ${sel.reglages.appels_par_passage} appels par passage : c'est un débit, pas une éligibilité.`} />
                </div>

                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginBottom: 'var(--sp-3)' }}>
                  Réglages appliqués : plafond {sel.reglages.plafond_tentatives} tentatives ·
                  délai {sel.reglages.delai_rappel_minutes} min · {sel.reglages.appels_par_passage} appels
                  par passage.
                </p>

                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap',
                              marginBottom: 'var(--sp-3)' }}>
                  {sel.par_verdict.map(v => (
                    <Chip key={v.verdict} texte={`${v.n} · ${v.verdict}`} ton={tonVerdict(v.verdict)} />
                  ))}
                </div>

                <DataTable
                  hauteurMax="38vh"
                  colonnes={['Verdict', 'Dossier', 'Téléphone', 'Statut', 'Tent.', 'SMS', 'Mail', 'Dernier appel', '']}
                  vide={sel.lignes.length === 0 ? 'Aucun dossier sur cette étape aujourd’hui.' : undefined}
                >
                  {sel.lignes.map(l => (
                    <tr key={l.id}>
                      <td style={tdStyle}><Chip texte={l.verdict} ton={tonVerdict(l.verdict)} /></td>
                      <td style={tdStyle}>
                        {[l.prenom, l.nom].filter(Boolean).join(' ') || '—'}
                        {!l.suivi_orthop && (
                          <span title="Aucun numéro de prescription ORTHOP : ce dossier ne pourra jamais être déclaré résolu."
                                style={{ color: 'var(--muted)', fontSize: 'var(--fs-xs)' }}> · hors ORTHOP</span>
                        )}
                      </td>
                      <td style={tdDiscret}>{l.telephone || '—'}</td>
                      <td style={tdDiscret}>{l.statut || '—'}</td>
                      <td style={tdDiscret}>{l.nb_tentatives}</td>
                      <td style={tdDiscret}>{l.sms_statut || '—'}</td>
                      <td style={tdDiscret}>{l.email_statut || '—'}</td>
                      <td style={tdDiscret}>{l.dernier_appel ? formatDateTime(l.dernier_appel) : '—'}</td>
                      {/*
                        Reprendre l'identité de ce dossier pour l'appel de test.
                        ⚠️ Le TÉLÉPHONE n'est PAS recopié — c'est celui d'une patiente, et
                        le serveur le refuserait de toute façon. On entend donc ce que CE
                        dossier entendrait, sur son propre numéro à soi.
                        ⚠️ L'échéance vient de `sel.date_visee` et non d'une colonne : par
                        construction, toutes les lignes d'une étape la partagent.
                      */}
                      <td style={tdDiscret}>
                        <button
                          onClick={() => {
                            setPrenom(l.prenom || '');
                            setNom(l.nom || '');
                            setDateTouchee(false);
                            setDateEch(sel.date_visee);
                          }}
                          title="Reprendre le prénom, le nom et l’échéance de ce dossier — sans son numéro"
                          style={boutonDiscret}
                        >
                          reprendre
                        </button>
                      </td>
                    </tr>
                  ))}
                </DataTable>

                {sel.tronque && (
                  <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 'var(--sp-2)' }}>
                    Liste tronquée à 200 lignes ; les compteurs ci-dessus portent sur l’étape entière.
                  </p>
                )}
              </>
            )}
          </section>

          {/* ── 2. L'appel de test ────────────────────────────────────────── */}
          <section style={carte}>
            <EnTete texte="Entendre l’appel" />

            {!testableParAppel ? (
              <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-2)', lineHeight: 1.55 }}>
                Cette étape n’a pas d’agent vocal dédié : il n’y a donc pas d’appel à écouter.
                La sélection ci-dessus reste mesurable, ce qui permet de jauger l’étape
                <em> avant </em>de la construire.
              </p>
            ) : (
              <>
                <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-2)', lineHeight: 1.55,
                            marginBottom: 'var(--sp-3)' }}>
                  Un appel réel est passé avec l’agent de cette étape, vers le numéro que vous
                  indiquez. <strong>L’appel seul n’écrit rien et n’envoie rien</strong> : aucune
                  ligne de relance ne portant cet appel, le post-call s’arrête de lui-même — ni
                  SMS, ni mail, ni statut, ni journal. Les écrits, eux, se demandent
                  explicitement ci-dessous.
                </p>

                {/* ── Ce que l'agent doit croire du dossier ─────────────────── */}
                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap',
                              alignItems: 'flex-end', marginBottom: 'var(--sp-3)' }}>
                  <label style={etiquette}>
                    Prénom annoncé
                    <input value={prenom} onChange={e => setPrenom(e.target.value)}
                           placeholder="Madame" style={{ ...champ, minWidth: 130 }} />
                  </label>
                  <label style={etiquette}>
                    Nom annoncé
                    <input value={nom} onChange={e => setNom(e.target.value)}
                           placeholder="Test" style={{ ...champ, minWidth: 130 }} />
                  </label>
                  <label style={etiquette}>
                    Échéance annoncée
                    <input type="date" value={dateEch}
                           onChange={e => { setDateTouchee(true); setDateEch(e.target.value); }}
                           style={{ ...champ, minWidth: 150 }} />
                  </label>
                  {mailEnProd && (
                    <label style={etiquette}>
                      Votre adresse (pour le mail)
                      <input value={email} onChange={e => setEmail(e.target.value)}
                             placeholder="vous@exemple.fr" style={{ ...champ, minWidth: 210 }} />
                    </label>
                  )}
                  {dateTouchee && sel && dateEch !== sel.date_visee && (
                    <button onClick={() => { setDateTouchee(false); setDateEch(sel.date_visee); }}
                            style={{ ...boutonDiscret, marginBottom: 2 }}
                            title={`Revenir à la date de l’étape (${sel.date_visee})`}>
                      revenir à l’étape
                    </button>
                  )}
                </div>
                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)',
                            marginBottom: 'var(--sp-3)', lineHeight: 1.5 }}>
                  Laissés vides, l’agent dit « Madame Test » et annonce la date de l’étape.
                  Le bouton <strong>« reprendre »</strong> d’une ligne du tableau ci-dessus
                  recopie l’identité et l’échéance de ce dossier — l’appel part toujours
                  vers <em>votre</em> numéro.
                </p>

                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap',
                              alignItems: 'center' }}>
                  <input
                    value={tel}
                    onChange={e => setTel(e.target.value)}
                    placeholder="Votre numéro (06…)"
                    style={{ padding: '8px var(--sp-3)', borderRadius: 'var(--r-md)',
                             border: '1px solid var(--border)', fontSize: 'var(--fs-md)', minWidth: 200 }}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
                                  fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
                    <input type="checkbox" checked={confirme}
                           onChange={e => setConfirme(e.target.checked)} />
                    Ce numéro est le mien
                  </label>
                  <button
                    onClick={() => void lancerAppel()}
                    disabled={!confirme || tel.trim().length < 6 || appelEnCours}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
                      padding: '9px var(--sp-4)', borderRadius: 'var(--r-md)', border: 'none',
                      fontWeight: 700, fontSize: 'var(--fs-md)',
                      cursor: !confirme || appelEnCours ? 'not-allowed' : 'pointer',
                      background: !confirme || appelEnCours ? 'var(--st-neutre-bg)' : 'var(--blue)',
                      color: !confirme || appelEnCours ? 'var(--muted)' : '#fff',
                    }}
                  >
                    <Phone size={15} /> {appelEnCours ? 'appel en cours…' : 'Appeler pour tester'}
                  </button>
                </div>

                {/* ── Les écrits : le SMS et le mail que la production envoie après ── */}
                <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap',
                              alignItems: 'center', marginTop: 'var(--sp-3)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
                                  fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
                    <input type="checkbox" checked={avecEcrits}
                           onChange={e => setAvecEcrits(e.target.checked)} />
                    Envoyer aussi le SMS{mailEnProd ? ' et le mail' : ''} après l’appel
                  </label>
                  <button
                    onClick={() => void lancerEcrits()}
                    disabled={!confirme || tel.trim().length < 6 || envoiEnCours}
                    title="Envoie les écrits seuls, sans passer d’appel — pour relire le texte du SMS et le rendu du mail"
                    style={{ ...boutonDiscret, opacity: !confirme || envoiEnCours ? 0.5 : 1 }}
                  >
                    {envoiEnCours ? 'envoi…' : 'Envoyer les écrits sans appeler'}
                  </button>
                </div>
                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)',
                            marginTop: 'var(--sp-2)', lineHeight: 1.5 }}>
                  Ce sont de <strong>vrais envois</strong>, facturés par Brevo — mais ils ne
                  touchent aucune ligne de relance : le SMS part sans demande de rapport de
                  livraison, et le tag du mail est inconnu du suivi.
                  {!mailEnProd && ' Cette étape n’envoie pas de mail en production : seul le SMS partira.'}
                </p>

                {erreurEnvoi && (
                  <Bandeau ton="echec" titre="Envoi refusé">
                    {erreurEnvoi}
                    {envoi?.dossiers?.length ? (
                      <ul style={{ margin: 'var(--sp-2) 0 0', paddingLeft: 18 }}>
                        {envoi.dossiers.map(d => (
                          <li key={d.id}>#{d.id} — {d.qui || 'sans nom'} (échéance {d.echeance})</li>
                        ))}
                      </ul>
                    ) : null}
                  </Bandeau>
                )}

                {envoi && !envoi.dossiers?.length && (
                  <div style={{ marginTop: 'var(--sp-3)' }}>
                    <Bandeau ton={envoi.sms.envoye ? 'ok' : 'attente'} titre="Écrits">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span>
                          <strong>SMS</strong> — {envoi.sms.envoye
                            ? `parti vers ${envoi.sms.vers}`
                            : `NON parti : ${envoi.sms.erreur}`}
                        </span>
                        <span>
                          <strong>Mail</strong> — {envoi.mail.envoye
                            ? `parti vers ${envoi.mail.vers} (modèle ${envoi.mail.modele})`
                            : (envoi.mail.raison || `NON parti : ${envoi.mail.erreur}`)}
                        </span>
                      </div>
                      {/* Le texte exact parti, à relire mot pour mot : c'est la seule
                          facon de verifier qu'il n'a pas divergé de la production. */}
                      <pre style={{
                        margin: 'var(--sp-2) 0 0', padding: 'var(--sp-2)',
                        background: 'var(--st-neutre-bg)', borderRadius: 'var(--r-sm)',
                        fontSize: 'var(--fs-xs)', whiteSpace: 'pre-wrap', fontFamily: 'inherit',
                      }}>{envoi.sms.contenu}</pre>
                    </Bandeau>
                  </div>
                )}

                {erreurAppel && (
                  <Bandeau ton="echec" titre="Appel refusé">
                    {erreurAppel}
                    {appel?.dossiers?.length ? (
                      <ul style={{ margin: 'var(--sp-2) 0 0', paddingLeft: 18 }}>
                        {appel.dossiers.map(d => (
                          <li key={d.id}>#{d.id} — {d.qui || 'sans nom'} (échéance {d.echeance})</li>
                        ))}
                      </ul>
                    ) : null}
                  </Bandeau>
                )}

                {appel?.conversation_id && (
                  <div style={{ marginTop: 'var(--sp-3)' }}>
                    <Bandeau ton="ok" titre="Appel lancé">
                      Agent : {appel.agent}. Échéance annoncée :{' '}
                      <strong>{appel.date_echeance_annoncee}</strong>. {appel.sans_effet}
                    </Bandeau>
                    <button onClick={() => void relire()} disabled={trEnCours}
                            style={{ ...boutonDiscret, marginTop: 'var(--sp-2)' }}>
                      <RefreshCw size={13} /> {trEnCours ? 'lecture…' : 'Relire le transcript'}
                    </button>
                    <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 4 }}>
                      À faire une fois l’appel terminé : la conversation n’apparaît chez
                      ElevenLabs qu’après analyse, comptez quelques dizaines de secondes.
                    </p>
                  </div>
                )}
              </>
            )}
          </section>

          {/* ── 3. Le transcript ──────────────────────────────────────────── */}
          {(tr || erreurTr) && (
            <section style={carte}>
              <EnTete texte="Ce que l’agent a réellement dit" />
              {erreurTr && <p style={{ color: 'var(--st-attente-fg)', fontSize: 'var(--fs-md)' }}>{erreurTr}</p>}
              {tr && (
                <>
                  <Bandeau ton={tr.accueil_seul ? 'echec' : (tr.message_principal_detecte ? 'ok' : 'attente')}
                           titre={tr.accueil_seul ? 'Seul l’accueil a été dit' : 'Verdict du test'}>
                    {tr.verdict_test}
                  </Bandeau>

                  <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap',
                                margin: 'var(--sp-3) 0' }}>
                    <Chip texte={`${tr.duree_sec} s`} ton="neutre" />
                    <Chip texte={`${tr.tours_agent} tour(s) agent`} ton="neutre" />
                    <Chip texte={`${tr.tours_interlocuteur} tour(s) interlocuteur`} ton="neutre" />
                    <Chip texte={`repères ${tr.reperes_trouves}`} ton="neutre" />
                    {tr.detection_repondeur && <Chip texte="répondeur détecté par EL" ton="encours" />}
                    {tr.raison_fin && <Chip texte={`fin : ${tr.raison_fin}`} ton="neutre" />}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)',
                                maxHeight: 320, overflowY: 'auto' }}>
                    {tr.transcript.map((t, i) => (
                      <div key={i} style={{
                        alignSelf: t.qui === 'Amelie' ? 'flex-start' : 'flex-end',
                        maxWidth: '85%', padding: '8px var(--sp-3)',
                        borderRadius: 'var(--r-md)', fontSize: 'var(--fs-md)', lineHeight: 1.5,
                        background: t.qui === 'Amelie' ? 'var(--blue-faint)' : 'var(--st-neutre-bg)',
                        color: 'var(--text)',
                      }}>
                        <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--muted)',
                                       display: 'block', marginBottom: 2 }}>{t.qui}</span>
                        {t.texte}
                      </div>
                    ))}
                  </div>

                  <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)',
                              marginTop: 'var(--sp-3)', lineHeight: 1.5 }}>
                    {tr.note}
                  </p>
                </>
              )}
            </section>
          )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

/* ── Petits éléments locaux ─────────────────────────────────────────────── */

const boutonDiscret: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)',
  padding: '5px var(--sp-3)', borderRadius: 'var(--r-md)',
  border: '1px solid var(--border)', background: 'var(--surface)',
  color: 'var(--text-2)', fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'pointer',
};

function EnTete({ texte, action }: { texte: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
                  marginBottom: 'var(--sp-2)' }}>
      <div style={{ flexGrow: 1, fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--muted)',
                    textTransform: 'uppercase', letterSpacing: '.3px' }}>{texte}</div>
      {action}
    </div>
  );
}

function Compteur({ n, libelle, ton, aide }: { n: number; libelle: string; ton?: Ton; aide?: string }) {
  return (
    <div title={aide} style={{ cursor: aide ? 'help' : undefined }}>
      <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800,
                    color: ton ? `var(--st-${ton}-fg)` : 'var(--text)' }}>{n}</div>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)',
                    borderBottom: aide ? '1px dotted var(--muted-light)' : undefined,
                    display: 'inline-block' }}>{libelle}</div>
    </div>
  );
}

function Bandeau({ ton, titre, children }: { ton: Ton; titre: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--sp-2)', padding: 'var(--sp-3)',
                  borderRadius: 'var(--r-md)', background: `var(--st-${ton}-bg)`,
                  borderLeft: `3px solid var(--st-${ton}-fg)`, fontSize: 'var(--fs-md)',
                  color: 'var(--text-2)', lineHeight: 1.55 }}>
      <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2, color: `var(--st-${ton}-fg)` }} />
      <div>
        <strong style={{ color: `var(--st-${ton}-fg)` }}>{titre}</strong> — {children}
      </div>
    </div>
  );
}
