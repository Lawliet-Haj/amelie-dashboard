/**
 * ÉCRAN D'ENTRÉE DU RECOUVREMENT — le parcours de relances, rail par rail.
 *
 * On entre par la QUESTION « quelle étape dois-je traiter ? », pas par une liste de
 * 1054 lignes. Chaque rail est une tuile ; un clic ouvre la liste filtrée sur ce rail.
 *
 * ⚠️ DEUX SIGNAUX VISUELS DISTINCTS, ne pas les confondre :
 *   • bordure POINTILLÉE → le rail n'est pas encore branché (aucun automate ne tourne)
 *   • compteur en TIRET  → aucune donnée disponible pour ce rail
 * R4 illustre pourquoi il en faut deux : il porte 77 dossiers ET n'est pas branché.
 * La maquette d'origine les fusionnait en un seul état « prévu », ce qui masquait le stock.
 *
 * ⚠️ LE CHIFFRE DE TÊTE EST `actifs`, pas `dansLeRail`. `dansLeRail` inclut les dossiers
 * déjà sortis du parcours (ordonnance renouvelée) : l'afficher gonflerait le travail
 * apparent.
 *
 * ⚠️⚠️ UNE ÉTAPE = UN JOUR PRÉCIS, pas une fenêtre. La somme des neuf tuiles ne fait donc
 * PAS le total de la base : mesuré le 2026-09-04, 179 dossiers sur une étape contre
 * **761 entre deux étapes** (81 %). D'où la ligne de décomposition sous les agrégats :
 * sans elle, l'écran aurait l'air d'avoir égaré 761 dossiers.
 */
