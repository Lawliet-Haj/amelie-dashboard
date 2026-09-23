import { useState } from 'react';
import { X, Plus, Trash2, RefreshCw, Send, AlertCircle, CheckCircle, ClipboardPaste, UserPlus, BookOpen } from 'lucide-react';
import type { Palier } from '../types';
import { Chip, Portal } from '../ui';
import { PALIERS, palierConf } from '../lib/paliers';
import { aujourdhuiIso, decalerJours, ecartJours, formatDate, isFixe } from '../lib/format';
import {
  verifierLignes, apercusMessages, ajouterLignes, envoyerIds, lignesDepuisCollage, cleMessage,
  type LigneSaisie, type LigneVerifiee, type Apercu, type ResultatAjout,
} from '../lib/envoiManuel';
import type { ResultatEnvoi } from './FacturationView';

/**
 * ENVOYER À LA MAIN LE SMS J-30 OU J-15 — à plusieurs patientes d'un coup (2026-09-23).
 *
 * Pour une patiente que les listes ORTHOP n'ont pas ramenée (le « mur » des lots, une
 * extraction manquée, un signalement par téléphone). Trois temps, et l'écran ne passe à
 * l'étape suivante que sur la réponse du serveur :
 *
 *   1. SAISIR    une ligne par patiente — ou coller directement des lignes d'Excel
 *   2. VÉRIFIER  chaque ligne est contrôlée, et le TEXTE EXACT de chaque SMS est affiché
 *   3. ENVOYER   les lignes prêtes sont ajoutées à la liste, puis leur SMS part
 *
 * ⚠️ Modifier une ligne après vérification ANNULE la vérification : on ne peut pas envoyer
 * quelque chose que le serveur n'a pas vu.
 * ⚠️ Les patientes ajoutées entrent dans la liste Facturation (lot « Ajout manuel … ») :
 * leur SMS y est suivi comme les autres (livré, non livré).
 */

/** Au-delà de ce nombre, une case à cocher est exigée en plus du clic — comme l'envoi de masse. */
const SEUIL_CONFIRMATION = 20;
/** Plafond du serveur par envoi. */
const MAX_LIGNES = 50;

type Ligne = LigneSaisie & { cle: number };
type Etat = 'saisie' | 'verification' | 'verifie' | 'envoi' | 'fini';

let prochaineCle = 1;
const ligneVide = (fin: string): Ligne => ({ cle: prochaineCle++, nom: '', prenom: '', telephone: '', fin });
const estVide = (l: LigneSaisie) => !l.nom.trim() && !l.prenom.trim() && !l.telephone.trim();

const champ: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 7,
  border: '1px solid var(--border)', fontSize: 12.5, fontFamily: 'inherit', color: 'var(--text)', background: 'white',
};

