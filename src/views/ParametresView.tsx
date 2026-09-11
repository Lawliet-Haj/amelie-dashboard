/**
 * PARAMÈTRES — les réglages d'exploitation, modifiables sans passer par n8n.
 *
 * ⚠️⚠️ RÈGLE DE L'ÉCRAN : on n'affiche QUE des paramètres réellement câblés. Montrer
 * « Appels par passage : 10 » alors que la valeur resterait écrite en dur dans le workflow
 * serait un mensonge dans l'interface — pire qu'une absence d'écran. Chaque ligne ci-dessous
 * est lue par un cron, et le lien est indiqué.
 *
 * ⚠️ Le périmètre vient du serveur (colonne `module`), pas d'une liste écrite ici. Un
 * paramètre hors périmètre s'affiche en lecture seule, et le serveur le refuserait de toute
 * façon : le masquage n'est PAS la sécurité.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Check, X, SlidersHorizontal, Info } from 'lucide-react';
import type { AuthUser } from '../types';
import { Chip } from '../ui';
import { formatDateTime } from '../lib/format';
import {
  lireReglages, reglerReglage, peutRegler, type Reglage,
} from '../lib/reglages';

/** Où chaque paramètre agit réellement. Sert à justifier sa présence à l'écran. */
const OU_CA_AGIT: Record<string, string> = {
  seuil_sms_brevo: 'Cron « Alerte Crédits Brevo », tous les jours à 8h30',
  seuil_mail_brevo: 'Cron « Alerte Crédits Brevo », tous les jours à 8h30',
  alerte_destinataire: 'Destinataire de l’alerte de crédits uniquement',
  /*
   * ⚠️ LA CADENCE D'APPELS EST RÉGLABLE PAR RAIL depuis le 2026-09-11. Chaque cron lit
   * d'abord SA clé, puis retombe sur `appels_par_passage`, puis sur 10 — une cascade de
   * `COALESCE` en SQL, jamais une expression n8n (qui rendrait vide et produirait une
   * requête invalide, donc zéro appel en silence).
   * Les trois niveaux ont été éprouvés en base : clé propre, clé absente, table vide.
   */
  appels_par_passage_j1: 'LIMIT du cron J+1 (12h30 → 13h55, toutes les 5 min)',
  appels_par_passage_j7: 'LIMIT du cron J+7 (15h30 → 16h55, toutes les 5 min)',
  appels_par_passage: 'Repli, pour un rail qui n’a pas son propre réglage',
  plafond_tentatives: 'Sélection d’appels des deux crons Recouvrement',
  delai_rappel_minutes: 'Sélection d’appels des deux crons Recouvrement',
  recouvrement: 'Coupe les appels et le repli SMS+mail du cron Recouvrement',
  facturation: 'Coupe les envois SMS et mail du cron Facturation',
};