import { useMemo, useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import type { Relance } from '../types';
import {
  RAILS, RAILS_RELANCES, comptesDuRail, comptesGlobaux, etapeSuivante,
  type ComptesRail, type Rail, type EtatRail,
} from '../lib/rails';
import { Chip, CanalPuce, type Ton } from '../ui';

/** Un rail = un état, donc `Chip` est le bon composant ici (contrairement aux canaux). */
const TON_ETAT: Record<EtatRail, Ton> = {
  actif: 'ok',
  facturation: 'encours',
  manuel: 'attente',
  prevu: 'neutre',
};
const LIBELLE_ETAT: Record<EtatRail, string> = {
  actif: 'en service',
  facturation: 'menu Facturation',
  manuel: 'manuelle',
  prevu: 'à brancher',
};

const TON_ACTION: Record<string, Ton> = {
  actif: 'ok', 'a-creer': 'attente', manuel: 'encours', retire: 'neutre',
};
const LIBELLE_ACTION: Record<string, string> = {
  actif: 'en service', 'a-creer': 'à créer', manuel: 'manuel', retire: 'retiré',
};

export interface ComptesFacturation { J30?: number; J15?: number }

/**
 * Ce qu'ORTHOP detient pour la date d'une etape, releve en `dry_run` — donc SANS RIEN
 * IMPORTER.
 *
 * ⚠️ Pourquoi une sonde plutot qu'un import : les etapes R5 a R9 visent des echeances
 * ANTERIEURES au demarrage de la campagne (22/08). Importer ces cohortes ferait entrer des
 * patientes directement a leur rail arithmetique — jusqu'a la mise en demeure pour les
 * plus anciennes — sans qu'elles aient jamais ete appelees ni relancees. La sonde les rend
 * visibles sans les faire entrer par la fin de l'echelle.
 */
export type SondeRail =
  | { etat: 'chargement' }
  | { etat: 'ok'; date: string; dossiers: number; eligibles: number; ecartes: number }
  | { etat: 'erreur'; date: string; message: string };

export function ParcoursRails({
  relances, onOuvrirRail, comptesFacturation, aujourdhui,
  sondes, sondageEnCours, onSonder,
}: {
  relances: Relance[];
  onOuvrirRail: (code: string) => void;
  /** Absent (ou champ manquant) → le compteur affiche un tiret, jamais un zéro trompeur. */
  comptesFacturation?: ComptesFacturation;
  aujourdhui?: string;
  /** Relevé ORTHOP par étape, indexé par code de rail. Voir `SondeRail`. */
  sondes?: Record<string, SondeRail>;
  sondageEnCours?: boolean;
  onSonder?: () => void;
}) {
  const [selection, setSelection] = useState<string>('R3');

  /** Un seul passage sur les données : neuf rails × 1054 lignes reste négligeable. */
  const comptes = useMemo(() => {
    const m = new Map<string, ComptesRail>();
    for (const rail of RAILS_RELANCES) m.set(rail.code, comptesDuRail(rail, relances, aujourdhui));
    return m;
  }, [relances, aujourdhui]);

  /**
   * ⚠️ Les agrégats NE se déduisent PAS de la somme des tuiles : avec des étapes à un jour
   * précis, la plupart des dossiers ne sont sur aucune étape. `comptesGlobaux` est le seul
   * endroit qui réconcilie le total, et il garantit
   * `surUneEtape + entreDeuxEtapes === actives`.
   */
  const global = useMemo(() => comptesGlobaux(relances, aujourdhui), [relances, aujourdhui]);

  const railSel = RAILS.find(r => r.code === selection) ?? RAILS[2];
  const cSel = comptes.get(railSel.code);

  return (
    <div>
      {/* ── En-tête ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-4)',
                    flexWrap: 'wrap', marginBottom: 'var(--sp-5)' }}>
        <div style={{ flexGrow: 1, minWidth: 260 }}>
          <h2 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, marginBottom: 'var(--sp-1)' }}>
            Parcours de relances
          </h2>
          <p style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)', marginBottom: 'var(--sp-2)' }}>
            Neuf étapes, de l’avertissement préventif à la mise en demeure.
            Choisissez celle à traiter.
          </p>
          {onSonder && (
            <button
              onClick={onSonder}
              disabled={sondageEnCours}
              title="Interroge ORTHOP pour la date de chaque étape, sans rien importer (dry run). Sept appels SOAP, environ 40 secondes."
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)',
                padding: '5px 12px', borderRadius: 'var(--r-md)',
                cursor: sondageEnCours ? 'progress' : 'pointer',
                fontSize: 'var(--fs-sm)', fontWeight: 700, fontFamily: 'Lexend,sans-serif',
                background: 'white', color: sondageEnCours ? 'var(--muted)' : 'var(--blue)',
                border: '1px solid var(--border)',
              }}>
              <Search size={14} />
              {sondageEnCours ? 'Interrogation d’ORTHOP…' : 'Sonder ORTHOP par étape'}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-5)', alignItems: 'flex-end' }}>
          <Agregat n={global.actives} libelle="dossiers dans le parcours" />
          <Agregat n={global.surUneEtape} libelle="sur une étape aujourd’hui" ton="encours" />
          <Agregat n={global.aTraiter} libelle="sans aucun contact"
                   ton={global.aTraiter > 0 ? 'echec' : undefined} />
          <Agregat n={global.sorties} libelle="ordonnances reçues" ton="ok" />
        </div>
      </div>

      {/* ── Les neuf tuiles ─────────────────────────────────────────────────── */}
      <div className="parcours-tuiles" style={{ marginBottom: 'var(--sp-5)' }}>
        {RAILS.map(rail => (
          <Tuile
            key={rail.code}
            rail={rail}
            comptes={comptes.get(rail.code)}
            nFacturation={rail.palier ? comptesFacturation?.[rail.palier] : undefined}
            sonde={sondes?.[rail.code]}
            actif={rail.code === selection}
            onClick={() => setSelection(rail.code)}
          />
        ))}
      </div>

      {/* ── La décomposition : sans elle, 761 dossiers seraient invisibles ──── */}
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginTop: 'calc(-1 * var(--sp-3))',
                  marginBottom: 'var(--sp-5)' }}>
        <strong>{global.actives}</strong> dossiers en cours ={' '}
        <strong>{global.surUneEtape}</strong> sur une étape aujourd’hui{' + '}
        <strong>{global.entreDeuxEtapes}</strong> entre deux étapes.
        {global.entreDeuxEtapes > 0 && (
          <> Ces derniers n’ont aucun rendez-vous aujourd’hui : ils attendent leur prochaine
            étape. Ouvrez une étape et élargissez la portée pour les retrouver.</>
        )}
      </p>

      {/* ── Détail de l'étape choisie ───────────────────────────────────────── */}
      <div className="parcours-detail">
        <section style={carte}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
                        flexWrap: 'wrap', marginBottom: 'var(--sp-1)' }}>
            <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--muted-light)',
                           letterSpacing: '.4px' }}>
              {railSel.code}
            </span>
            <span style={{ fontSize: 'var(--fs-xl)', fontWeight: 800 }}>
              {railSel.libelle} — {railSel.titre}
            </span>
            <Chip texte={LIBELLE_ETAT[railSel.etat]} ton={TON_ETAT[railSel.etat]} />
          </div>
          <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-2)', lineHeight: 1.55,
                      marginBottom: 'var(--sp-2)' }}>
            {railSel.resume}
          </p>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginBottom: 'var(--sp-4)' }}>
            Porté par <strong>{railSel.porteur}</strong>
            {railSel.source === 'relances' && (() => {
              const suiv = etapeSuivante(railSel);
              return (
                <> · étape à <strong>J+{railSel.jour}</strong> exactement
                  {suiv ? <> · prochaine étape J+{suiv.jour}</> : <> · dernière étape</>}</>
              );
            })()}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {railSel.actions.map((a, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-3)',
                padding: 'var(--sp-3)', borderRadius: 'var(--r-md)',
                background: 'var(--blue-faint)', border: '1px solid var(--border)',
              }}>
                <CanalPuce canal={a.canal} barre={a.etat === 'retire'} />
                <div style={{ flexGrow: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 'var(--fs-md)', fontWeight: 600,
                    textDecoration: a.etat === 'retire' ? 'line-through' : undefined,
                    color: a.etat === 'retire' ? 'var(--muted)' : 'var(--text)',
                  }}>{a.libelle}</div>
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginTop: 2 }}>
                    {a.detail}
                  </div>
                </div>
                <Chip texte={LIBELLE_ACTION[a.etat]} ton={TON_ACTION[a.etat]} />
              </div>
            ))}
          </div>
        </section>

        <PanneauRail rail={railSel} comptes={cSel} onOuvrir={() => onOuvrirRail(railSel.code)} />
      </div>
    </div>
  );
}