export function EnvoiManuelModal({ token, palierInitial, onClose, onFini }: {
  token: string;
  palierInitial: Palier;
  onClose: () => void;
  /** Appelé après un envoi, pour recharger la liste. */
  onFini: () => void;
}) {
  const ajd = aujourdhuiIso();
  const [palier, setPalier] = useState<Palier>(palierInitial);
  const conf = palierConf(palier);
  const finParDefaut = (p: Palier) => decalerJours(ajd, palierConf(p).jours);
  const [lignes, setLignes] = useState<Ligne[]>(() => [ligneVide(finParDefaut(palierInitial))]);
  const [etat, setEtat] = useState<Etat>('saisie');
  const [erreur, setErreur] = useState<string | null>(null);
  /** Le verdict du serveur, par clé de ligne. Vidé dès qu'on modifie la saisie. */
  const [verdicts, setVerdicts] = useState<Map<number, LigneVerifiee> | null>(null);
  const [apercus, setApercus] = useState<Map<string, Apercu>>(new Map());
  const [coche, setCoche] = useState(false);
  const [resultat, setResultat] = useState<{ ajout: ResultatAjout | null; envoi: ResultatEnvoi | null; erreur: string | null } | null>(null);

  const occupe = etat === 'verification' || etat === 'envoi';
  const remplies = lignes.filter(l => !estVide(l));

  /** Toute modification rend la vérification caduque. */
  const invalider = () => {
    if (verdicts) { setVerdicts(null); setApercus(new Map()); setCoche(false); }
    if (etat === 'verifie') setEtat('saisie');
    setErreur(null);
  };
  const maj = (cle: number, champNom: keyof LigneSaisie, v: string) => {
    invalider();
    setLignes(ls => ls.map(l => (l.cle === cle ? { ...l, [champNom]: v } : l)));
  };
  const ajouterLigne = () => { invalider(); setLignes(ls => ls.length >= MAX_LIGNES ? ls : [...ls, ligneVide(finParDefaut(palier))]); };
  const retirer = (cle: number) => {
    invalider();
    setLignes(ls => { const r = ls.filter(l => l.cle !== cle); return r.length ? r : [ligneVide(finParDefaut(palier))]; });
  };
  const changerPalier = (p: Palier) => {
    if (p === palier) return;
    invalider();
    // La date proposée suit le palier ; une date déjà modifiée à la main est respectée.
    const ancien = finParDefaut(palier), nouveau = finParDefaut(p);
    setLignes(ls => ls.map(l => (l.fin === ancien ? { ...l, fin: nouveau } : l)));
    setPalier(p);
  };

  /**
   * Coller des lignes copiées dans Excel, dans n'importe quelle case. La ligne où l'on
   * colle est remplacée si elle est vide ; les suivantes sont insérées juste après.
   */
  const coller = (cle: number, texte: string) => {
    const lues = lignesDepuisCollage(texte);
    if (lues.length === 0) return false;
    invalider();
    setLignes(ls => {
      const i = ls.findIndex(l => l.cle === cle);
      const nouvelles = lues.map(l => ({ ...l, cle: prochaineCle++, fin: l.fin || finParDefaut(palier) }));
      const avant = ls.slice(0, i), apres = ls.slice(i + 1);
      const ici = ls[i] && !estVide(ls[i]) ? [ls[i]] : [];
      return [...avant, ...ici, ...nouvelles, ...apres].slice(0, MAX_LIGNES);
    });
    return true;
  };
  const surCollage = (cle: number) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const t = e.clipboardData.getData('text');
    // Une seule valeur collée dans une case : comportement normal du navigateur.
    if (!/[\t\n;]/.test(t.trim())) return;
    if (coller(cle, t)) e.preventDefault();
  };

  async function verifier() {
    setEtat('verification'); setErreur(null);
    const envoyees = remplies;
    const r = await verifierLignes(token, palier, envoyees);
    if (!r.ok) { setErreur(r.erreur); setEtat('saisie'); return; }
    const m = new Map<number, LigneVerifiee>();
    r.data.forEach(v => { const l = envoyees[v.idx]; if (l) m.set(l.cle, v); });
    const prets = r.data.filter(v => v.statut === 'pret');
    if (prets.length) {
      const a = await apercusMessages(token, palier, prets);
      if (!a.ok) { setErreur('Le texte du SMS n’a pas pu être affiché : ' + a.erreur + '. Rien n’a été envoyé.'); setEtat('saisie'); return; }
      setApercus(a.data);
    } else setApercus(new Map());
    setVerdicts(m);
    setCoche(false);
    setEtat('verifie');
  }

  const prets = verdicts ? remplies.filter(l => verdicts.get(l.cle)?.statut === 'pret') : [];
  const besoinCoche = prets.length > SEUIL_CONFIRMATION;
  const peutEnvoyer = etat === 'verifie' && prets.length > 0 && (!besoinCoche || coche);

  async function envoyer() {
    setEtat('envoi'); setErreur(null);
    // ⚠️ On renvoie les lignes PRÊTES telles qu'affichées : le serveur refait tous les
    // contrôles, et sa garde anti-doublon écartera une patiente ajoutée entre-temps.
    const a = await ajouterLignes(token, palier, prets);
    if (!a.ok) { setResultat({ ajout: null, envoi: null, erreur: 'Rien n’a été ajouté ni envoyé : ' + a.erreur + '.' }); setEtat('fini'); return; }
    let envoi: ResultatEnvoi | null = null, erreurEnvoi: string | null = null;
    if (a.data.ids.length) {
      const e = await envoyerIds(token, a.data.ids);
      if (e.ok) envoi = e.data; else erreurEnvoi = e.erreur;
    }
    setResultat({ ajout: a.data, envoi, erreur: erreurEnvoi });
    setEtat('fini');
    onFini();
  }

  // ── Les messages distincts, et combien de patientes reçoivent chacun ──
  const groupes = verdicts
    ? [...apercus.entries()].map(([k, a]) => ({
        cle: k, apercu: a,
        n: prets.filter(l => { const v = verdicts.get(l.cle); return v && cleMessage(palier, v) === k; }).length,
      }))
    : [];
  const nb = { pret: prets.length, existantes: 0, deja: 0, invalide: 0 };
  if (verdicts) for (const l of remplies) {
    const v = verdicts.get(l.cle), s = v?.statut;
    if (s === 'deja') nb.deja++; if (s === 'invalide') nb.invalide++; if (s === 'pret' && v?.existant) nb.existantes++;
  }

  const titreEtape = (n: number, texte: string, actif: boolean, fait: boolean) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
                   color: actif ? conf.teinte : fait ? '#15803d' : 'var(--muted)' }}>
      <span style={{ width: 20, height: 20, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                     fontSize: 11, color: 'white', background: actif ? conf.teinte : fait ? '#15803d' : '#cbd5e1' }}>{fait ? '✓' : n}</span>
      {texte}
    </span>
  );

  return (
    <Portal>
      <div className="panel-overlay animate-fade-in" onClick={occupe ? undefined : onClose} />
      <div role="dialog" aria-label="Envoyer des SMS à la main" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'white',
        borderRadius: 16, padding: 24, width: 'min(960px, calc(100vw - 32px))', maxHeight: '90vh', overflow: 'auto',
        zIndex: 1001, boxShadow: '0 20px 60px rgba(0,0,0,.15)', border: '1px solid var(--border)',
      }}>
        {/* ── En-tête ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <h2 style={{ fontFamily: 'Lexend,sans-serif', fontSize: 17, fontWeight: 800, color: 'var(--text)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserPlus size={18} style={{ color: conf.teinte }} /> Envoyer le SMS à la main
            </h2>
            <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '4px 0 0', lineHeight: 1.5 }}>
              Pour des patientes absentes des listes ORTHOP. Elles recevront <strong>le même SMS</strong> que
              l’envoi automatique, et seront ajoutées à la liste pour en suivre la livraison.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {/* Le mode opératoire COMMUN (partie 2), servi par nginx depuis `public/docs/` — chemin
                ABSOLU, l'application est une SPA. */}
            <a href="/docs/mode-op-controle-journee.html#partie-facturation" target="_blank" rel="noopener noreferrer"
              title="Comment envoyer un SMS à la main — document imprimable, s’ouvre dans un onglet"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none', padding: '4px 10px',
                       borderRadius: 'var(--r-md)', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: 12, fontWeight: 600 }}>
              <BookOpen size={13} /> Mode d’emploi
            </a>
            {!occupe && (
              <button onClick={onClose} title="Fermer" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex' }}><X size={18} /></button>
            )}
          </div>
        </div>

        {/* ── Les trois temps ── */}
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', padding: '9px 12px', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 14 }}>
          {titreEtape(1, 'Saisir ou coller les patientes', etat === 'saisie' || etat === 'verification', etat === 'verifie' || etat === 'envoi' || etat === 'fini')}
          {titreEtape(2, 'Vérifier les lignes et le message', etat === 'verifie', etat === 'envoi' || etat === 'fini')}
          {titreEtape(3, 'Envoyer', etat === 'envoi', etat === 'fini')}
        </div>

        {etat !== 'fini' && (
          <>
            {/* ── Le palier ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>Quel SMS ?</span>
              {PALIERS.map(p => {
                const on = p.id === palier;
                return (
                  <button key={p.id} onClick={() => changerPalier(p.id)} disabled={occupe}
                    style={{
                      padding: '6px 14px', borderRadius: 999, cursor: occupe ? 'default' : 'pointer', fontFamily: 'Lexend,sans-serif',
                      fontSize: 12.5, fontWeight: 800, border: '1px solid ' + (on ? p.teinte : 'var(--border)'),
                      background: on ? p.fond : 'white', color: on ? p.teinte : 'var(--muted)',
                    }}>
                    {p.label} <span style={{ fontWeight: 500 }}>· {p.id === 'J30' ? 'premier avertissement' : 'rappel'}</span>
                  </button>
                );
              })}
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                Fin de location proposée : {formatDate(finParDefaut(palier))} (aujourd’hui + {conf.jours} jours), modifiable ligne par ligne.
              </span>
            </div>

            {/* ── La saisie ── */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['', 'Nom', 'Prénom', 'Téléphone portable', 'Fin de location', verdicts ? 'Vérification' : '', ''].map((t, i) => (
                      <th key={i} style={{ textAlign: 'left', padding: '7px 8px', fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.3px' }}>{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l, i) => {
                    const v = verdicts?.get(l.cle);
                    const ecart = l.fin ? ecartJours(ajd, l.fin) : NaN;
                    const fixe = l.telephone && isFixe(l.telephone);
                    return (
                      <tr key={l.cle} style={{ borderTop: '1px solid #f1f5f9', background: v?.statut === 'invalide' ? '#fef2f2' : v?.statut === 'deja' ? '#f8fafc' : 'white' }}>
                        <td style={{ padding: '6px 8px', fontSize: 11.5, color: 'var(--muted)', width: 22 }}>{i + 1}</td>
                        <td style={{ padding: '6px 4px' }}>
                          <input aria-label={'Nom, ligne ' + (i + 1)} value={l.nom} disabled={occupe} onChange={e => maj(l.cle, 'nom', e.target.value)} onPaste={surCollage(l.cle)} style={champ} placeholder="Nom" />
                        </td>
                        <td style={{ padding: '6px 4px' }}>
                          <input aria-label={'Prénom, ligne ' + (i + 1)} value={l.prenom} disabled={occupe} onChange={e => maj(l.cle, 'prenom', e.target.value)} onPaste={surCollage(l.cle)} style={champ} placeholder="Prénom" />
                        </td>
                        <td style={{ padding: '6px 4px' }}>
                          <input aria-label={'Téléphone, ligne ' + (i + 1)} value={l.telephone} disabled={occupe} inputMode="tel" onChange={e => maj(l.cle, 'telephone', e.target.value)} onPaste={surCollage(l.cle)}
                            style={{ ...champ, borderColor: fixe ? '#fca5a5' : 'var(--border)' }} placeholder="06 12 34 56 78" />
                          {fixe && <span style={{ fontSize: 10.5, color: '#b91c1c' }}>numéro fixe : pas de SMS</span>}
                        </td>
                        <td style={{ padding: '6px 4px', whiteSpace: 'nowrap' }}>
                          <input aria-label={'Fin de location, ligne ' + (i + 1)} type="date" value={l.fin} min={ajd} disabled={occupe} onChange={e => maj(l.cle, 'fin', e.target.value)} style={{ ...champ, width: 140 }} />
                          {Number.isFinite(ecart) && (
                            <span style={{ display: 'block', fontSize: 10.5, color: ecart < 0 ? '#b91c1c' : 'var(--muted)' }}>
                              {ecart < 0 ? 'date passée' : ecart === 0 ? 'aujourd’hui' : 'dans ' + ecart + ' jour' + (ecart > 1 ? 's' : '')}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', minWidth: verdicts ? 190 : 0 }}>
                          {v && (v.statut === 'pret'
                            ? <>
                                <Chip texte={palier === 'J15' ? (v.sms1_parti ? 'Prête — RAPPEL' : 'Prête — 1er avertissement') : 'Prête'} ton="ok"
                                  titre={palier === 'J15' && !v.sms1_parti ? 'Le J-30 n’est jamais parti pour elle : elle reçoit le texte du premier avertissement' : undefined} />
                                {/* ⚠️ Déjà dans la liste, SMS pas encore parti : c'est SA ligne qui part,
                                    maintenant — l'envoi automatique ne la renverra pas. */}
                                {v.existant && (
                                  <span style={{ display: 'block', fontSize: 11, color: '#047857', marginTop: 3, lineHeight: 1.4 }}>{v.raison}</span>
                                )}
                              </>
                            : <span style={{ fontSize: 11.5, lineHeight: 1.4, color: v.statut === 'invalide' ? '#b91c1c' : 'var(--muted)', display: 'block' }}>
                                {v.statut === 'deja' ? '↷ ' : '✕ '}{v.raison}
                              </span>)}
                          {verdicts && !v && !estVide(l) && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>—</span>}
                        </td>
                        <td style={{ padding: '6px 6px', width: 30 }}>
                          <button onClick={() => retirer(l.cle)} disabled={occupe} title="Retirer cette ligne"
                            style={{ border: 'none', background: 'none', cursor: occupe ? 'default' : 'pointer', color: 'var(--muted)', display: 'flex', padding: 2 }}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '8px 2px 0' }}>
              <button onClick={ajouterLigne} disabled={occupe || lignes.length >= MAX_LIGNES} className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }}>
                <Plus size={13} /> Ajouter une ligne
              </button>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--muted)' }}>
                <ClipboardPaste size={13} /> Astuce : copiez plusieurs lignes dans Excel (nom, prénom, téléphone, fin de location) et
                collez-les dans n’importe quelle case — l’ordre des colonnes n’a pas d’importance.
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' }}>{remplies.length} / {MAX_LIGNES} lignes</span>
            </div>

            {erreur && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, marginTop: 12 }}>
                <AlertCircle size={15} style={{ color: '#b91c1c', flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 12.5, color: '#991b1b', margin: 0 }}>{erreur}</p>
              </div>
            )}

            {/* ── Ce qui partira ── */}
            {etat === 'verifie' && verdicts && (
              <div style={{ marginTop: 14 }}>
                <p style={{ fontSize: 12.5, margin: '0 0 8px', color: 'var(--text)' }}>
                  <strong>{nb.pret} prête{nb.pret > 1 ? 's' : ''}</strong>
                  {nb.existantes > 0 && <> (dont {nb.existantes} déjà dans la liste, dont le SMS part maintenant)</>}
                  {nb.deja > 0 && <> · {nb.deja} déjà dans la liste (écartée{nb.deja > 1 ? 's' : ''} : pas de second SMS)</>}
                  {nb.invalide > 0 && <> · <span style={{ color: '#b91c1c' }}>{nb.invalide} à corriger</span></>}
                </p>
                {groupes.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10 }}>
                    <AlertCircle size={15} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />
                    <p style={{ fontSize: 12.5, color: '#92400e', margin: 0 }}>Aucune ligne n’est prête : corrigez les lignes en rouge, puis vérifiez à nouveau.</p>
                  </div>
                ) : groupes.map(g => (
                  <div key={g.cle} style={{ marginBottom: 10 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '.3px' }}>
                      Le SMS qui partira — {g.n} patiente{g.n > 1 ? 's' : ''} · {g.apercu.segments} segment{g.apercu.segments > 1 ? 's' : ''}
                    </p>
                    <p style={{ fontSize: 12.5, color: 'var(--text)', margin: 0, padding: '9px 11px', background: conf.fond, border: `1px solid ${conf.bord}`, borderRadius: 8, lineHeight: 1.55 }}>
                      {g.apercu.message}
                    </p>
                  </div>
                ))}
                {besoinCoche && (
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 9, marginTop: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={coche} onChange={e => setCoche(e.target.checked)} style={{ marginTop: 2 }} />
                    <span style={{ fontSize: 12.5, color: '#991b1b' }}>Je confirme l’envoi du SMS à <strong>{prets.length} patientes</strong>. Cette action est irréversible.</span>
                  </label>
                )}
              </div>
            )}

            {etat === 'envoi' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, marginTop: 14 }}>
                <RefreshCw size={16} style={{ color: '#1d4ed8', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
                <p style={{ fontSize: 12.5, color: '#1e40af', margin: 0 }}>Ajout et envoi en cours… ne fermez pas cette fenêtre.</p>
              </div>
            )}
          </>
        )}

        {/* ── Le résultat ── */}
        {etat === 'fini' && resultat && <Resultat r={resultat} lignes={prets} />}

        {/* ── Les boutons ── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          {etat === 'fini' ? (
            <button className="btn btn-primary" onClick={onClose}>Fermer</button>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={onClose} disabled={occupe}>Annuler</button>
              {etat === 'verifie' ? (
                <button onClick={envoyer} disabled={!peutEnvoyer}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none',
                    fontSize: 13, fontWeight: 700, color: 'white', fontFamily: 'Lexend,sans-serif',
                    background: peutEnvoyer ? '#dc2626' : '#e5e7eb', cursor: peutEnvoyer ? 'pointer' : 'not-allowed',
                  }}>
                  <Send size={14} /> Envoyer {prets.length > 0 ? `${prets.length} SMS` : 'les SMS'}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={verifier} disabled={occupe || remplies.length === 0}>
                  {etat === 'verification'
                    ? <><RefreshCw size={14} style={{ animation: 'spin .8s linear infinite' }} /> Vérification…</>
                    : <><CheckCircle size={14} /> Vérifier {remplies.length > 1 ? `les ${remplies.length} lignes` : 'la ligne'}</>}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Portal>
  );
}

/** Ce qui s'est passé, ligne par ligne : ajoutée et envoyée, en échec, ou écartée. */
function Resultat({ r, lignes }: { r: { ajout: ResultatAjout | null; envoi: ResultatEnvoi | null; erreur: string | null }; lignes: Ligne[] }) {
  if (!r.ajout) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10 }}>
        <AlertCircle size={15} style={{ color: '#b91c1c', flexShrink: 0, marginTop: 1 }} />
        <p style={{ fontSize: 12.5, color: '#991b1b', margin: 0 }}>{r.erreur}</p>
      </div>
    );
  }
  const statutEnvoi = new Map((r.envoi?.details ?? []).map(d => [d.id, d.statut]));
  const ecartes = new Map((r.envoi?.detail_ignores ?? []).map(d => [d.id, d.raison]));
  const envoyes = r.envoi?.envoyes ?? 0, echecs = r.envoi?.echecs ?? 0;
  const nonAjoutees = r.ajout.lignes.filter(l => l.statut === 'non_ajoutee').length;
  return (
    <div>
      {r.erreur ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, marginBottom: 12 }}>
          <AlertCircle size={15} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 12.5, color: '#92400e', margin: 0, lineHeight: 1.55 }}>
            <strong>Les patientes ont été ajoutées, mais l’envoi n’a pas abouti</strong> ({r.erreur}). Elles
            apparaissent « À envoyer » dans leur échéance : utilisez le bouton SMS de l’échéance, ou elles
            partiront au prochain passage automatique (12h30 – 14h30). Aucun SMS ne peut partir deux fois.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 14px', background: echecs ? '#fffbeb' : '#f0fdf4', border: '1px solid ' + (echecs ? '#fde68a' : '#86efac'), borderRadius: 10, marginBottom: 12 }}>
          <CheckCircle size={16} style={{ color: echecs ? '#b45309' : '#15803d', flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 13, color: echecs ? '#92400e' : '#15803d', margin: 0, lineHeight: 1.55 }}>
            <strong>{envoyes} SMS envoyé{envoyes > 1 ? 's' : ''}</strong>
            {echecs > 0 && <> · {echecs} en échec</>}
            {nonAjoutees > 0 && <> · {nonAjoutees} non ajoutée{nonAjoutees > 1 ? 's' : ''}</>}.
            {' '}Elles sont dans la liste, lot « {r.ajout.batch_label} » : la livraison s’y met à jour dans les minutes qui suivent.
          </p>
        </div>
      )}
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {r.ajout.lignes.map((la, i) => {
          const l = lignes[la.idx];
          const s = la.id ? statutEnvoi.get(la.id) : undefined;
          const deja = la.statut === 'existante';
          // Une ligne sans trace dans le rapport d'envoi, hors écart : son SMS est parti ENTRE
          // la vérification et le clic (envoi automatique) — la garde `sms_statut IS NULL`
          // l'a écartée, et c'est exactement ce qu'on veut : pas de second SMS.
          const txt = !la.id ? '✕ Non ajoutée — ' + (la.raison || 'déjà dans la liste')
            : s === 'envoye' ? (deja ? '✓ SMS envoyé — elle était déjà dans la liste' : '✓ SMS envoyé')
            : s === 'echec_envoi' ? (deja ? '✕ L’envoi a échoué' : '✕ Ajoutée, mais l’envoi a échoué')
            : ecartes.has(la.id) ? '✕ SMS non envoyé — ' + ecartes.get(la.id)
            : r.erreur ? (deja ? '… En attente d’envoi' : '… Ajoutée, en attente d’envoi')
            : '✓ SMS déjà parti entre-temps (envoi automatique) — pas de second SMS';
          const ton = !la.id || s === 'echec_envoi' || ecartes.has(la.id ?? -1) ? '#b91c1c' : s === 'envoye' || (!r.erreur && la.id) ? '#15803d' : 'var(--muted)';
          return (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '7px 12px', borderTop: i ? '1px solid #f1f5f9' : 'none', fontSize: 12.5, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, minWidth: 180 }}>{l ? [l.nom, l.prenom].filter(Boolean).join(' ') : '—'}</span>
              <span style={{ color: 'var(--muted)', minWidth: 120 }}>{l?.telephone}</span>
              <span style={{ color: ton, fontWeight: 600 }}>{txt}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