export function ParametresView({ user }: { user: AuthUser }) {
  const [reglages, setReglages] = useState<Reglage[] | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [brouillons, setBrouillons] = useState<Record<string, string>>({});
  const [enregistre, setEnregistre] = useState<Record<string, 'ok' | 'ko'>>({});
  const [enCours, setEnCours] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setChargement(true);
    const r = await lireReglages(user.token);
    setChargement(false);
    if (r.ok) { setReglages(r.reglages); setErreur(''); setBrouillons({}); }
    else { setReglages(null); setErreur(r.erreur || 'lecture impossible'); }
  }, [user.token]);

  useEffect(() => { charger(); }, [charger]);

  // Les interrupteurs se pilotent depuis les écrans Recouvrement et Facturation, où le
  // contexte est visible. Ici on les montre en lecture seule, pour que l'état soit lisible
  // d'un coup d'œil sans avoir à ouvrir les deux modules.
  const valeurs = useMemo(() => (reglages || []).filter(r => r.type !== 'bool'), [reglages]);
  const interrupteurs = useMemo(() => (reglages || []).filter(r => r.type === 'bool'), [reglages]);

  const enregistrer = async (r: Reglage) => {
    const brouillon = (brouillons[r.cle] ?? r.valeur).trim();
    if (brouillon === r.valeur) return;
    setEnCours(r.cle);
    const res = await reglerReglage(user.token, r.cle, brouillon);
    setEnCours(null);
    if (!res.ok) {
      setEnregistre(e => ({ ...e, [r.cle]: 'ko' }));
      setErreur(`${r.libelle} — ${res.erreur || 'refusé'}`);
      return;
    }
    // ⚠️ On adopte la ligne RENVOYÉE par le serveur, pas le brouillon : c'est la seule
    // preuve que la valeur est bien entrée en base.
    const maj = res.reglages[0];
    setReglages(prev => (prev || []).map(x => (x.cle === maj.cle ? maj : x)));
    setBrouillons(b => { const c = { ...b }; delete c[r.cle]; return c; });
    setEnregistre(e => ({ ...e, [r.cle]: 'ok' }));
    setErreur('');
    setTimeout(() => setEnregistre(e => { const c = { ...e }; delete c[r.cle]; return c; }), 2500);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-4)',
                    flexWrap: 'wrap', marginBottom: 'var(--sp-4)' }}>
        <div style={{ flexGrow: 1, minWidth: 260 }}>
          {/*
            ⚠️ PAS DE TITRE ICI : `App` affiche déjà « Paramètres » et la date dans son
            en-tête de page. En remettre un donnait le titre EN DOUBLE à l'écran — le
            même défaut qu'avait eu Facturation. Une vue de module donne une ligne de
            contexte, jamais son titre. Son bouton « Actualiser » reste ici, lui, parce
            que c'est le seul qui recharge vraiment les réglages : l'en-tête n'en affiche
            plus (voir `enteteActualise` dans App.tsx).
          */}
          <p style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)' }}>
            Les réglages que les automatisations lisent à chaque passage. Une modification
            prend effet au passage suivant, sans redémarrage.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={charger} disabled={chargement}>
          <RefreshCw size={14} className={chargement ? 'animate-spin' : ''} /> Actualiser
        </button>
      </div>

      {erreur && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
          padding: 'var(--sp-3)', marginBottom: 'var(--sp-3)', borderRadius: 'var(--r-md)',
          background: 'var(--st-echec-bg)', border: '1px solid var(--st-echec-bd)',
          fontSize: 'var(--fs-md)', color: 'var(--st-echec-fg)',
        }}>
          <X size={15} /> {erreur}
        </div>
      )}

      {chargement && !reglages && (
        <p style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)' }}>Chargement…</p>
      )}

      {/* ── Les valeurs réglables ───────────────────────────────────────────── */}
      {valeurs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)',
                      marginBottom: 'var(--sp-5)' }}>
          {valeurs.map(r => {
            const modifiable = peutRegler(r, user.role);
            const brouillon = brouillons[r.cle] ?? r.valeur;
            const change = brouillon.trim() !== r.valeur;
            const etat = enregistre[r.cle];
            return (
              <div key={r.cle} style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-lg)', padding: 'var(--sp-4)',
                display: 'flex', gap: 'var(--sp-4)', alignItems: 'flex-start', flexWrap: 'wrap',
              }}>
                <div style={{ flexGrow: 1, minWidth: 240 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
                                flexWrap: 'wrap', marginBottom: 2 }}>
                    <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 700 }}>{r.libelle}</span>
                    {r.module
                      ? <Chip texte={r.module} ton="encours" />
                      : <Chip texte="administrateur" ton="neutre"
                              titre="Paramètre global : réservé au rôle admin" />}
                    {!modifiable && <Chip texte="lecture seule" ton="attente"
                                          titre="Hors de votre périmètre — le serveur refuserait la modification" />}
                  </div>
                  {r.aide && (
                    <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', lineHeight: 1.5 }}>
                      {r.aide}
                    </p>
                  )}
                  <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted-light)', marginTop: 4,
                              display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Info size={11} />
                    {OU_CA_AGIT[r.cle] || 'lu par les automatisations'}
                    {r.mini != null && r.maxi != null && <> · entre {r.mini} et {r.maxi}</>}
                    {r.modifie_par && <> · modifié par {r.modifie_par}
                      {r.modifie_le && <> le {formatDateTime(r.modifie_le)}</>}</>}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  <input
                    value={brouillon}
                    disabled={!modifiable || enCours === r.cle}
                    onChange={e => setBrouillons(b => ({ ...b, [r.cle]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter' && change) enregistrer(r); }}
                    inputMode={r.type === 'nombre' ? 'numeric' : 'text'}
                    style={{
                      width: r.type === 'nombre' ? 110 : 260,
                      padding: '7px 10px', borderRadius: 'var(--r-sm)',
                      border: `1px solid ${change ? 'var(--blue)' : 'var(--border)'}`,
                      fontSize: 'var(--fs-md)', fontFamily: 'inherit', textAlign: r.type === 'nombre' ? 'right' : 'left',
                      color: modifiable ? 'var(--text)' : 'var(--muted)',
                      background: modifiable ? 'white' : 'var(--st-neutre-bg)',
                      outline: 'none',
                    }}
                  />
                  {r.unite && (
                    <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', minWidth: 56 }}>
                      {r.unite}
                    </span>
                  )}
                  <button
                    onClick={() => enregistrer(r)}
                    disabled={!modifiable || !change || enCours === r.cle}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '7px 13px', borderRadius: 'var(--r-md)', border: 'none',
                      fontSize: 'var(--fs-sm)', fontWeight: 700, fontFamily: 'Lexend,sans-serif',
                      cursor: !modifiable || !change ? 'not-allowed' : 'pointer',
                      background: etat === 'ok' ? 'var(--st-ok-fg)'
                        : etat === 'ko' ? 'var(--st-echec-fg)'
                        : change ? 'var(--blue)' : 'var(--st-neutre-bg)',
                      color: etat || change ? '#fff' : 'var(--muted)',
                    }}>
                    {etat === 'ok' ? <><Check size={13} /> Enregistré</>
                      : etat === 'ko' ? <><X size={13} /> Refusé</>
                      : enCours === r.cle ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Les interrupteurs, en lecture seule ─────────────────────────────── */}
      {interrupteurs.length > 0 && (
        <section style={{
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)', padding: 'var(--sp-4)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
                        marginBottom: 'var(--sp-3)' }}>
            <SlidersHorizontal size={15} color="var(--muted)" />
            <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--muted)',
                           textTransform: 'uppercase', letterSpacing: '.3px' }}>
              Interrupteurs de pause
            </span>
          </div>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', lineHeight: 1.5,
                      marginBottom: 'var(--sp-3)' }}>
            Ils se pilotent depuis les écrans <strong>Recouvrement</strong> et{' '}
            <strong>Facturation</strong>, où l’on voit ce qu’on arrête. Rappel : une pause
            coupe les envois <strong>automatiques</strong> et jamais l’extraction — les
            listes continuent de se remplir.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {interrupteurs.map(r => (
              <div key={r.cle} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
                                        flexWrap: 'wrap' }}>
                <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600, minWidth: 180 }}>
                  {r.libelle}
                </span>
                <Chip texte={r.en_pause ? 'en pause' : 'en service'}
                      ton={r.en_pause ? 'attente' : 'ok'} />
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
                  {r.en_pause && r.motif && <>motif : <em>{r.motif}</em> · </>}
                  {r.modifie_par && <>par {r.modifie_par}</>}
                  {r.modifie_le && <> le {formatDateTime(r.modifie_le)}</>}
                </span>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted-light)',
                               marginLeft: 'auto' }}>
                  {OU_CA_AGIT[r.cle] || ''}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