const carte: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-xl)', padding: 'var(--sp-5)',
};

function Agregat({ n, libelle, ton }: { n: number; libelle: string; ton?: Ton }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{
        fontSize: 'var(--fs-2xl)', fontWeight: 800, lineHeight: 1,
        color: ton ? `var(--st-${ton}-fg)` : 'var(--text)',
      }}>{n}</div>
      <div style={{
        fontSize: 'var(--fs-xs)', color: 'var(--muted)', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '.3px', marginTop: 3,
      }}>{libelle}</div>
    </div>
  );
}

function Tuile({
  rail, comptes, nFacturation, sonde, actif, onClick,
}: {
  rail: Rail; comptes?: ComptesRail; nFacturation?: number; sonde?: SondeRail;
  actif: boolean; onClick: () => void;
}) {
  // `undefined` et `0` doivent se lire différemment : un tiret dit « on ne sait pas »,
  // un zéro dit « on sait, et il n'y a rien ». Les confondre invente une information.
  const n = rail.source === 'facturation' ? nFacturation : comptes?.actifs;
  const aTraiter = rail.source === 'relances' ? (comptes?.aTraiter ?? 0) : 0;
  const branche = rail.etat === 'actif' || rail.etat === 'facturation';

  return (
    <button
      onClick={onClick}
      title={`${rail.code} · ${rail.libelle} — ${rail.titre}`}
      style={{
        // ⚠️ FLEX COLONNE, pas `block`. Un <button> CENTRE verticalement son contenu quand
        // il est plus haut que lui — et la grille etire toutes les tuiles a la meme hauteur.
        // Mesure du 2026-09-04 : tuiles de 280 px, contenu decale de 13 a 91 px selon la
        // quantite de texte, donc des libelles qui ne s'alignaient pas d'une tuile a l'autre.
        display: 'flex', flexDirection: 'column', alignItems: 'stretch',
        textAlign: 'left', cursor: 'pointer', padding: 'var(--sp-3)',
        borderRadius: 'var(--r-lg)', background: 'var(--card)',
        // Pointillé = pas encore branché. Indépendant du fait qu'il porte des dossiers.
        border: branche ? '1px solid var(--border)' : '1px dashed var(--muted-light)',
        outline: actif ? '2px solid var(--blue)' : 'none',
        outlineOffset: -1,
        transition: 'outline-color .15s, box-shadow .15s',
        boxShadow: actif ? '0 2px 10px rgba(45,127,194,.14)' : 'none',
      }}
    >
      {/* ── Ligne du haut : le libellé à gauche, la pastille « à venir » à DROITE ──
          ⚠️ LE CODE DU RAIL N'EST PLUS ICI. Mesuré le 2026-09-04 : la tuile ne fait que
          119 px de large au palier 9 colonnes, soit 95 px utiles ; « J+7 » + « R4 » + la
          pastille demandent ~100 px. Le code a donc cédé la place — il reste dans
          l'infobulle de la tuile et dans l'en-tête du détail, où il a de la place.

          ⚠️ Seules les étapes NON branchées portent une pastille : c'est ce qui les fait
          ressortir. En mettre une sur les six autres (« en service ») noierait le signal
          dans une rangée uniforme. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 'var(--sp-1)', minHeight: 20, marginBottom: 'var(--sp-2)' }}>
        <span style={{ fontSize: 'var(--fs-md)', fontWeight: 800,
                       color: branche ? 'var(--text)' : 'var(--muted)' }}>
          {rail.libelle}
        </span>
        {!branche && (
          <Chip texte="à venir" ton="encours"
                titre="Étape dessinée, aucun automate en service — voir le détail ci-dessous" />
        )}
      </div>

      <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, lineHeight: 1,
                    color: n === undefined ? 'var(--muted-light)' : 'var(--text)' }}>
        {n === undefined ? '—' : n}
      </div>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted-light)', marginTop: 2 }}>
        {n === undefined ? 'voir Facturation' : 'dans le parcours'}
      </div>

      {/* Le releve ORTHOP : ce que l'outil metier detient a cette date, sans import. */}
      {sonde && (
        <div style={{ marginTop: 'var(--sp-2)', fontSize: 'var(--fs-xs)', lineHeight: 1.35 }}>
          {sonde.etat === 'chargement' && (
            <span style={{ color: 'var(--muted-light)' }}>ORTHOP…</span>
          )}
          {sonde.etat === 'erreur' && (
            <span style={{ color: 'var(--st-echec-fg)' }} title={sonde.message}>ORTHOP : échec</span>
          )}
          {sonde.etat === 'ok' && (
            <span
              style={{ color: 'var(--muted)' }}
              title={`Au ${sonde.date} : ${sonde.dossiers} dossiers dans ORTHOP, ${sonde.ecartes} déjà renouvelées, ${sonde.eligibles} encore à relancer. Rien n’a été importé.`}>
              ORTHOP{' '}
              <strong style={{ color: 'var(--cn-voix-fg)' }}>{sonde.eligibles}</strong>
              {' '}à relancer
              <br />
              <span style={{ color: 'var(--muted-light)' }}>
                {sonde.ecartes}/{sonde.dossiers} déjà renouvelées
              </span>
            </span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 3, marginTop: 'var(--sp-2)', flexWrap: 'wrap' }}>
        {rail.canaux.map(c => <CanalPuce key={c} canal={c} />)}
      </div>

      {aTraiter > 0 && (
        <div style={{ marginTop: 'var(--sp-2)' }}>
          <Chip texte={`${aTraiter} sans contact`} ton="attente" />
        </div>
      )}
    </button>
  );
}

/**
 * Le panneau latéral répond à « et maintenant, quoi ? ». Son contenu dépend de QUI porte
 * le rail — un rail facturation n'offre rien à faire ici, un rail non branché ne propose
 * pas d'automate qui n'existe pas.
 */
function PanneauRail({
  rail, comptes, onOuvrir,
}: { rail: Rail; comptes?: ComptesRail; onOuvrir: () => void }) {
  if (rail.source === 'facturation') {
    return (
      <aside style={carte}>
        <Titre texte="Où agir" />
        <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-2)', lineHeight: 1.55 }}>
          Cette étape est portée par le menu <strong>Facturation</strong>, cloisonné par rôle.
          Elle figure ici pour situer le parcours ; les envois se pilotent depuis là-bas.
        </p>
      </aside>
    );
  }

  const c = comptes;
  return (
    <aside style={{ ...carte, display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <Titre texte="Où en est ce rail" />

      <Ligne libelle="Dans le parcours" n={c?.actifs ?? 0} />
      <Ligne libelle="Ordonnance reçue" n={c?.sortis ?? 0} ton="ok"
             aide="Sortis définitivement : ORTHOP ne réclame plus la prescription." />
      <Ligne libelle="Joints par écrit dans ce rail" n={c?.jointsEcrit ?? 0} ton="ok2"
             aide="SMS ou mail livré DEPUIS l'entrée dans ce rail. Un écrit reçu à une étape précédente ne compte pas ici." />
      <Ligne libelle="Joints à la voix dans ce rail" n={c?.jointsVoix ?? 0} ton="encours"
             aide="Elle a parlé, ou un message vocal a réellement été déposé." />
      <Ligne libelle="Sans aucun contact" n={c?.aTraiter ?? 0}
             ton={(c?.aTraiter ?? 0) > 0 ? 'attente' : undefined}
             aide="Rien ne lui est parvenu depuis son entrée dans ce rail, ni voix ni écrit. Le nombre de tentatives n'entre pas dans le calcul." />
      {(c?.quotaEpuise ?? 0) > 0 && (
        <Ligne libelle="Quota de 5 tentatives épuisé" n={c!.quotaEpuise} ton="echec" />
      )}
      {(c?.sansSuiviOrthop ?? 0) > 0 && (
        <Ligne libelle="Hors suivi ORTHOP" n={c!.sansSuiviOrthop} ton="neutre"
               aide="Cohorte importée par Excel, sans numéro de prescription : ces dossiers ne pourront JAMAIS être déclarés résolus. Ils sortent par le plafond de tentatives." />
      )}

      <button
        onClick={onOuvrir}
        disabled={(c?.actifs ?? 0) === 0}
        style={{
          marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 'var(--sp-2)', padding: '10px var(--sp-4)', borderRadius: 'var(--r-md)',
          border: 'none', fontWeight: 700, fontSize: 'var(--fs-md)',
          cursor: (c?.actifs ?? 0) === 0 ? 'not-allowed' : 'pointer',
          background: (c?.actifs ?? 0) === 0 ? 'var(--st-neutre-bg)' : 'var(--blue)',
          color: (c?.actifs ?? 0) === 0 ? 'var(--muted)' : '#fff',
        }}
      >
        Ouvrir la liste{(c?.actifs ?? 0) > 0 ? ` (${c!.actifs})` : ''}
        <ArrowRight size={15} />
      </button>

      {rail.etat !== 'actif' && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', lineHeight: 1.5 }}>
          Aucun automate ne tourne sur ce rail : la liste s’ouvre en lecture et les actions
          restent manuelles, une ligne à la fois.
        </p>
      )}
    </aside>
  );
}

function Titre({ texte }: { texte: string }) {
  return (
    <div style={{
      fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--muted)',
      textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 'var(--sp-1)',
    }}>{texte}</div>
  );
}

function Ligne({ libelle, n, ton, aide }: { libelle: string; n: number; ton?: Ton; aide?: string }) {
  return (
    <div title={aide} style={{ display: 'flex', alignItems: 'baseline',
                               justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)',
                     cursor: aide ? 'help' : undefined,
                     borderBottom: aide ? '1px dotted var(--muted-light)' : undefined }}>
        {libelle}
      </span>
      <span style={{
        fontSize: 'var(--fs-lg)', fontWeight: 800,
        color: ton ? `var(--st-${ton}-fg)` : 'var(--text)',
      }}>{n}</span>
    </div>
  );
}
