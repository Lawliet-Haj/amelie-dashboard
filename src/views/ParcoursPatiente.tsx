import { useEffect, useState } from 'react';
import { X, Phone, PhoneOff, MessageSquare, Mail, Flag, UserCheck, CheckCircle2, LogIn, Loader2, Ban, Undo2 } from 'lucide-react';
import type { Relance } from '../types';
import { Chip, Portal, TranscriptPanel } from '../ui';
import { historiquePatiente, remettreDansLeParcours, sortirDuParcours, type LigneParcours, type LigneSortie } from '../lib/controleApi';
import { chronologie, type RecitDossier, type TypeEvenement } from '../lib/parcours';
import { decalerJours, formatDate, formatDateTime, jourLocal } from '../lib/format';
import { PLAFOND_TENTATIVES } from '../lib/rails';

/**
 * LE PARCOURS D'UNE PATIENTE — tout ce qui lui a été fait, dans l'ordre (2026-09-23).
 *
 * Ouvert depuis la barre de recherche du Contrôle, ou en cliquant un nom. Rien ici n'appelle
 * ni n'envoie. Un seul geste écrit en base, depuis le 2026-09-25 : **sortir la patiente du
 * parcours** (ou l'y remettre) — c'est l'inverse d'un contact, on arrête les relances.
 *
 * ⚠️ L'historique est demandé AU SERVEUR à l'ouverture, et pas lu dans la liste déjà
 * chargée : celle-ci ne porte ni les appels passés (`call_history`), ni le journal des
 * étapes, ni les gestes de l'équipe. Les charger pour 2 500 dossiers à chaque rafraîchis-
 * sement (toutes les 30 s) pour n'en regarder qu'un serait absurde.
 */
const ICONE: Record<TypeEvenement, typeof Phone> = {
  entree: LogIn, appel: Phone, 'appel-rate': PhoneOff, sms: MessageSquare, mail: Mail,
  alerte: Flag, controle: UserCheck, orthop: CheckCircle2,
};
const COULEUR: Record<string, string> = {
  ok: '#15803d', ok2: '#0f766e', fort: '#6d28d9', attente: '#b45309', encours: '#1d4ed8', echec: '#b91c1c', neutre: '#64748b',
};

