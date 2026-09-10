/**
 * RÉSULTATS — combien de patientes relancées ont renvoyé leur ordonnance, sur une période.
 *
 * Volontairement simple : une période, trois chiffres, un détail par canal et par jour.
 * Tout est calculé depuis les lignes déjà chargées — aucun appel réseau de plus.
 *
 * ⚠️ Les seules réserves affichées sont celles qui rendraient le chiffre FAUX si on les
 * taisait (dossiers hors suivi ORTHOP, fenêtre de 14 jours). Le reste des précautions vit
 * dans `src/lib/resultats.ts` — un écran couvert d'avertissements ne se lit plus.
 */
import { useMemo, useState } from 'react';
import type { Relance } from '../types';
import { DataTable, tdDiscret, tdStyle } from '../ui';
import { aujourdhuiIso, decalerJours, formatDate } from '../lib/format';
import { calculerBilan, periodeParDefaut, pourcent, FENETRE_OBSERVATION } from '../lib/resultats';

const carte: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-lg)', padding: 'var(--sp-4)',
};

const RACCOURCIS = [
  { libelle: '7 derniers jours', jours: 7 },
  { libelle: '30 derniers jours', jours: 30 },
  { libelle: '90 derniers jours', jours: 90 },
];

export function ResultatsRecouvrement({ relances, aujourdhui }: {
  relances: Relance[];
  aujourdhui?: string;
}) {
  const auj = aujourdhui ?? aujourdhuiIso();
  const defaut = periodeParDefaut(auj);
  const [debut, setDebut] = useState(defaut.debut);
  const [fin, setFin] = useState(defaut.fin);

  const b = useMemo(() => calculerBilan(relances, debut, fin), [relances, debut, fin]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>

      {/* ── La période ─────────────────────────────────────────────────────── */}
      <section style={{ ...carte, display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap',
                        alignItems: 'flex-end' }}>
        <Champ libelle="Du" valeur={debut} onChange={setDebut} max={fin} />
        <Champ libelle="Au" valeur={fin} onChange={setFin} min={debut} max={auj} />
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          {RACCOURCIS.map(rc => (
            <button key={rc.jours}
                    onClick={() => { setDebut(decalerJours(auj, -rc.jours)); setFin(auj); }}
                    style={boutonRaccourci}>
              {rc.libelle}
            </button>
          ))}
        </div>
      </section>

      {/* ── Les trois chiffres ─────────────────────────────────────────────── */}
      <section style={{ ...carte, display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
        <Chiffre n={String(b.relances)} libelle="patientes relancées"
                 aide="Appelées, ou destinataires d’un SMS ou d’un mail sur la période." />
        <Chiffre n={String(b.resolus)} libelle="ont renvoyé leur ordonnance" ton="ok"
                 aide="Constaté dans ORTHOP : la prescription n’est plus réclamée." />
        <Chiffre n={pourcent(b.taux)} libelle="taux de retour" ton="ok" gros />
      </section>

      {b.relances === 0 && (
        <p style={{ ...carte, fontSize: 'var(--fs-md)', color: 'var(--muted)' }}>
          Aucune relance sur cette période.
        </p>
      )}

      {b.relances > 0 && (
        <>
          {/* ── Par canal ──────────────────────────────────────────────────── */}
          <section style={carte}>
            <Titre texte="Par canal de relance" />
            <DataTable colonnes={['Canal', 'Relancées', 'Ont renvoyé', 'Taux']}>
              {b.parCanal.map(l => (
                <tr key={l.libelle}>
                  <td style={tdStyle}>{l.libelle}</td>
                  <td style={tdDiscret}>{l.relances}</td>
                  <td style={tdDiscret}>{l.resolus}</td>
                  <td style={tdStyle}><strong>{pourcent(l.taux)}</strong></td>
                </tr>
              ))}
            </DataTable>
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 'var(--sp-2)' }}>
              Ces lignes <strong>se recouvrent</strong> : une même patiente peut avoir été
              appelée <em>et</em> avoir reçu un SMS. Elles ne s’additionnent pas.
            </p>
          </section>

          {/* ── Par jour ───────────────────────────────────────────────────── */}
          <section style={carte}>
            <Titre texte="Jour par jour" />
            <DataTable colonnes={['Jour de relance', 'Relancées', 'Ont renvoyé', 'Taux']}
                       hauteurMax="45vh">
              {b.parJour.map(l => (
                <tr key={l.libelle}>
                  <td style={tdStyle}>{formatDate(l.libelle)}</td>
                  <td style={tdDiscret}>{l.relances}</td>
                  <td style={tdDiscret}>{l.resolus}</td>
                  <td style={tdStyle}><strong>{pourcent(l.taux)}</strong></td>
                </tr>
              ))}
            </DataTable>
          </section>
        </>
      )}

      {/* ── Les réserves qui changent la lecture du chiffre ─────────────────── */}
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', lineHeight: 1.6,
                    padding: '0 var(--sp-1)' }}>
        {b.horsSuivi > 0 && (
          <p style={{ marginBottom: 6 }}>
            <strong>{b.horsSuivi} dossiers écartés</strong> — relancés sur la période mais sans
            numéro de prescription ORTHOP (import Excel) : rien ne pourra jamais les marquer
            comme rendus. Les garder au dénominateur écraserait le taux sans raison.
          </p>
        )}
        <p style={{ marginBottom: 6 }}>
          <strong>Une période ancienne est sous-estimée</strong> — ORTHOP n’est ré-interrogé que
          sur {FENETRE_OBSERVATION} jours, donc un retour plus tardif n’est plus vu.
        </p>
        <p>
          <strong>C’est un taux de retour, pas une mesure d’efficacité</strong> — près de la
          moitié des dossiers se résolvent d’eux-mêmes en deux semaines.
        </p>
      </div>
    </div>
  );
}

/* ── Éléments locaux ──────────────────────────────────────────────────────── */

const boutonRaccourci: React.CSSProperties = {
  padding: '7px var(--sp-3)', borderRadius: 'var(--r-md)',
  border: '1px solid var(--border)', background: 'var(--surface)',
  color: 'var(--text-2)', fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'pointer',
};

function Champ({ libelle, valeur, onChange, min, max }: {
  libelle: string; valeur: string; onChange: (v: string) => void; min?: string; max?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--muted)',
                     textTransform: 'uppercase', letterSpacing: '.3px' }}>{libelle}</span>
      <input type="date" value={valeur} min={min} max={max}
             onChange={e => e.target.value && onChange(e.target.value)}
             style={{ padding: '7px var(--sp-3)', borderRadius: 'var(--r-md)',
                      border: '1px solid var(--border)', fontSize: 'var(--fs-md)' }} />
    </label>
  );
}

function Chiffre({ n, libelle, ton, aide, gros }: {
  n: string; libelle: string; ton?: 'ok'; aide?: string; gros?: boolean;
}) {
  return (
    <div title={aide} style={{ cursor: aide ? 'help' : undefined, minWidth: 190, flexGrow: 1 }}>
      <div style={{ fontSize: gros ? 46 : 38, fontWeight: 800, lineHeight: 1.05,
                    color: ton ? `var(--st-${ton}-fg)` : 'var(--text)' }}>{n}</div>
      <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text-2)',
                    borderBottom: aide ? '1px dotted var(--muted-light)' : undefined,
                    display: 'inline-block' }}>{libelle}</div>
    </div>
  );
}

function Titre({ texte }: { texte: string }) {
  return (
    <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--muted)',
                  textTransform: 'uppercase', letterSpacing: '.3px',
                  marginBottom: 'var(--sp-3)' }}>{texte}</div>
  );
}
