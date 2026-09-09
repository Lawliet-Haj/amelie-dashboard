/**
 * INTERRUPTEUR DE PAUSE d'un module — bouton + bandeau, partagés par Recouvrement et
 * Facturation.
 *
 * ⚠️ Un seul composant, pas un bouton recopié dans chaque vue : c'est exactement ce que le
 * socle `src/ui/` existe pour éviter (les trois `Chip` divergents).
 *
 * Deux états, deux poids visuels DÉLIBÉRÉMENT différents :
 *   • en service → un bouton discret, pour ne pas encombrer l'écran de travail ;
 *   • en pause   → un BANDEAU pleine largeur, impossible à manquer. Découvrir trois jours
 *     plus tard que le module était arrêté serait la pire issue possible.
 */
import { useState } from 'react';
import { Pause, Play, AlertTriangle, X } from 'lucide-react';
import { Portal } from '../lib/Portal';
import { formatDateTime } from '../lib/format';
import type { Reglage } from '../lib/reglages';

export function BoutonPause({
  reglage, libelleModule, enCours, onBasculer, erreur,
}: {
  /** `undefined` = pas encore chargé, ou lecture en échec : on n'affirme alors RIEN. */
  reglage?: Reglage;
  /** « le recouvrement », « la facturation » — inséré dans les phrases. */
  libelleModule: string;
  enCours?: boolean;
  onBasculer: (enPause: boolean, motif: string) => void;
  erreur?: string;
}) {
  const [confirme, setConfirme] = useState(false);
  const [motif, setMotif] = useState('');

  const enPause = reglage?.en_pause === true;
  // ⚠️ Un état inconnu ne se dessine PAS comme « en service » : afficher un bouton
  // « Mettre en pause » alors qu'on ignore l'état laisserait croire que le module tourne.
  const inconnu = !reglage;

  const demander = () => { setMotif(''); setConfirme(true); };
  const valider = () => { setConfirme(false); onBasculer(!enPause, motif.trim()); };

  return (
    <>
      {enPause && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-3)',
          padding: 'var(--sp-3) var(--sp-4)', marginBottom: 'var(--sp-3)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--st-attente-bg)', border: '1px solid var(--st-attente-bd)',
        }}>
          <Pause size={18} color="var(--st-attente-fg)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flexGrow: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, color: 'var(--st-attente-fg)' }}>
              {libelleModule.charAt(0).toUpperCase() + libelleModule.slice(1)} en pause
            </div>
            <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text-2)', marginTop: 2, lineHeight: 1.5 }}>
              Les <strong>envois automatiques sont arrêtés</strong> : aucun appel, aucun SMS,
              aucun mail ne part des tâches planifiées.{' '}
              <strong>L’extraction continue</strong> — les listes se remplissent normalement,
              rien n’est perdu. Les boutons de cet écran restent utilisables à la main.
            </div>
            {(reglage.motif || reglage.modifie_par) && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginTop: 'var(--sp-1)' }}>
                {reglage.motif && <>Motif : <em>{reglage.motif}</em>{' · '}</>}
                {reglage.modifie_par && <>posée par {reglage.modifie_par}</>}
                {reglage.modifie_le && <> le {formatDateTime(reglage.modifie_le)}</>}
              </div>
            )}
          </div>
          <button
            onClick={demander}
            disabled={enCours}
            style={{
              flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 'var(--r-md)', border: 'none',
              fontSize: 'var(--fs-md)', fontWeight: 700, fontFamily: 'Lexend,sans-serif',
              cursor: enCours ? 'progress' : 'pointer',
              background: 'var(--st-ok-fg)', color: '#fff',
            }}>
            <Play size={14} /> {enCours ? 'Reprise…' : 'Reprendre'}
          </button>
        </div>
      )}

      {!enPause && (
        <button
          onClick={demander}
          disabled={enCours || inconnu}
          title={inconnu
            ? 'État de l’interrupteur inconnu — rechargez la page'
            : `Arrêter les envois automatiques ${libelleModule === 'la facturation' ? 'de la facturation' : 'du recouvrement'}. L’extraction continue.`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', borderRadius: 'var(--r-md)',
            border: '1px solid var(--border)', background: 'white',
            fontSize: 'var(--fs-sm)', fontWeight: 700, fontFamily: 'Lexend,sans-serif',
            color: inconnu ? 'var(--muted-light)' : 'var(--muted)',
            cursor: enCours ? 'progress' : inconnu ? 'not-allowed' : 'pointer',
          }}>
          <Pause size={14} />
          {enCours ? 'Mise en pause…' : inconnu ? 'État inconnu' : 'Mettre en pause'}
        </button>
      )}

      {erreur && (
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--st-echec-fg)', marginTop: 'var(--sp-1)' }}>
          Interrupteur : {erreur}
        </div>
      )}

      {confirme && (
        <Portal>
          <div onClick={() => setConfirme(false)} style={{
            position: 'fixed', inset: 0, background: 'rgba(26,43,66,.45)', zIndex: 55,
          }} />
          <div className="modal-dialog" role="dialog" aria-modal="true">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
              {enPause
                ? <Play size={22} color="var(--st-ok-fg)" style={{ flexShrink: 0, marginTop: 2 }} />
                : <AlertTriangle size={22} color="var(--st-attente-fg)" style={{ flexShrink: 0, marginTop: 2 }} />}
              <div style={{ flexGrow: 1 }}>
                <h3 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, marginBottom: 'var(--sp-2)' }}>
                  {enPause ? 'Reprendre les envois automatiques ?' : 'Mettre les envois en pause ?'}
                </h3>
                {enPause ? (
                  <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-2)', lineHeight: 1.55 }}>
                    Les tâches planifiées de {libelleModule} recommenceront à appeler et à
                    envoyer dès leur prochain passage. Le retard accumulé pendant la pause
                    repartira, dans la limite des garde-fous habituels.
                  </p>
                ) : (
                  <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-2)', lineHeight: 1.55 }}>
                    Plus aucun appel, SMS ni mail ne partira automatiquement pour{' '}
                    {libelleModule}. <strong>L’extraction continue</strong> : les listes se
                    remplissent, rien n’est perdu, et les boutons de cet écran restent
                    utilisables à la main. Un rappel figurera dans le compte rendu du jour.
                  </p>
                )}
                {!enPause && (
                  <label style={{ display: 'block', marginTop: 'var(--sp-4)' }}>
                    <span style={{ display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 700,
                                   color: 'var(--muted)', marginBottom: 4 }}>
                      Motif (facultatif, repris dans le compte rendu)
                    </span>
                    <input
                      value={motif}
                      onChange={e => setMotif(e.target.value)}
                      maxLength={200}
                      autoFocus
                      placeholder="ex. vérification du message avant reprise"
                      style={{
                        width: '100%', padding: '8px 10px', borderRadius: 'var(--r-sm)',
                        border: '1px solid var(--border)', fontSize: 'var(--fs-md)',
                        fontFamily: 'inherit', color: 'var(--text)', outline: 'none',
                      }}
                    />
                  </label>
                )}
                <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end',
                              marginTop: 'var(--sp-5)' }}>
                  <button onClick={() => setConfirme(false)} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '8px 14px', borderRadius: 'var(--r-md)',
                    border: '1px solid var(--border)', background: 'white',
                    fontSize: 'var(--fs-md)', fontWeight: 700, fontFamily: 'Lexend,sans-serif',
                    color: 'var(--muted)', cursor: 'pointer',
                  }}>
                    <X size={14} /> Annuler
                  </button>
                  <button onClick={valider} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '8px 16px', borderRadius: 'var(--r-md)', border: 'none',
                    fontSize: 'var(--fs-md)', fontWeight: 700, fontFamily: 'Lexend,sans-serif',
                    color: '#fff', cursor: 'pointer',
                    background: enPause ? 'var(--st-ok-fg)' : 'var(--st-attente-fg)',
                  }}>
                    {enPause ? <><Play size={14} /> Reprendre</> : <><Pause size={14} /> Mettre en pause</>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