export function ParcoursPatiente({ token, ids, nom, onClose, onRelanceMaj }: {
  token: string;
  /** Les dossiers de cette patiente — le serveur y ajoute ceux du même bénéficiaire ORTHOP. */
  ids: number[];
  nom: string;
  onClose: () => void;
  /** Reporte dans la liste du parent ce que le serveur a écrit (sortie / remise). */
  onRelanceMaj?: (id: number, patch: Partial<Relance>) => void;
}) {
  const [transcrit, setTranscrit] = useState<Relance | null>(null);
  const cle = ids.join(',');
  // La réponse porte la CLÉ qu'elle concerne : tant qu'elle ne correspond pas aux dossiers
  // demandés, on est « en chargement » — déduit, jamais l'histoire d'une autre patiente.
  const [rep, setRep] = useState<{ cle: string; recits: RecitDossier[] | null; erreur: string } | null>(null);
  /** Relit l'historique après une sortie ou une remise : c'est le serveur qui fait foi. */
  const [relecture, setRelecture] = useState(0);

  useEffect(() => {
    let vivant = true;
    historiquePatiente(token, cle.split(',').map(Number)).then(r => {
      if (!vivant) return;
      setRep(r.ok ? { cle, recits: chronologie(r.data), erreur: '' } : { cle, recits: null, erreur: r.erreur });
    });
    return () => { vivant = false; };
  }, [token, cle, relecture]);

  function apresSortie(maj: LigneSortie[]) {
    for (const l of maj) {
      onRelanceMaj?.(l.id, { sorti_le: l.sorti_le, sorti_par: l.sorti_par, sorti_motif: l.sorti_motif, notes: l.notes });
    }
    setRelecture(n => n + 1);
  }
  const courant = rep && rep.cle === cle ? rep : null;
  const etat: 'chargement' | 'ok' | 'erreur' = !courant ? 'chargement' : courant.recits ? 'ok' : 'erreur';
  const erreur = courant?.erreur ?? '';
  const recits = courant?.recits ?? [];

  useEffect(() => {
    const main = document.querySelector('main') as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !transcrit) onClose(); };
    window.addEventListener('keydown', onKey);
    if (main) main.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); if (main) main.style.overflow = 'auto'; };
  }, [onClose, transcrit]);

  const premiere = recits[0]?.ligne;

  return (
    // ⚠️ PORTAIL OBLIGATOIRE : l'animation `fadeUp` des vues porte un `transform`, qui
    // ferait de la vue le bloc conteneur de ce panneau `fixed` — il s'ouvrirait hors écran.
    <Portal>
      <div className="panel-overlay animate-fade-in" onClick={onClose} style={{ zIndex: 900 }} />
      <div role="dialog" aria-label={'Parcours de ' + nom} style={{
        position: 'fixed', top: 16, right: 16, bottom: 16, width: 'min(640px, calc(100vw - 32px))',
        background: 'white', zIndex: 901, boxShadow: '0 8px 40px rgba(0,0,0,.18)', borderRadius: 16,
        display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'slideInRight .25s ease',
      }}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.4px' }}>PARCOURS DE LA PATIENTE</p>
            <h3 style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 800, fontSize: 17, color: 'var(--text)', margin: '3px 0 0' }}>{nom || '—'}</h3>
            {premiere && (
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '3px 0 0' }}>
                {premiere.telephone || 'pas de téléphone'}{premiere.email ? ' · ' + premiere.email : ''}
                {premiere.orthop_benef ? ' · bénéficiaire ORTHOP ' + premiere.orthop_benef : ''}
              </p>
            )}
          </div>
          <button onClick={onClose} title="Fermer (Échap)" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex', flexShrink: 0 }}><X size={18} /></button>
        </div>

        <div style={{ overflowY: 'auto', overscrollBehavior: 'contain', padding: '14px 20px 22px', flex: 1 }}>
          {etat === 'chargement' && (
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--muted)' }}>
              <Loader2 size={15} className="animate-spin" /> Chargement de l’historique…
            </p>
          )}
          {etat === 'erreur' && (
            <p style={{ fontSize: 13, color: '#b91c1c' }}>Impossible de charger l’historique : {erreur}.</p>
          )}
          {etat === 'ok' && recits.length > 0 && (
            <SortieParcours token={token} lignes={recits.map(d => d.ligne)} onFait={apresSortie} />
          )}
          {etat === 'ok' && recits.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Ce dossier n’existe plus (supprimé ou purgé après trois mois).</p>
          )}
          {etat === 'ok' && recits.map((d, i) => (
            <Dossier key={d.ligne.id} d={d} seul={recits.length === 1} rang={i} onTranscript={setTranscrit} />
          ))}
          {etat === 'ok' && recits.length > 0 && (
            <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '16px 0 0', lineHeight: 1.6 }}>
              Les dossiers de plus de trois mois sont effacés (RGPD) : ce qui est plus ancien n’apparaît pas.
              Un SMS ou un mail n’est daté que par son dernier envoi à chaque étape.
            </p>
          )}
        </div>
      </div>
      {transcrit && <TranscriptPanel relance={transcrit} onClose={() => setTranscrit(null)} />}
    </Portal>
  );
}

