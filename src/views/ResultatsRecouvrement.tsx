/**
 * RÉSULTATS DU RECOUVREMENT — combien de patientes relancées ont renvoyé leur ordonnance.
 *
 * Tout est calculé côté écran depuis les lignes déjà chargées : aucun nouvel appel réseau,
 * aucun workflow de plus. La logique de mesure vit dans `src/lib/resultats.ts`, avec les
 * trois biais qu'elle corrige — cet écran ne fait que la rendre lisible.
 *
 * ⚠️ Le chiffre principal répond à « combien ont renvoyé », PAS à « combien grâce à nous ».
 * L'écran le dit explicitement plutôt que de laisser le lecteur conclure : près de la moitié
 * du stock se résout seul en deux semaines.
 */
import { useMemo, useState } from 'react';
import { Info, Table2 } from 'lucide-react';
import type { Relance } from '../types';
import { Chip, DataTable, tdDiscret, tdStyle } from '../ui';
import { formatDate } from '../lib/format';
import {
  calculerResultats, pourcent, FENETRE_OBSERVATION, type PointCourbe,
} from '../lib/resultats';

const carte: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-lg)', padding: 'var(--sp-4)',
};

export function ResultatsRecouvrement({ relances, aujourdhui }: {
  relances: Relance[];
  aujourdhui?: string;
}) {
  const r = useMemo(() => calculerResultats(relances, aujourdhui), [relances, aujourdhui]);
  const [chiffres, setChiffres] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>

      {/* ── Le chiffre, et ce qu'il ne dit pas ─────────────────────────────── */}
      <section style={{ ...carte, display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap',
                        alignItems: 'flex-start' }}>
        <div style={{ minWidth: 200 }}>
          <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--muted)',
                        textTransform: 'uppercase', letterSpacing: '.3px' }}>
            Ordonnances renvoyées
          </div>
          <div style={{ fontSize: 46, fontWeight: 800, lineHeight: 1.05,
                        color: 'var(--st-ok-fg)', margin: '2px 0' }}>
            {pourcent(r.taux)}
          </div>
          <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text-2)' }}>
            <strong>{r.resolus}</strong> dossiers sur <strong>{r.observables}</strong> suivis
          </div>
          {r.delaiMedian !== null && (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginTop: 4 }}>
              Délai médian : <strong>{r.delaiMedian} jour{r.delaiMedian > 1 ? 's' : ''}</strong> après l’échéance
            </div>
          )}
        </div>

        <div style={{ flexGrow: 1, minWidth: 300, display: 'flex', flexDirection: 'column',
                      gap: 'var(--sp-2)' }}>
          <Avertissement titre="Ce n’est pas une mesure d’efficacité">
            Près de la moitié du stock se résout <strong>seul</strong> en deux semaines
            (6 % à J+1, 34 % à J+8, 47 % à J+13, mesuré le 04/09). Ce chiffre dit combien ont
            renvoyé, pas combien l’ont fait <em>grâce</em> à la relance.
          </Avertissement>
          {r.horsSuivi > 0 && (
            <Avertissement titre={`${r.horsSuivi} dossiers exclus du calcul`}>
              Ils n’ont pas de numéro de prescription ORTHOP (cohorte importée par Excel) :
              aucun signal ne pourra <strong>jamais</strong> les déclarer résolus. Les compter
              au dénominateur écraserait le taux sans raison.
            </Avertissement>
          )}
          {r.horsFenetre > 0 && (
            <Avertissement titre={`${r.horsFenetre} dossiers hors fenêtre d’observation`}>
              Le rattrapage ne ré-interroge ORTHOP que sur <strong>{FENETRE_OBSERVATION} jours</strong>.
              Au-delà, un retour n’est plus vu — leur taux est <strong>figé, pas terminé</strong>.
            </Avertissement>
          )}
        </div>
      </section>

      {/* ── La courbe ──────────────────────────────────────────────────────── */}
      <section style={carte}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-3)',
                      marginBottom: 'var(--sp-1)' }}>
          <h3 style={{ flexGrow: 1, fontSize: 'var(--fs-lg)', fontWeight: 700 }}>
            Part ayant renvoyé, selon le nombre de jours depuis l’échéance
          </h3>
          <button onClick={() => setChiffres(c => !c)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)',
                           padding: '4px var(--sp-3)', borderRadius: 'var(--r-md)',
                           border: '1px solid var(--border)', background: 'var(--surface)',
                           color: 'var(--text-2)', fontSize: 'var(--fs-sm)', fontWeight: 600,
                           cursor: 'pointer' }}>
            <Table2 size={13} /> {chiffres ? 'masquer' : 'voir'} les chiffres
          </button>
        </div>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginBottom: 'var(--sp-3)',
                    lineHeight: 1.5 }}>
          Au jour N, seuls les dossiers ayant <strong>déjà atteint</strong> cet âge comptent au
          dénominateur — sinon les cohortes fraîches, qui n’ont pas eu le temps de renouveler,
          écraseraient mécaniquement les jours élevés.
        </p>

        <Courbe points={r.courbe} />

        {chiffres && (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <DataTable colonnes={['Jour', 'Dossiers ayant atteint cet âge', 'Ont renvoyé', 'Part']}
                       hauteurMax="30vh">
              {r.courbe.map(p => (
                <tr key={p.age}>
                  <td style={tdStyle}>J+{p.age}</td>
                  <td style={tdDiscret}>{p.base}</td>
                  <td style={tdDiscret}>{p.resolus}</td>
                  <td style={tdStyle}><strong>{pourcent(p.taux, 1)}</strong></td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}
      </section>

      {/* ── Jointes / non jointes ──────────────────────────────────────────── */}
      <section style={carte}>
        <h3 style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--sp-1)' }}>
          Celles qu’on a réellement jointes renvoient-elles davantage ?
        </h3>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginBottom: 'var(--sp-3)',
                    lineHeight: 1.5 }}>
          « Jointe » = elle a parlé, un message vocal a été déposé, un SMS a été livré, ou un
          mail a abouti — à n’importe quel moment du parcours.
        </p>

        <div style={{ display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
          <Bloc titre="Jointes" g={r.joints} ton="ok" />
          <Bloc titre="Jamais jointes" g={r.nonJoints} ton="attente" />
        </div>

        <div style={{ marginTop: 'var(--sp-3)' }}>
          <Avertissement titre="Écart observé, pas un effet mesuré">
            Ces deux groupes n’ont pas été tirés au sort. Les injoignables diffèrent par
            nature — numéro erroné, dossier ancien, patiente déjà partie. L’écart est la
            meilleure comparaison disponible, ce n’est pas la preuve d’une cause.
          </Avertissement>
        </div>

        <div style={{ marginTop: 'var(--sp-4)' }}>
          <DataTable colonnes={['Canal abouti', 'Dossiers', 'Ont renvoyé', 'Part']}>
            {r.parCanal.map(c => (
              <tr key={c.canal}>
                <td style={tdStyle}>{c.canal}</td>
                <td style={tdDiscret}>{c.n}</td>
                <td style={tdDiscret}>{c.resolus}</td>
                <td style={tdStyle}><strong>{pourcent(c.taux)}</strong></td>
              </tr>
            ))}
          </DataTable>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 'var(--sp-2)' }}>
            ⚠️ Ces lignes <strong>se recouvrent</strong> : une même patiente peut avoir parlé
            ET reçu un SMS. Elles ne s’additionnent pas.
          </p>
        </div>
      </section>

      {/* ── Par cohorte ────────────────────────────────────────────────────── */}
      <section style={carte}>
        <h3 style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--sp-3)' }}>
          Par date d’échéance
        </h3>
        <DataTable colonnes={['Échéance', 'Âge', 'Dossiers suivis', 'Ont renvoyé', 'Part', '']}
                   hauteurMax="40vh"
                   vide={r.cohortes.length === 0 ? 'Aucune échéance passée dans les données chargées.' : undefined}>
          {r.cohortes.map(c => (
            <tr key={c.echeance}>
              <td style={tdStyle}>{formatDate(c.echeance)}</td>
              <td style={tdDiscret}>J+{c.age}</td>
              <td style={tdDiscret}>{c.observables}</td>
              <td style={tdDiscret}>{c.resolus}</td>
              <td style={tdStyle}><strong>{pourcent(c.taux)}</strong></td>
              <td style={tdStyle}>
                {c.horsFenetre && (
                  <Chip texte="figé" ton="neutre"
                        titre={`Échéance plus vieille que ${FENETRE_OBSERVATION} jours : ORTHOP n'est plus ré-interrogé, un retour survenu depuis n'est pas vu.`} />
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
    </div>
  );
}

/* ── La courbe, en SVG ────────────────────────────────────────────────────────
 * Une seule série : pas de légende (le titre la nomme), pas de palette catégorielle à
 * valider. Trait de 2 px, points de 8 px, grille et axes volontairement effacés — c'est la
 * courbe qu'on doit lire, pas le quadrillage. Chaque point porte un `<title>` : l'infobulle
 * native est lue par les lecteurs d'écran, et le bouton « voir les chiffres » donne la
 * version tableau.
 */
function Courbe({ points }: { points: PointCourbe[] }) {
  const W = 720, H = 240, padG = 46, padD = 54, padH = 14, padB = 30;
  const maxTaux = Math.max(0.1, ...points.map(p => p.taux));
  const haut = Math.min(1, Math.ceil(maxTaux * 10) / 10);   // palier de 10 %
  const ageMax = points.length - 1;

  const x = (age: number) => padG + (age / ageMax) * (W - padG - padD);
  const y = (t: number) => padH + (1 - t / haut) * (H - padH - padB);

  const ligne = points.map(p => `${x(p.age)},${y(p.taux)}`).join(' ');
  const aire = `${padG},${y(0)} ${ligne} ${x(ageMax)},${y(0)}`;
  const dernier = points[points.length - 1];

  const graduations = [0, haut / 2, haut];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
         role="img"
         aria-label={`Part de dossiers ayant renvoyé leur ordonnance, de J+0 à J+${ageMax}. `
           + points.filter(p => p.age % 3 === 0 || p.age === ageMax)
                   .map(p => `J+${p.age} : ${pourcent(p.taux)}`).join(', ') + '.'}>
      {graduations.map(g => (
        <g key={g}>
          <line x1={padG} x2={W - padD} y1={y(g)} y2={y(g)}
                stroke="var(--border)" strokeWidth={1} />
          <text x={padG - 8} y={y(g) + 4} textAnchor="end"
                fill="var(--muted)" fontSize={11}>{pourcent(g)}</text>
        </g>
      ))}

      <polygon points={aire} fill="var(--blue-light)" opacity={0.65} />
      <polyline points={ligne} fill="none" stroke="var(--blue)" strokeWidth={2}
                strokeLinejoin="round" strokeLinecap="round" />

      {points.map(p => (
        <g key={p.age}>
          {/* Cible de survol plus large que le point lui-même. */}
          <circle cx={x(p.age)} cy={y(p.taux)} r={9} fill="transparent" />
          <circle cx={x(p.age)} cy={y(p.taux)} r={4}
                  fill="var(--blue)" stroke="var(--surface)" strokeWidth={2} />
          <title>{`J+${p.age} · ${pourcent(p.taux, 1)} — ${p.resolus} sur ${p.base} dossiers`}</title>
        </g>
      ))}

      {/* Étiquette directe sur le dernier point, plutôt qu'un nombre sur chacun. */}
      {/* ⚠️ Jeton de TEXTE, pas la couleur de la série : c'est le point coloré qui porte
          l'identité, l'étiquette n'a pas à la répéter. */}
      <text x={x(ageMax) + 10} y={y(dernier.taux) + 4}
            fill="var(--text)" fontSize={13} fontWeight={700}>
        {pourcent(dernier.taux)}
      </text>

      {points.filter(p => p.age % 2 === 0).map(p => (
        <text key={p.age} x={x(p.age)} y={H - 10} textAnchor="middle"
              fill="var(--muted)" fontSize={11}>J+{p.age}</text>
      ))}
    </svg>
  );
}

function Bloc({ titre, g, ton }: {
  titre: string; g: { n: number; resolus: number; taux: number | null }; ton: 'ok' | 'attente';
}) {
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--muted)',
                    textTransform: 'uppercase', letterSpacing: '.3px' }}>{titre}</div>
      <div style={{ fontSize: 32, fontWeight: 800, color: `var(--st-${ton}-fg)`, lineHeight: 1.1 }}>
        {pourcent(g.taux)}
      </div>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
        {g.resolus} sur {g.n} dossiers
      </div>
    </div>
  );
}

function Avertissement({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--sp-2)', padding: 'var(--sp-3)',
                  borderRadius: 'var(--r-md)', background: 'var(--st-neutre-bg)',
                  borderLeft: '3px solid var(--st-neutre-bd)', fontSize: 'var(--fs-sm)',
                  color: 'var(--text-2)', lineHeight: 1.55 }}>
      <Info size={15} style={{ flexShrink: 0, marginTop: 2, color: 'var(--muted)' }} />
      <div><strong>{titre}</strong> — {children}</div>
    </div>
  );
}
