import { useEffect, useState } from 'react';
import { X, Phone, PhoneOff, MessageSquare, Mail, Flag, UserCheck, CheckCircle2, LogIn, Loader2 } from 'lucide-react';
import type { Relance } from '../types';
import { Chip, Portal, TranscriptPanel } from '../ui';
import { historiquePatiente } from '../lib/controleApi';
import { chronologie, type RecitDossier, type TypeEvenement } from '../lib/parcours';
import { decalerJours, formatDate, formatDateTime } from '../lib/format';
import { PLAFOND_TENTATIVES } from '../lib/rails';

/**
 * LE PARCOURS D'UNE PATIENTE — tout ce qui lui a été fait, dans l'ordre (2026-09-23).
 *
 * Ouvert depuis la barre de recherche du Contrôle, ou en cliquant un nom. **Lecture seule** :
 * rien ici n'appelle, n'envoie, ni n'écrit.
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

export function ParcoursPatiente({ token, ids, nom, onClose }: {
  token: string;
  /** Les dossiers de cette patiente — le serveur y ajoute ceux du même bénéficiaire ORTHOP. */
  ids: number[];
  nom: string;
  onClose: () => void;
}) {
  const [transcrit, setTranscrit] = useState<Relance | null>(null);
  const cle = ids.join(',');
  // La réponse porte la CLÉ qu'elle concerne : tant qu'elle ne correspond pas aux dossiers
  // demandés, on est « en chargement » — déduit, jamais l'histoire d'une autre patiente.
  const [rep, setRep] = useState<{ cle: string; recits: RecitDossier[] | null; erreur: string } | null>(null);

  useEffect(() => {
    let vivant = true;
    historiquePatiente(token, cle.split(',').map(Number)).then(r => {
      if (!vivant) return;
      setRep(r.ok ? { cle, recits: chronologie(r.data), erreur: '' } : { cle, recits: null, erreur: r.erreur });
    });
    return () => { vivant = false; };
  }, [token, cle]);
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