function Dossier({ d, seul, rang, onTranscript }: {
  d: RecitDossier; seul: boolean; rang: number; onTranscript: (r: Relance) => void;
}) {
  const l = d.ligne;
  const libEtape = (i: number) => d.evenements[i].etape?.libelle ?? '';
  return (
    <section style={{ marginTop: rang === 0 ? 0 : 22 }}>
      <div style={{ padding: '12px 14px', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 12 }}>
        <p style={{ margin: 0, fontFamily: 'Lexend,sans-serif', fontSize: 13.5, fontWeight: 800, color: 'var(--text)' }}>
          {seul ? 'Fin de location' : 'Dossier — fin de location'} le {l.date_echeance ? formatDate(decalerJours(l.date_echeance, -1)) : '—'}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7, alignItems: 'center' }}>
          {l.sorti_le && <Chip texte="Sortie du parcours" ton="neutre" titre={'Le ' + formatDate(jourLocal(l.sorti_le)) + (l.sorti_par ? ' par ' + l.sorti_par : '')} />}
          {d.etats.map(e => <Chip key={e.texte} texte={e.texte} ton={e.ton} />)}
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {d.etapeAtteinte ? 'étape atteinte : ' + d.etapeAtteinte.libelle : 'pas encore entrée dans le parcours'}
            {' · '}{l.nb_tentatives ?? 0}/{PLAFOND_TENTATIVES} tentatives d’appel
          </span>
          {d.tentativesSansTrace > 0 && (
            <span style={{ fontSize: 11.5, color: 'var(--muted)', fontStyle: 'italic' }}>
              dont {d.tentativesSansTrace} sans trace détaillée (un lancement refusé au J+1 n’est pas journalisé)
            </span>
          )}
        </div>
        {l.notes && (
          <p style={{ margin: '9px 0 0', fontSize: 12, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.5, borderLeft: '3px solid var(--border)', paddingLeft: 9 }}>
            <strong style={{ color: 'var(--muted)', fontWeight: 700 }}>Notes du dossier : </strong>{l.notes}
          </p>
        )}
      </div>

      {d.evenements.length === 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 2px' }}>Rien n’a encore été fait sur ce dossier.</p>
      )}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {d.evenements.map((e, i) => {
          const Icone = ICONE[e.type];
          // Un séparateur à chaque changement d'étape : c'est ce qui rend lisible une
          // histoire de trois semaines.
          const nouvelleEtape = i === 0 || libEtape(i) !== libEtape(i - 1);
          const couleur = COULEUR[e.ton] || COULEUR.neutre;
          const appel = e.appel;
          return (
            <li key={i}>
              {nouvelleEtape && (
                <p style={{ margin: i === 0 ? '0 0 6px' : '12px 0 6px', fontSize: 11, fontWeight: 800, color: 'var(--blue)', letterSpacing: '.4px' }}>
                  {e.etape ? 'ÉTAPE ' + e.etape.libelle : 'AVANT LA PREMIÈRE ÉTAPE'}
                </p>
              )}
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0' }}>
                <span style={{
                  width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center', background: couleur + '14', color: couleur,
                }}><Icone size={14} /></span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 650, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: couleur }}>{e.titre}</span>
                    {appel && (
                      <button
                        onClick={() => appel.transcript && onTranscript({
                          ...(l as unknown as Relance),
                          transcript: appel.transcript, dernier_appel: appel.ts,
                          duree_sec: appel.duree ?? null, sentiment: appel.sentiment ?? null, resultat_ia: appel.resultat ?? null,
                        })}
                        disabled={!appel.transcript}
                        title={appel.transcript ? 'Lire le transcript de cet appel' : 'Pas de transcript pour cet appel'}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 7,
                          border: '1px solid ' + (appel.transcript ? '#c7d2fe' : '#e5e7eb'), background: appel.transcript ? '#eef2ff' : '#f9fafb',
                          color: appel.transcript ? '#4f46e5' : '#9ca3af', fontSize: 11, fontWeight: 700,
                          cursor: appel.transcript ? 'pointer' : 'default',
                        }}>
                        <MessageSquare size={11} /> Transcript
                      </button>
                    )}
                  </p>
                  <p style={{ margin: '1px 0 0', fontSize: 11.5, color: 'var(--muted)' }}>{formatDateTime(e.quand)}</p>
                  {e.detail && (
                    <p style={{
                      margin: '3px 0 0', fontSize: 12, color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                      ...(e.type === 'controle' ? { background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '5px 9px' } : {}),
                    }}>
                      {e.type === 'controle' ? '« ' + e.detail + ' »' : e.detail}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Motifs proposés d'un clic — le champ reste libre. */
const MOTIFS = ['Dossier terminé', 'Matériel rendu', 'Location réglée', 'Demande de la patiente', 'Mauvais numéro'];

/**
 * SORTIR LA PATIENTE DU PARCOURS (2026-09-25, demande du client : « pour pouvoir arrêter les
 * appels vers une personne précise »).
 *
 * ⚠️ Toutes ses lignes à la fois : sortir un seul dossier laisserait les autres l'appeler.
 * ⚠️ Motif OBLIGATOIRE : dans trois semaines, « pourquoi ne l'appelle-t-on plus ? » doit avoir
 *    une réponse écrite — il part aussi, daté et signé, dans les notes du dossier.
 * ⚠️ Réversible : « Remettre dans le parcours » la rend de nouveau appelable par les étapes
 *    qu'elle atteint. Rien n'est supprimé.
 * ⚠️ La ligne n'est marquée qu'APRÈS la réponse du serveur, avec ce qu'il a écrit.
 */
function SortieParcours({ token, lignes, onFait }: {
  token: string; lignes: LigneParcours[]; onFait: (maj: LigneSortie[]) => void;
}) {
  const sorties = lignes.filter(l => l.sorti_le);
  // ⚠️ On sort AUSSI les dossiers déjà résolus : si ORTHOP réclamait à nouveau l'un d'eux
  // (branche `reo` de l'extraction), il reviendrait sinon dans le parcours. Mais le bouton
  // ne s'affiche que s'il reste un dossier réellement en cours.
  const dedans = lignes.filter(l => !l.sorti_le);
  const encoreEnCours = dedans.some(l => !l.resolu_le);
  const [ouvert, setOuvert] = useState(false);
  const [motif, setMotif] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const motifValide = motif.trim().length >= 3;

  async function sortir() {
    if (!motifValide || enCours) return;
    setEnCours(true); setErreur('');
    const r = await sortirDuParcours(token, dedans.map(l => l.id), motif.trim());
    setEnCours(false);
    if (!r.ok) { setErreur(r.erreur); return; }
    setOuvert(false); setMotif('');
    onFait(r.data);
  }
  async function remettre() {
    if (enCours) return;
    setEnCours(true); setErreur('');
    const r = await remettreDansLeParcours(token, sorties.map(l => l.id));
    setEnCours(false);
    if (!r.ok) { setErreur(r.erreur); return; }
    onFait(r.data);
  }

  const s0 = sorties[0];
  const bouton: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 9,
    fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: enCours ? 'wait' : 'pointer',
  };

  return (
    <div style={{ marginBottom: 16 }}>
      {s0 && (
        <div style={{ padding: '11px 13px', borderRadius: 12, background: '#f1f5f9', border: '1px solid #cbd5e1', marginBottom: dedans.length ? 10 : 0 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <Ban size={15} color="#475569" /> Sortie du parcours le {formatDate(jourLocal(s0.sorti_le))}{s0.sorti_par ? ' par ' + s0.sorti_par : ''}
          </p>
          {s0.sorti_motif && <p style={{ margin: '4px 0 0 22px', fontSize: 12.5, color: 'var(--text)' }}>« {s0.sorti_motif} »</p>}
          <p style={{ margin: '4px 0 0 22px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
            Plus aucun appel, SMS ni mail de relance ne part vers elle{sorties.length > 1 ? ' (' + sorties.length + ' dossiers)' : ''}.
          </p>
          <button onClick={() => void remettre()} disabled={enCours}
            style={{ ...bouton, marginTop: 9, marginLeft: 22, border: '1px solid var(--border)', background: 'white', color: 'var(--text)' }}>
            {enCours ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} Remettre dans le parcours
          </button>
        </div>
      )}

      {encoreEnCours && !ouvert && (
        <button onClick={() => { setOuvert(true); setErreur(''); }}
          title="Arrêter tous les appels, SMS et mails de relance vers cette patiente"
          style={{ ...bouton, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c' }}>
          <Ban size={13} /> {s0 ? 'Sortir aussi ' + (dedans.length > 1 ? 'les ' + dedans.length + ' autres dossiers' : 'l’autre dossier') : 'Sortir du parcours'}
        </button>
      )}

      {encoreEnCours && ouvert && (
        <div style={{ padding: '12px 13px', borderRadius: 12, background: '#fef2f2', border: '1px solid #fecaca' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#991b1b' }}>Sortir {'«'} {lignes[0]?.prenom || ''} {lignes[0]?.nom || ''} {'»'} du parcours</p>
          <p style={{ margin: '4px 0 9px', fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
            Plus aucun appel, SMS ni mail de relance ne partira vers elle — ni automatique, ni depuis un bouton
            {dedans.length > 1 ? ', sur ses ' + dedans.length + ' dossiers' : ''}. Vous pourrez la remettre dans le parcours à tout moment.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 7 }}>
            {MOTIFS.map(m => (
              <button key={m} onClick={() => setMotif(m)} type="button"
                style={{ padding: '3px 9px', borderRadius: 14, fontSize: 11.5, fontWeight: 650, fontFamily: 'inherit', cursor: 'pointer',
                         border: '1px solid ' + (motif === m ? '#b91c1c' : 'var(--border)'), background: motif === m ? '#fee2e2' : 'white', color: 'var(--text)' }}>
                {m}
              </button>
            ))}
          </div>
          <input value={motif} onChange={e => setMotif(e.target.value)} maxLength={300} autoFocus
            placeholder="Motif (obligatoire) — ex. dossier terminé, matériel rendu le 20/09"
            onKeyDown={e => { if (e.key === 'Enter') void sortir(); }}
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12.5, fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
            <button onClick={() => void sortir()} disabled={!motifValide || enCours}
              style={{ ...bouton, border: 'none', background: motifValide ? '#b91c1c' : '#fca5a5', color: 'white', cursor: !motifValide ? 'not-allowed' : bouton.cursor }}>
              {enCours ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />} Confirmer la sortie
            </button>
            <button onClick={() => { setOuvert(false); setErreur(''); }} disabled={enCours}
              style={{ ...bouton, border: '1px solid var(--border)', background: 'white', color: 'var(--text)' }}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {erreur && <p style={{ margin: '8px 2px 0', fontSize: 12.5, color: '#b91c1c' }}>Rien n’a été modifié : {erreur}.</p>}
    </div>
  );
}
