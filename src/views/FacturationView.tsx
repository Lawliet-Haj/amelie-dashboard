import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, AlertCircle, CloudDownload, Eye, X, Download,
  CalendarClock, MessageSquare, CheckCircle, Layers, Mail, Phone, Send,
} from 'lucide-react';
import type { AuthUser, Facturation, FacturationData, FacturationLot, Palier } from '../types';
import {
  Chip, StatsBar, type VuePuce, GroupedList, type GroupeEntete,
  DataTable, thStyle, tdStyle, tdDiscret, SearchInput, Portal,
} from '../ui';
import {
  aujourdhuiIso, decalerJours, formatDate, formatDateLongue, formatDateTime, isFixe,
} from '../lib/format';
import { analyserSms } from '../lib/sms';

const API_BASE = 'https://n8n.srv778935.hstgr.cloud';

/**
 * Les deux paliers de relance préventive.
 *
 * ⚠️ J-30 et J-15 sont STRICTEMENT séparés : le message envoyé ne sera pas le même
 * (premier avertissement vs rappel rapproché). Ils ont leur propre extraction, leur propre
 * onglet, leurs propres compteurs, et en base leur propre ligne — la clé de déduplication
 * `(orthop_prescription, palier)` garantit qu'une patiente peut passer par les deux sans
 * que l'un n'empêche l'autre.
 */
/**
 * `jours` = nombre de jours entre l'envoi du SMS et la **fin de location**. Les libellés
 * J-30 / J-15 correspondent donc exactement à cet écart (arrêté avec le client le
 * 2026-08-28 : le 28/08 vise une fin de location au 27/09).
 *
 * ⚠️ Ne pas confondre avec l'« applicable du » interrogé dans ORTHOP, qui vaut toujours
 * `fin de location + 1 jour` — voir `datesPalier` ci-dessous.
 *
 * ⚠️ Décalage FIXE, pas d'arithmétique de mois : avec un décalage fixe et un lancement
 * quotidien, chaque date de fin de location est visée une fois et une seule.
 * L'arithmétique de mois créerait doublons et trous (les 29, 30 et 31 janvier tomberaient
 * tous sur le 28 février).
 *
 * Le même écart est codé côté n8n dans `Auth + Params` (`JOURS_PALIER`) : les deux
 * doivent rester d'accord, et le modal signale un désaccord s'il en survient un.
 */
const PALIERS: { id: Palier; label: string; jours: number; teinte: string; bord: string; fond: string; texte: string }[] = [
  { id: 'J30', label: 'J-30', jours: 30, teinte: '#c2410c', bord: '#fed7aa', fond: '#fff7ed', texte: 'Premier avertissement, 30 jours avant la fin de location.' },
  { id: 'J15', label: 'J-15', jours: 15, teinte: '#1d4ed8', bord: '#bfdbfe', fond: '#eff6ff', texte: 'Rappel rapproché, 15 jours avant la fin de location.' },
];
const palierConf = (p: Palier) => PALIERS.find(x => x.id === p) ?? PALIERS[0];

/**
 * Deux dates à ne JAMAIS confondre :
 *
 *  - **fin de location** = `reference + N jours` — la date annoncée dans le SMS,
 *    celle que lit la patiente (« votre ordonnance prendra fin le … »).
 *  - **applicable du**   = `fin de location + 1 jour` — la date interrogée dans ORTHOP,
 *    et celle stockée dans `facturation.date_echeance`.
 *
 * Le décalage vient du champ « Fin loc. » de l'écran ORTHOP, qui donne J+1 : filtrer
 * Fin loc au 25/08 renvoie les prescriptions applicables du 26/08.
 *
 * ⚠️ Le même calcul est fait côté n8n (`Auth + Params`). Les deux doivent concorder —
 * le modal le vérifie et signale un désaccord plutôt que de le supposer.
 */
function datesPalier(reference: string, jours: number) {
  return { fin: decalerJours(reference, jours), applicable: decalerJours(reference, jours + 1) };
}

/** Fin de location déduite d'une ligne en base, où `date_echeance` est l'« applicable du ». */
function finDeLocation(dateEcheance: string | null | undefined): string {
  return dateEcheance ? decalerJours(dateEcheance, -1) : '';
}

// ─── API ──────────────────────────────────────────────────────────────────────

interface ExtractResult {
  ok?: boolean;
  mode?: 'dry_run' | 'insert' | 'vide';
  cible?: string;
  palier?: Palier | null;
  reference?: string | null;
  decalage?: number;
  /** « Applicable du » réellement interrogé dans ORTHOP. */
  date?: string;
  /** Fin de location = veille de `date` — c'est elle qui figure dans le SMS. */
  date_fin?: string | null;
  jours_palier?: number;
  batch_id?: string | null;
  batch_label?: string | null;
  dossiers_trouves?: number;
  ecartes_sans_ligne_a_renouveler?: number;
  eligibles?: number;
  inseres?: number;
  deja_presents?: number;
  apercu?: { nom: string; tel: string; email: string }[];
  erreur?: string;
}

/**
 * Extraction ORTHOP vers la table `facturation`.
 *
 * On envoie `reference` (le jour de départ) et non la date visée : c'est n8n qui applique
 * le décalage du palier. L'écran affiche sa propre prévision à côté du résultat renvoyé —
 * si les deux divergeaient un jour, ça se verrait immédiatement au lieu de passer inaperçu.
 * `dry_run` interroge ORTHOP sans rien insérer : c'est le mode de vérification.
 */
async function extraireFacturation(token: string, palier: Palier, reference: string, dryRun: boolean): Promise<ExtractResult> {
  try {
    const r = await fetch(`${API_BASE}/webhook/orthop-extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cible: 'facturation', palier, reference, dry_run: dryRun }),
      signal: AbortSignal.timeout(300000),
    });
    if (!r.ok) return { erreur: `Le serveur a répondu ${r.status}` };
    // ⚠️ Corps VIDE avec un statut 200 : c'est la réponse de n8n quand le workflow s'arrête
    // en cours de route — un refus d'authentification, un palier manquant, ou simplement
    // AUCUN dossier trouvé (la chaîne se vide alors et le nœud de réponse n'est jamais
    // atteint). Un 200 n'est donc pas une preuve de succès : on le dit au lieu d'annoncer
    // faussement un serveur indisponible.
    const brut = await r.text();
    if (!brut.trim()) {
      return { erreur: 'Le serveur a répondu sans contenu. Deux causes possibles : aucun dossier '
        + 'ORTHOP pour cette date, ou une erreur du workflow. À vérifier dans les exécutions n8n.' };
    }
    const j = JSON.parse(brut);
    const res = Array.isArray(j) ? j[0] : j;
    if (!res || typeof res !== 'object') return { erreur: 'Réponse inattendue du serveur.' };
    return res as ExtractResult;
  } catch (e) {
    const nom = e instanceof Error ? e.name : '';
    if (nom === 'TimeoutError') {
      return { erreur: 'Délai dépassé — l’extraction est peut-être encore en cours côté ORTHOP.' };
    }
    if (e instanceof SyntaxError) return { erreur: 'Réponse illisible du serveur (JSON invalide).' };
    return { erreur: 'Serveur indisponible.' };
  }
}

/**
 * Réponse du workflow d'envoi, en aperçu comme en envoi réel.
 * `mode` : `apercu` (rien envoyé), `rien_a_envoyer`, ou `envoi`.
 */
export interface ResultatEnvoi {
  ok?: boolean;
  mode?: 'apercu' | 'rien_a_envoyer' | 'envoi' | 'refus_volume' | 'refus_desactive';
  palier?: Palier | null;
  cibles_trouvees?: number;
  a_envoyer?: number;
  ignores?: number;
  detail_ignores?: { id: number; raison: string }[];
  cout_segments?: number;
  /**
   * Aperçu des premiers envois. Les champs diffèrent selon le canal : le SMS porte
   * `tel` / `segments` / `message`, le mail `email` / `sujet` / `template_id` — le corps
   * du mail, lui, vit dans le modèle Brevo et n'est pas rendu ici.
   */
  apercu?: {
    nom: string;
    tel?: string; segments?: number; message?: string;
    email?: string; sujet?: string; template_id?: number;
  }[];
  envoyes?: number;
  echecs?: number;
  details?: { id: number; tel?: string; email?: string; statut: string; message_id: string | null }[];
  canal?: Canal;
  /**
   * Expéditeur réel du mail, tel que le serveur le passera à Brevo. Affiché plutôt que
   * supposé : c'est le seul moyen de vérifier depuis l'écran de quelle adresse part le
   * message. Défini dans `Preparer Envois`, jamais côté navigateur.
   */
  expediteur?: { name: string; email: string } | null;
  /** Motif de refus côté serveur : `volume` (plafond dépassé) ou `desactive`. */
  refus?: string | null;
  erreur?: string;
}

export type Canal = 'sms' | 'mail';

/** Les deux canaux ont le même contrat d'appel ; seul le webhook change. */
const WEBHOOK_ENVOI: Record<Canal, string> = {
  sms:  'facturation-send-sms',
  mail: 'facturation-send-mail',
};

/**
 * Envoi d'un palier sur un canal — ou simple aperçu quand `dryRun` est vrai.
 *
 * ⚠️ Le contenu n'est JAMAIS transmis par le dashboard : le texte du SMS comme l'objet du
 * mail sont construits côté n8n. C'est ce qui garantit qu'un aperçu montre exactement ce
 * qui partira, et qu'on ne puisse pas faire envoyer un contenu arbitraire depuis le
 * navigateur. Le corps du mail vit dans le modèle Brevo (337 pour J-30, 336 pour J-15).
 *
 * ⚠️ Côté serveur, chaque canal a sa PROPRE garde d'idempotence — `sms_statut IS NULL`
 * d'un côté, `email_statut IS NULL` de l'autre. Une patiente déjà servie sur un canal ne
 * peut pas y être servie deux fois, même en recliquant ; et le mail part aussi vers les
 * numéros FIXES, que le SMS ne peut pas atteindre.
 */
async function envoyerCanal(token: string, canal: Canal, palier: Palier, dryRun: boolean): Promise<ResultatEnvoi> {
  try {
    const r = await fetch(`${API_BASE}/webhook/${WEBHOOK_ENVOI[canal]}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ palier, dry_run: dryRun }),
      signal: AbortSignal.timeout(dryRun ? 30000 : 300000),
    });
    if (!r.ok) return { erreur: `Le serveur a répondu ${r.status}` };
    const brut = await r.text();
    if (!brut.trim()) {
      return { erreur: 'Le serveur a répondu sans contenu — à vérifier dans les exécutions n8n.' };
    }
    const j = JSON.parse(brut);
    const res = Array.isArray(j) ? j[0] : j;
    if (!res || typeof res !== 'object') return { erreur: 'Réponse inattendue du serveur.' };
    return res as ResultatEnvoi;
  } catch (e) {
    const nom = e instanceof Error ? e.name : '';
    if (nom === 'TimeoutError') {
      const quoi = canal === 'mail' ? 'mails' : 'SMS';
      const col  = canal === 'mail' ? 'Mail' : 'SMS';
      return { erreur: `Délai dépassé. ⚠️ Des ${quoi} ont peut-être déjà été envoyés — vérifiez la colonne ${col} avant de réessayer.` };
    }
    if (e instanceof SyntaxError) return { erreur: 'Réponse illisible du serveur (JSON invalide).' };
    return { erreur: 'Serveur indisponible.' };
  }
}

const envoyerSms  = (token: string, palier: Palier, dryRun: boolean) => envoyerCanal(token, 'sms',  palier, dryRun);
const envoyerMail = (token: string, palier: Palier, dryRun: boolean) => envoyerCanal(token, 'mail', palier, dryRun);

async function chargerFacturation(token: string): Promise<FacturationData | { erreur: string }> {
  try {
    const r = await fetch(`${API_BASE}/webhook/dashboard-facturation-data`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return { erreur: `Le serveur a répondu ${r.status}` };
    const j = await r.json();
    const d = Array.isArray(j) ? j[0] : j;
    if (!d || !Array.isArray(d.facturations)) return { erreur: 'Réponse inattendue du serveur.' };
    return d as FacturationData;
  } catch { return { erreur: 'Serveur indisponible.' }; }
}

// ─── Petits composants ────────────────────────────────────────────────────────

/**
 * Étiquette de palier. ⚠️ Volontairement PAS un `Chip` : un palier n'est pas un état
 * d'acheminement, il a sa propre teinte (ambre pour J-30, bleu pour J-15). Lui imposer un
 * `ton` sémantique brouillerait les deux langages visuels.
 */
function PalierChip({ palier }: { palier: Palier }) {
  const c = palierConf(palier);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px var(--sp-2)',
      borderRadius: 'var(--r-pill)', fontSize: 'var(--fs-xs)', fontWeight: 700,
      whiteSpace: 'nowrap', color: c.teinte, background: c.fond, border: `1px solid ${c.bord}`,
    }}>{c.label}</span>
  );
}

/** État d'acheminement du SMS, tel que Brevo le rapporte. */
function SmsChip({ f }: { f: Facturation }) {
  if (isFixe(f.telephone)) return <Chip texte="Fixe · sans SMS" ton="neutre" />;
  switch (f.sms_statut) {
    case 'livre':       return <Chip texte="SMS livré"     ton="ok" />;
    case 'envoye':      return <Chip texte="SMS envoyé"    ton="encours" />;
    case 'echec':
    case 'echec_envoi': return <Chip texte="SMS non livré" ton="echec" />;
    default:            return <Chip texte="À envoyer"     ton="attente" />;
  }
}

/**
 * État d'acheminement du mail.
 *
 * 💡 Fiabilité des signaux, comme au recouvrement : le CLIC est une preuve, l'ouverture
 * seulement un indice — Gmail et Apple Mail préchargent ou bloquent le pixel de suivi.
 */
function MailChip({ f }: { f: Facturation }) {
  switch (f.email_statut) {
    case 'clique':      return <Chip texte="Mail cliqué"    ton="fort" />;
    case 'ouvert':      return <Chip texte="Mail ouvert"    ton="ok" />;
    case 'livre':       return <Chip texte="Mail livré"     ton="ok2" />;
    case 'envoye':      return <Chip texte="Mail envoyé"    ton="encours" />;
    case 'echec':
    case 'echec_envoi': return <Chip texte="Mail non livré" ton="echec" />;
    // Ligne volontairement exclue du canal mail : rien n'est dû, rien ne partira.
    // ⚠️ Sans ce cas, ces lignes retomberaient sur « À envoyer » et donneraient
    // l'impression d'un retard d'envoi qui n'existe pas.
    case 'non_concerne': return <Chip texte="Hors périmètre" ton="neutre" />;
    default:
      return f.email
        ? <Chip texte="À envoyer"  ton="attente" />
        : <Chip texte="Sans email" ton="neutre" />;
  }
}

/** Bouton d'envoi : même forme pour les deux canaux, seule la teinte change. */
function styleEnvoi(actif: boolean, teinte: string): React.CSSProperties {
  return {
    flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', fontSize: 13,
    fontWeight: 700, color: 'white', fontFamily: 'Lexend,sans-serif',
    background: actif ? teinte : '#e5e7eb',
    cursor: actif ? 'pointer' : 'not-allowed',
  };
}

/**
 * Aperçu du SMS du palier, avec son coût réel en segments.
 *
 * Rien n'est envoyé depuis cet écran — c'est un aperçu, pour valider le texte ET voir
 * ce qu'il coûte avant de brancher l'envoi. Un SMS est facturé au segment : le même
 * message peut coûter 1 ou 5 fois le prix selon les caractères employés.
 */
function SmsApercu({ texte, res }: { texte: string | null; res?: ResultatEnvoi | null }) {
  if (!texte) {
    // ⚠️ Un aperçu vide a deux causes OPPOSEES : soit il ne reste rien à envoyer (sain),
    // soit le serveur n'a pas répondu (panne). Les confondre faisait passer un palier
    // entièrement traité pour un incident.
    // ⚠️ Ne pas se fier à `mode` : en `dry_run` il vaut toujours `apercu`, même quand il
    // n'y a plus une seule cible. Le signal fiable est `erreur`, puis `a_envoyer`.
    return (
      <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 12px', fontStyle: 'italic' }}>
        {res?.erreur
          ? `Aperçu du message indisponible (${res.erreur})`
          : (res?.a_envoyer ?? 0) === 0
            ? 'Aperçu du SMS indisponible : plus aucun envoi en attente sur ce palier.'
            : "Aperçu du message indisponible (le serveur n'a pas répondu)."}
      </p>
    );
  }
  const a = analyserSms(texte);
  const bon = a.segments === 1;
  const couleur = bon ? '#065f46' : a.gsm7 ? '#92400e' : '#b91c1c';
  const fond = bon ? '#ecfdf5' : a.gsm7 ? '#fffbeb' : '#fef2f2';
  const bord = bon ? '#6ee7b7' : a.gsm7 ? '#fde68a' : '#fecaca';
  return (
    <details style={{ marginBottom: 12 }}>
      <summary style={{ cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: 'var(--text)', fontFamily: 'Lexend,sans-serif', display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none' }}>
        <MessageSquare size={12} style={{ color: 'var(--muted)' }} />
        Message qui sera envoyé
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, color: couleur, background: fond, border: `1px solid ${bord}` }}>
          {a.segments} segment{a.segments > 1 ? 's' : ''} · {a.unites} car. · {a.gsm7 ? 'GSM-7' : 'UCS-2'}
        </span>
      </summary>
      <p style={{ fontSize: 11.5, color: 'var(--text)', margin: '8px 0 0', padding: '9px 11px', background: 'rgba(255,255,255,.85)', border: '1px solid var(--border)', borderRadius: 8, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
        {texte}
      </p>
      {!a.gsm7 && (
        <p style={{ fontSize: 11, color: '#b91c1c', margin: '6px 0 0', lineHeight: 1.5 }}>
          ⚠️ Les caractères {a.fautifs.map(c => `« ${c} »`).join(', ')} font basculer le message en
          UCS-2 : la limite tombe de 160 à 70 caractères par segment.
        </p>
      )}
      {a.gsm7 && !bon && (
        <p style={{ fontSize: 11, color: '#92400e', margin: '6px 0 0', lineHeight: 1.5 }}>
          {a.unites - 160} caractère(s) de trop pour un seul segment. Ce message sera facturé {a.segments} fois.
        </p>
      )}
    </details>
  );
}

const champStyle: React.CSSProperties = {
  padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)',
  fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'inherit', background: 'white',
};
// ─── Modal d'extraction ───────────────────────────────────────────────────────

function ExtractionModal({
  token, palier, reference, onClose, onDone,
}: {
  token: string; palier: Palier; reference: string;
  onClose: () => void; onDone: (n: number, palier: Palier) => void;
}) {
  const conf = palierConf(palier);
  const { fin: finPrevue, applicable: prevu } = datesPalier(reference, conf.jours);
  const [loading, setLoading] = useState<'apercu' | 'extraction' | null>(null);
  const [res, setRes] = useState<ExtractResult | null>(null);

  async function lancer(dryRun: boolean) {
    setLoading(dryRun ? 'apercu' : 'extraction');
    setRes(null);
    const r = await extraireFacturation(token, palier, reference, dryRun);
    setLoading(null);
    setRes(r);
    if (!r.erreur && !dryRun) onDone(r.inseres ?? 0, palier);
  }

  const ligne = (label: string, valeur: React.ReactNode, fort = false) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}>
      <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontSize: fort ? 16 : 13, fontWeight: fort ? 800 : 600, color: fort ? '#047857' : 'var(--text)', fontFamily: 'Lexend,sans-serif' }}>{valeur}</span>
    </div>
  );

  // Le serveur refait le calcul de son côté : on compare, plutôt que de supposer.
  const desaccord = res && !res.erreur && res.date && res.date !== prevu;

  return (
    <Portal>
      <div className="panel-overlay animate-fade-in" onClick={loading ? undefined : onClose} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'white', borderRadius: 16, padding: 26, width: 500, maxHeight: '88vh', overflow: 'auto', zIndex: 1001, boxShadow: '0 20px 60px rgba(0,0,0,.15)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h2 style={{ fontFamily: 'Lexend,sans-serif', fontSize: 17, fontWeight: 800, color: 'var(--text)', margin: 0 }}>
            Extraction {conf.label}
          </h2>
          {!loading && <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex' }}><X size={18} /></button>}
        </div>

        <div style={{ padding: '12px 14px', background: conf.fond, border: `1px solid ${conf.bord}`, borderRadius: 10, marginBottom: 16 }}>
          <p style={{ fontSize: 12.5, color: conf.teinte, margin: 0, lineHeight: 1.6 }}>
            À partir du <strong>{formatDate(reference)}</strong>, plus {conf.jours} jours :<br />
            fin de location le <strong>{formatDateLongue(finPrevue)}</strong>.
          </p>
          <p style={{ fontSize: 11.5, color: conf.teinte, opacity: .85, margin: '6px 0 0', lineHeight: 1.5 }}>
            Interrogé dans ORTHOP : ordonnances applicables du <strong>{formatDate(prevu)}</strong>, soit le
            lendemain. C'est ainsi qu'ORTHOP les indexe.
          </p>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 16px', lineHeight: 1.55 }}>
          <strong>Aperçu</strong> interroge ORTHOP sans rien enregistrer — à utiliser pour vérifier la liste.
          <strong> Extraire</strong> enregistre les lignes. Relancer une extraction déjà faite n’ajoute aucun doublon.
        </p>

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, marginBottom: 16 }}>
            <RefreshCw size={16} style={{ color: '#1d4ed8', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
            <p style={{ fontSize: 12.5, color: '#1e40af', margin: 0 }}>
              Interrogation d’ORTHOP… comptez une dizaine de secondes pour une centaine de dossiers.
            </p>
          </div>
        )}

        {res?.erreur && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, marginBottom: 16 }}>
            <AlertCircle size={15} style={{ color: '#b91c1c', flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 12.5, color: '#991b1b', margin: 0 }}>{res.erreur}</p>
          </div>
        )}

        {desaccord && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, marginBottom: 16 }}>
            <AlertCircle size={15} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 12.5, color: '#92400e', margin: 0 }}>
              Le serveur a visé le <strong>{formatDate(res.date ?? null)}</strong> alors que cet écran annonçait
              le <strong>{formatDate(prevu)}</strong>. À signaler — les deux calculs devraient concorder.
            </p>
          </div>
        )}

        {res && !res.erreur && (
          <div style={{ padding: '14px 16px', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16 }}>
            {ligne('Fin de location (date du SMS)', formatDate(res.date_fin ?? null))}
            {ligne('Applicable du (interrogé)', formatDate(res.date ?? null))}
            {ligne('Dossiers trouvés dans ORTHOP', res.dossiers_trouves ?? '—')}
            {ligne('Écartés (aucune ligne à renouveler)', res.ecartes_sans_ligne_a_renouveler ?? '—')}
            {ligne('Éligibles', res.eligibles ?? '—')}
            {res.mode === 'dry_run'
              ? ligne('Enregistrés', 'aucun (aperçu)', true)
              : <>
                  {ligne('Déjà en base', res.deja_presents ?? '—')}
                  {ligne('Ajoutés', res.inseres ?? 0, true)}
                </>}
            {res.batch_label && (
              <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '10px 0 0' }}>Lot : <strong>{res.batch_label}</strong></p>
            )}
            {res.mode === 'insert' && res.inseres === 0 && (res.eligibles ?? 0) > 0 && (
              <p style={{ fontSize: 11.5, color: '#b45309', margin: '8px 0 0' }}>
                Cette liste avait déjà été extraite — rien n’a été dupliqué.
              </p>
            )}
            {res.apercu && res.apercu.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '.3px' }}>
                  Premières lignes
                </p>
                {res.apercu.map((a, i) => (
                  <p key={i} style={{ fontSize: 12, color: 'var(--text)', margin: '2px 0' }}>
                    {a.nom} — {a.tel}{a.email ? ` — ${a.email}` : ''}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={!!loading}>Fermer</button>
          <button className="btn btn-ghost" onClick={() => lancer(true)} disabled={!!loading}>
            {loading === 'apercu' ? <RefreshCw size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Eye size={14} />}
            Aperçu
          </button>
          <button className="btn btn-primary" onClick={() => lancer(false)} disabled={!!loading}>
            {loading === 'extraction' ? <RefreshCw size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <CloudDownload size={14} />}
            {loading === 'extraction' ? 'Extraction…' : 'Extraire'}
          </button>
        </div>
      </div>
    </Portal>
  );
}

// ─── Modal d'envoi des SMS ────────────────────────────────────────────────────

/** Au-delà de ce nombre, une case à cocher est exigée en plus du clic. */
const SEUIL_CONFIRMATION = 20;

/**
 * Envoi d'un palier sur un canal, en trois temps : aperçu → confirmation → envoi.
 *
 * ⚠️ C'est le SEUL endroit du dashboard qui déclenche un envoi de masse. L'aperçu est
 * rechargé à l'ouverture (et non repris d'un état plus ancien) pour que le nombre affiché
 * soit celui du moment, et le texte montré est celui que le serveur va réellement envoyer.
 * Au-delà de {@link SEUIL_CONFIRMATION} destinataires, une case à cocher est exigée : un
 * clic distrait ne doit pas pouvoir écrire à une centaine de patientes.
 */
function EnvoiModal({
  token, palier, canal, onClose, onFini,
}: {
  token: string; palier: Palier; canal: Canal;
  onClose: () => void; onFini: (r: ResultatEnvoi) => void;
}) {
  const conf = palierConf(palier);
  const estMail = canal === 'mail';
  const nomCanal = estMail ? 'mails' : 'SMS';
  const [apercu, setApercu] = useState<ResultatEnvoi | null>(null);
  const [etat, setEtat] = useState<'chargement' | 'pret' | 'envoi' | 'fini'>('chargement');
  const [resultat, setResultat] = useState<ResultatEnvoi | null>(null);
  const [coche, setCoche] = useState(false);

  useEffect(() => {
    let vivant = true;
    (async () => {
      const r = await envoyerCanal(token, canal, palier, true);
      if (!vivant) return;
      setApercu(r);
      setEtat('pret');
    })();
    return () => { vivant = false; };
  }, [token, palier, canal]);

  const nb = apercu?.a_envoyer ?? 0;
  const besoinCoche = nb > SEUIL_CONFIRMATION;
  const peutEnvoyer = etat === 'pret' && nb > 0 && (!besoinCoche || coche);
  const message = estMail ? (apercu?.apercu?.[0]?.sujet ?? null) : (apercu?.apercu?.[0]?.message ?? null);

  async function envoyer() {
    setEtat('envoi');
    const r = await envoyerCanal(token, canal, palier, false);
    setResultat(r);
    setEtat('fini');
    if (!r.erreur) onFini(r);
  }

  const ligne = (label: string, valeur: React.ReactNode, fort = false) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}>
      <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontSize: fort ? 16 : 13, fontWeight: fort ? 800 : 600, color: fort ? '#047857' : 'var(--text)', fontFamily: 'Lexend,sans-serif' }}>{valeur}</span>
    </div>
  );

  return (
    <Portal>
      <div className="panel-overlay animate-fade-in" onClick={etat === 'envoi' ? undefined : onClose} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'white', borderRadius: 16, padding: 26, width: 540, maxHeight: '88vh', overflow: 'auto', zIndex: 1001, boxShadow: '0 20px 60px rgba(0,0,0,.15)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontFamily: 'Lexend,sans-serif', fontSize: 17, fontWeight: 800, color: 'var(--text)', margin: 0 }}>
            Envoyer les {nomCanal} {conf.label}
          </h2>
          {etat !== 'envoi' && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex' }}><X size={18} /></button>
          )}
        </div>

        {etat === 'chargement' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10 }}>
            <RefreshCw size={16} style={{ color: '#1d4ed8', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
            <p style={{ fontSize: 12.5, color: 'var(--text)', margin: 0 }}>Vérification des destinataires…</p>
          </div>
        )}

        {apercu?.erreur && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10 }}>
            <AlertCircle size={15} style={{ color: '#b91c1c', flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 12.5, color: '#991b1b', margin: 0 }}>{apercu.erreur}</p>
          </div>
        )}

        {/* ── Avant envoi ─────────────────────────────────────────────── */}
        {etat === 'pret' && apercu && !apercu.erreur && (
          <>
            {nb === 0 ? (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10 }}>
                <CheckCircle size={15} style={{ color: '#15803d', flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 12.5, color: '#15803d', margin: 0 }}>
                  Rien à envoyer : toutes les lignes de ce palier ont déjà reçu leur {estMail ? 'mail' : 'SMS'}.
                </p>
              </div>
            ) : (
              <>
                <div style={{ padding: '14px 16px', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 14 }}>
                  {ligne('Destinataires', nb, true)}
                  {!estMail && ligne('Segments facturés', apercu.cout_segments ?? '—')}
                  {estMail && apercu.expediteur && ligne('Expéditeur', `${apercu.expediteur.name} <${apercu.expediteur.email}>`)}
                  {(apercu.ignores ?? 0) > 0 && ligne('Écartés', apercu.ignores)}
                </div>

                {(apercu.detail_ignores?.length ?? 0) > 0 && (
                  <div style={{ padding: '10px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 9, marginBottom: 14 }}>
                    <p style={{ fontSize: 11.5, color: '#92400e', margin: 0, lineHeight: 1.5 }}>
                      Écartés : {apercu.detail_ignores!.map(i => `#${i.id} (${i.raison})`).join(', ')}
                    </p>
                  </div>
                )}

                {message && (
                  <div style={{ marginBottom: 14 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', margin: '0 0 5px', textTransform: 'uppercase', letterSpacing: '.3px' }}>
                      {estMail ? 'Objet du mail' : 'Message envoyé'}
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--text)', margin: 0, padding: '9px 11px', background: conf.fond, border: `1px solid ${conf.bord}`, borderRadius: 8, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                      {message}
                    </p>
                    {estMail && (
                      <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
                        Le corps du mail vient du modèle Brevo{' '}
                        <strong>{apercu.apercu?.[0]?.template_id ?? '?'}</strong> et n'est pas rendu ici.
                      </p>
                    )}
                  </div>
                )}

                {besoinCoche && (
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '11px 13px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 9, marginBottom: 14, cursor: 'pointer' }}>
                    <input type="checkbox" checked={coche} onChange={e => setCoche(e.target.checked)} style={{ marginTop: 2, cursor: 'pointer' }} />
                    <span style={{ fontSize: 12.5, color: '#991b1b', lineHeight: 1.5 }}>
                      Je confirme l'envoi de {nomCanal} à <strong>{nb} patientes</strong>. Cette action est irréversible.
                    </span>
                  </label>
                )}
              </>
            )}
          </>
        )}

        {etat === 'envoi' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10 }}>
            <RefreshCw size={16} style={{ color: '#1d4ed8', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
            <p style={{ fontSize: 12.5, color: '#1e40af', margin: 0 }}>
              Envoi en cours vers {nb} destinataires… ne fermez pas cette fenêtre.
            </p>
          </div>
        )}

        {/* ── Après envoi ─────────────────────────────────────────────── */}
        {etat === 'fini' && resultat && (
          resultat.erreur ? (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10 }}>
              <AlertCircle size={15} style={{ color: '#b91c1c', flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12.5, color: '#991b1b', margin: 0 }}>{resultat.erreur}</p>
            </div>
          ) : (
            <div style={{ padding: '14px 16px', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10 }}>
              {ligne('Envoyés', resultat.envoyes ?? 0, true)}
              {(resultat.echecs ?? 0) > 0 && ligne('Échecs', resultat.echecs)}
              {!estMail && ligne('Segments facturés', resultat.cout_segments ?? '—')}
              {(resultat.echecs ?? 0) > 0 && (
                <p style={{ fontSize: 11.5, color: '#b45309', margin: '10px 0 0', lineHeight: 1.5 }}>
                  Les échecs sont marqués « {estMail ? 'Mail' : 'SMS'} non livré » dans la liste.
                  Brevo peut encore faire évoluer les autres vers « livré » dans les minutes qui suivent
                  {estMail ? ", puis vers « ouvert » ou « cliqué »" : ''}.
                </p>
              )}
            </div>
          )
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={etat === 'envoi'}>
            {etat === 'fini' ? 'Fermer' : 'Annuler'}
          </button>
          {etat !== 'fini' && (
            <button
              onClick={envoyer}
              disabled={!peutEnvoyer}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700, color: 'white',
                fontFamily: 'Lexend,sans-serif',
                background: peutEnvoyer ? '#dc2626' : '#e5e7eb',
                cursor: peutEnvoyer ? 'pointer' : 'not-allowed',
              }}>
              {etat === 'envoi'
                ? <><RefreshCw size={14} style={{ animation: 'spin .8s linear infinite' }} /> Envoi…</>
                : <><Send size={14} /> Envoyer {nb > 0 ? `les ${nb} ${nomCanal}` : `les ${nomCanal}`}</>}
            </button>
          )}
        </div>
      </div>
    </Portal>
  );
}

const ECHECS_ENVOI = ['echec', 'echec_envoi'];

/**
 * Les vues d'envoi : chaque puce des statistiques est AUSSI un filtre. Voir un compteur
 * donne immédiatement envie de voir les lignes qu'il désigne — c'est la même approche que
 * la barre de filtres du Recouvrement.
 *
 * ⚠️ « Ouverts » inclut les mails CLIQUÉS : un clic implique une ouverture, et W19 pose
 * `email_ouvert_le` dans les deux cas. « dont cliqués » est donc un SOUS-ENSEMBLE, pas une
 * catégorie parallèle — les compteurs du canal mail ne s'additionnent donc pas, et
 * l'étiquette le dit pour que ça ne passe pas pour une incohérence.
 *
 * ⚠️ « À envoyer » du SMS exclut les numéros fixes : aucun SMS ne leur est dû, les compter
 * comme en attente ferait croire à un retard permanent.
 */
type VueEnvoi = {
  id: string;
  libelle: string;
  canal: 'sms' | 'mail' | null;
  alerte?: boolean;
  sousEnsemble?: boolean;
  teste: (f: Facturation) => boolean;
};

const VUES_ENVOI: VueEnvoi[] = [
  { id: 'tout', libelle: 'Toutes', canal: null, teste: () => true },

  { id: 'sms_attente', libelle: 'À envoyer',  canal: 'sms', teste: f => !f.sms_statut && !isFixe(f.telephone) },
  { id: 'sms_envoye',  libelle: 'Envoyés',    canal: 'sms', teste: f => f.sms_statut === 'envoye' },
  { id: 'sms_livre',   libelle: 'Livrés',     canal: 'sms', teste: f => f.sms_statut === 'livre' },
  { id: 'sms_echec',   libelle: 'Non livrés', canal: 'sms', alerte: true, teste: f => ECHECS_ENVOI.includes(f.sms_statut ?? '') },
  { id: 'sms_fixe',    libelle: 'Fixes',      canal: 'sms', teste: f => isFixe(f.telephone) },

  { id: 'mail_attente', libelle: 'À envoyer',   canal: 'mail', teste: f => !f.email_statut },
  { id: 'mail_envoye',  libelle: 'Envoyés',       canal: 'mail', teste: f => f.email_statut === 'envoye' },
  { id: 'mail_livre',   libelle: 'Livrés',        canal: 'mail', teste: f => f.email_statut === 'livre' },
  { id: 'mail_ouvert',  libelle: 'Ouverts',       canal: 'mail', teste: f => f.email_statut === 'ouvert' || f.email_statut === 'clique' },
  { id: 'mail_clique',  libelle: 'dont cliqués',  canal: 'mail', sousEnsemble: true, teste: f => f.email_statut === 'clique' },
  { id: 'mail_echec',   libelle: 'Non livrés',    canal: 'mail', alerte: true, teste: f => ECHECS_ENVOI.includes(f.email_statut ?? '') },
  { id: 'mail_hors',    libelle: 'Hors périmètre', canal: 'mail', teste: f => f.email_statut === 'non_concerne' },
];

const vueParId = (id: string) => VUES_ENVOI.find(v => v.id === id) ?? VUES_ENVOI[0];

// ─── Vue principale ───────────────────────────────────────────────────────────

export function FacturationView({ user }: { user: AuthUser }) {
  const [data, setData]           = useState<FacturationData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [succes, setSucces]       = useState('');
  const [reference, setReference] = useState(aujourdhuiIso());
  const [modal, setModal]         = useState<Palier | null>(null);
  const [modalEnvoi, setModalEnvoi] = useState<{ palier: Palier; canal: Canal } | null>(null);
  const [onglet, setOnglet]       = useState<Palier | 'lots'>('J30');
  const [recherche, setRecherche] = useState('');
  // Filtre issu des statistiques d'envoi ('tout' = aucun).
  const [vue, setVue]             = useState('tout');
  // Groupes dépliés, par « applicable du ». Une valeur explicite l'emporte sur le défaut.
  const [ouverts, setOuverts]     = useState<Record<string, boolean>>({});
  const [echeance, setEcheance]   = useState('');
  // Aperçu par palier, obtenu du workflow d'envoi en `dry_run` : il fournit le texte exact
  // du message ET le nombre réel de destinataires restants. C'est la même source que
  // l'envoi, donc l'aperçu ne peut pas mentir.
  const [apercus, setApercus]     = useState<Record<string, ResultatEnvoi | null>>({});
  // Même principe pour le canal mail : l'aperçu vient du workflow d'envoi lui-même, donc
  // le nombre affiché est exactement celui qui partirait.
  const [apercusMail, setApercusMail] = useState<Record<string, ResultatEnvoi | null>>({});

  const charger = useCallback(async () => {
    setLoading(true);
    const [r, aJ30, aJ15, mJ30, mJ15] = await Promise.all([
      chargerFacturation(user.token),
      envoyerSms(user.token, 'J30', true),
      envoyerSms(user.token, 'J15', true),
      envoyerMail(user.token, 'J30', true),
      envoyerMail(user.token, 'J15', true),
    ]);
    if ('erreur' in r) { setError(r.erreur); setData(null); }
    else { setError(''); setData(r); }
    setApercus({ J30: aJ30, J15: aJ15 });
    setApercusMail({ J30: mJ30, J15: mJ15 });
    setLoading(false);
  }, [user.token]);

  useEffect(() => { charger(); }, [charger]);

  const lignes = data?.facturations ?? [];
  const ajd = aujourdhuiIso();

  // Nombre de lignes déjà en base pour l'échéance que viserait chaque palier.
  const dejaEnBase = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of PALIERS) {
      // `date_echeance` en base est l'« applicable du », pas la fin de location.
      const { applicable } = datesPalier(reference, p.jours);
      m[p.id] = lignes.filter(f => f.palier === p.id && f.date_echeance === applicable).length;
    }
    return m;
  }, [lignes, reference]);

  // Échéances distinctes du palier affiché, pour le filtre.
  const echeances = useMemo(() => {
    if (onglet === 'lots') return [];
    const s = new Set<string>();
    lignes.filter(f => f.palier === onglet).forEach(f => { if (f.date_echeance) s.add(f.date_echeance); });
    // Même ordre que les groupes : le plus récent d'abord, sinon le sélecteur et la liste
    // se liraient à l'envers l'un de l'autre.
    return Array.from(s).sort().reverse();
  }, [lignes, onglet]);

  // Toutes les lignes du palier affiché, AVANT recherche et filtre d'état : c'est sur cet
  // ensemble que portent les statistiques. Les calculer sur la liste filtrée les ferait
  // changer à chaque frappe et elles ne décriraient plus le palier.
  const duPalier = useMemo(
    () => (onglet === 'lots' ? [] : lignes.filter(f => f.palier === onglet)),
    [lignes, onglet],
  );

  const visibles = useMemo(() => {
    if (onglet === 'lots') return [];
    const q = recherche.trim().toLowerCase();
    const v = vueParId(vue);
    return duPalier.filter(f => {
      if (echeance && f.date_echeance !== echeance) return false;
      if (!v.teste(f)) return false;
      if (!q) return true;
      const blob = [f.nom, f.prenom, f.telephone, f.email, f.orthop_prescription].join(' ').toLowerCase();
      return blob.includes(q);
    });
  }, [duPalier, onglet, recherche, echeance, vue]);

  // ── Regroupement par fin de location ────────────────────────────────────────
  // ⚠️ L'extraction quotidienne empile une centaine de lignes par jour : en une semaine,
  // une liste plate devient illisible. Le regroupement suit la façon dont le travail se
  // fait — on traite une échéance à la fois.
  const groupes = useMemo(() => {
    const m = new Map<string, Facturation[]>();
    for (const f of visibles) {
      const k = f.date_echeance || '';
      const a = m.get(k);
      if (a) a.push(f); else m.set(k, [f]);
    }
    // ⚠️ Ordre DÉCROISSANT : l'échéance la plus récente en tête. Chaque jour ajoute une
    // date plus lointaine, et c'est celle-là qu'on traite ; les anciennes sont déjà
    // servies. En ordre croissant, le seul groupe actionnable se retrouvait tout en bas,
    // après une semaine de groupes terminés.
    return Array.from(m.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, lg]) => {
        // Résumé affiché sur l'en-tête replié : seuls les états NON VIDES, pour qu'un
        // groupe sain reste silencieux et qu'un problème saute aux yeux.
        const c = (id: string) => lg.filter(vueParId(id).teste).length;
        // Singulier ET pluriel : « 1 mails à envoyer » se remarque tout de suite.
        const resume = ([
          { s: 'SMS à envoyer',  p: 'SMS à envoyer',   n: c('sms_attente'),  ton: 'attente' },
          { s: 'SMS livré',      p: 'SMS livrés',      n: c('sms_livre'),    ton: 'ok' },
          { s: 'SMS non livré',  p: 'SMS non livrés',  n: c('sms_echec'),    ton: 'echec' },
          { s: 'mail à envoyer', p: 'mails à envoyer', n: c('mail_attente'), ton: 'attente' },
          { s: 'mail ouvert',    p: 'mails ouverts',   n: c('mail_ouvert'),  ton: 'ok' },
          { s: 'mail non livré', p: 'mails non livrés',n: c('mail_echec'),   ton: 'echec' },
        ] as const).filter(x => x.n > 0).map(x => ({ ton: x.ton, n: x.n, libelle: x.n > 1 ? x.p : x.s }));
        return { date, lignes: lg, resume };
      });
  }, [visibles]);

  // Compteurs de la barre de statistiques. ⚠️ Calculés sur `duPalier` — donc sur TOUT le
  // palier, jamais sur la liste filtrée : sinon ils changeraient à chaque frappe dans la
  // recherche et ne décriraient plus rien.
  const puces = (canal: 'sms' | 'mail'): VuePuce[] =>
    VUES_ENVOI.filter(v => v.canal === canal).map(v => ({ ...v, n: duPalier.filter(v.teste).length }));

  // L'échéance que viserait le palier affiché aujourd'hui : son groupe est déplié d'office,
  // c'est celui sur lequel on travaille.
  const echeanceCible = onglet === 'lots' ? '' : datesPalier(reference, palierConf(onglet).jours).applicable;

  // Un choix explicite gagne ; sinon on déplie dès qu'un filtre est actif — recherche OU
  // état d'envoi — sans quoi on demanderait « les 16 non livrés » pour n'obtenir que six
  // en-têtes repliés. Et par défaut, l'échéance du jour : c'est celle sur laquelle on
  // travaille.
  const estOuvert = (d: string) =>
    ouverts[d] ?? (recherche.trim() !== '' || vue !== 'tout' || d === echeanceCible);
  const toutOuvrir = (o: boolean) =>
    setOuverts(Object.fromEntries(groupes.map(g => [g.date, o])));

  // Remet le filtre d'échéance à zéro quand on change d'onglet (il ne veut plus rien dire).
  useEffect(() => { setEcheance(''); setVue('tout'); setOuverts({}); }, [onglet]);

  function exporterCsv() {
    const entetes = ['Palier', 'Nom', 'Prenom', 'Telephone', 'Email', 'Fin de location',
      'Applicable du (ORTHOP)', 'Prescription', 'Dossier', 'Statut SMS', 'Statut mail', 'Extrait le'];
    const cell = (v: unknown) => '"' + String(v ?? '').split('"').join('""') + '"';
    const corps = visibles.map(f => [
      f.palier, f.nom, f.prenom, f.telephone, f.email,
      finDeLocation(f.date_echeance), f.date_echeance,
      f.orthop_prescription, f.orthop_dossier,
      f.sms_statut ?? 'a_envoyer', f.email_statut ?? 'a_envoyer', f.importe_le,
    ].map(cell).join(';'));
    const csv = [entetes.map(cell).join(';'), ...corps].join('\r\n');
    // BOM : sans lui, Excel ouvre les accents en Mojibake.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `facturation_${onglet}_${ajd}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const stats = data?.stats;
  const lots: FacturationLot[] = data?.lots ?? [];

  return (
    <div className="animate-fade-up">
      {/*
        Pas de titre ici : App affiche déjà « Facturation » et la date dans son en-tête de
        page. En remettre un donnait le titre en double à l'écran. Comme RecouvrementView,
        la vue se contente d'une ligne de contexte et place son bouton « Actualiser » dans
        sa propre barre d'outils — celui de l'en-tête d'App rafraîchit les données de
        l'entrant, dont cette vue ne se sert pas.
      */}
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
        Relances préventives par SMS et par e-mail avant l’échéance de l’ordonnance, à deux paliers.
      </p>

      {/* ── L'envoi est actif : le dire, et dire ce qui protège ───────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, marginBottom: 16 }}>
        <MessageSquare size={15} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />
        <p style={{ fontSize: 12.5, color: '#92400e', margin: 0, lineHeight: 1.55 }}>
          <strong>Les envois SMS et e-mail sont actifs.</strong> Rien ne part sans un clic sur
          « SMS » ou « Mail », après une confirmation qui affiche le nombre exact de destinataires et
          le contenu. Les deux canaux sont suivis <strong>séparément</strong> : une patiente déjà servie
          sur un canal ne peut pas y être servie deux fois, même en recliquant, et le mail atteint aussi
          les numéros fixes.
        </p>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 12 }}>
          <AlertCircle size={14} style={{ color: '#dc2626', flexShrink: 0 }} />
          <p style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{error}</p>
        </div>
      )}
      {succes && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, marginBottom: 12 }}>
          <CheckCircle size={14} style={{ color: '#15803d', flexShrink: 0 }} />
          <p style={{ fontSize: 12, color: '#15803d', margin: 0 }}>{succes}</p>
          <button onClick={() => setSucces('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#86efac', display: 'flex' }}><X size={12} /></button>
        </div>
      )}

      {/* ── Date de référence ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'white', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <CalendarClock size={16} style={{ color: 'var(--blue)', flexShrink: 0 }} />
        <label htmlFor="fact-ref" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', fontFamily: 'Lexend,sans-serif' }}>
          Date de référence
        </label>
        <input id="fact-ref" type="date" value={reference} onChange={e => setReference(e.target.value)} style={champStyle} />
        {reference === ajd
          ? <span style={{ fontSize: 11.5, color: '#047857', fontWeight: 600 }}>✓ Aujourd’hui</span>
          : <button onClick={() => setReference(ajd)} style={{ fontSize: 11.5, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
              Revenir à aujourd’hui
            </button>}
        <span style={{ fontSize: 11.5, color: 'var(--muted)', marginLeft: 'auto' }}>
          Les échéances visées sont calculées automatiquement à partir de cette date.
        </span>
        <button className="btn btn-ghost" onClick={charger} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualiser
        </button>
      </div>

      {/* ── Les deux paliers, séparés ────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 20 }}>
        {PALIERS.map(p => {
          const { fin, applicable } = datesPalier(reference, p.jours);
          const stat = p.id === 'J30' ? stats?.j30 : stats?.j15;
          const ap = apercus[p.id] ?? null;
          const apM = apercusMail[p.id] ?? null;
          const restants = ap?.a_envoyer ?? 0;
          const restantsMail = apM?.a_envoyer ?? 0;
          return (
            <div key={p.id} style={{ padding: 18, background: p.fond, border: `1px solid ${p.bord}`, borderRadius: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontFamily: 'Lexend,sans-serif', fontSize: 18, fontWeight: 800, color: p.teinte }}>{p.label}</span>
                <span style={{ fontSize: 11.5, color: p.teinte, opacity: .8 }}>+{p.jours} jours</span>
              </div>
              <p style={{ fontSize: 12, color: p.teinte, opacity: .85, margin: '0 0 14px' }}>{p.texte}</p>

              <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,.7)', borderRadius: 9, marginBottom: 12 }}>
                <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '.3px', fontWeight: 700 }}>
                  Fin de location — la date du SMS
                </p>
                <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0, fontFamily: 'Lexend,sans-serif' }}>
                  {formatDateLongue(fin)}
                </p>
                <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0' }}>
                  Interrogé dans ORTHOP : ordonnances <strong>applicables du {formatDate(applicable)}</strong>
                  {' '}(le lendemain — c'est ainsi qu'ORTHOP les indexe)
                </p>
                <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '6px 0 0' }}>
                  {dejaEnBase[p.id] > 0
                    ? `${dejaEnBase[p.id]} ligne(s) déjà extraite(s) pour cette échéance`
                    : 'Aucune ligne extraite pour cette échéance'}
                </p>
              </div>

              {/* ⚠️ Corrigé le 2026-09-02 : ce n'est PAS une fenêtre glissante de ~34 jours,
                  c'est un MUR FIXE qui avance par sauts. Entre deux lots ORTHOP, la date la plus
                  lointaine disponible ne bouge pas alors que la cible du J-30 avance d'un jour
                  par jour : la marge se consomme toute seule jusqu'à zéro. Constaté les 01 et
                  02/09 — 4 lignes puis 1, sans la moindre erreur. */}
              {p.id === 'J30' && (
                <p style={{ fontSize: 11, color: p.teinte, opacity: .8, margin: '0 0 12px', lineHeight: 1.5 }}>
                  ORTHOP crée ses demandes de renouvellement par lots. Si le lot le plus lointain n'a
                  pas encore été créé, ce palier renvoie une liste quasi vide <strong>sans aucune
                  erreur</strong>. Une liste anormalement courte n'est jamais une journée creuse :
                  relancez l'extraction dès qu'ORTHOP a avancé.
                </p>
              )}

              <SmsApercu texte={ap?.apercu?.[0]?.message ?? null} res={ap} />

              {/* Objet du mail. Le CORPS vit dans le modèle Brevo : il n'est pas rendu ici,
                  et c'est voulu — une copie locale finirait par diverger du modèle réel. */}
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '.3px' }}>
                  Objet du mail
                </p>
                <p style={{ fontSize: 11.5, color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>
                  {apM?.apercu?.[0]?.sujet
                    ? <>{apM.apercu[0].sujet}
                        <span style={{ color: 'var(--muted)' }}> — modèle Brevo {apM.apercu[0].template_id}</span>
                      </>
                    : <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>
                        {apM?.erreur
                          ? `Aperçu indisponible (${apM.erreur})`
                          : (apM?.a_envoyer ?? 0) === 0
                            ? 'Plus aucun mail en attente sur ce palier.'
                            : "Aperçu indisponible (le serveur n'a pas répondu)."}
                      </span>}
                  {/* ⚠️ HORS du ternaire, volontairement : l'expéditeur configuré doit rester
                      lisible même quand il ne reste rien à envoyer — c'est-à-dire la plupart
                      du temps, une fois la cohorte du jour traitée. Placé dans la branche
                      « il y a un aperçu », il disparaissait de l'écran dès 12h30. */}
                  {apM?.expediteur && (
                    <span style={{ display: 'block', color: 'var(--muted)', marginTop: 2 }}>
                      de {apM.expediteur.name} &lt;{apM.expediteur.email}&gt;
                    </span>
                  )}
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, fontSize: 12, color: p.teinte, flexWrap: 'wrap' }}>
                <span><strong style={{ fontSize: 15, fontFamily: 'Lexend,sans-serif' }}>{stat?.total ?? 0}</strong> au total</span>
                <span><strong style={{ fontSize: 15, fontFamily: 'Lexend,sans-serif' }}>{stat?.a_envoyer ?? 0}</strong> SMS à envoyer</span>
                <span><strong style={{ fontSize: 15, fontFamily: 'Lexend,sans-serif' }}>{stat?.mail_a_envoyer ?? 0}</strong> mails à envoyer</span>
                {/* Explique l'écart entre le total et le reste à envoyer : sans ça, un
                    palier à « 734 au total / 0 mail à envoyer » ressemble à une anomalie. */}
                {(stat?.mail_non_concerne ?? 0) > 0 && (
                  <span title="Lignes antérieures à l'ouverture du canal mail, déjà servies par SMS : volontairement exclues, aucun mail ne partira">
                    <strong style={{ fontSize: 15, fontFamily: 'Lexend,sans-serif' }}>{stat!.mail_non_concerne}</strong> hors périmètre
                  </span>
                )}
                {(ap?.cout_segments ?? 0) > 0 && (
                  <span title="Un SMS de plus de 160 caractères est facturé en plusieurs segments">
                    <strong style={{ fontSize: 15, fontFamily: 'Lexend,sans-serif' }}>{ap!.cout_segments}</strong> segments
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => setModal(p.id)} style={{ justifyContent: 'center' }}>
                  <CloudDownload size={14} /> Extraire
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setModalEnvoi({ palier: p.id, canal: 'sms' })}
                    disabled={restants === 0}
                    title={restants === 0
                      ? 'Aucun SMS en attente pour ce palier'
                      : `Envoyer le SMS ${p.label} à ${restants} patientes`}
                    style={styleEnvoi(restants > 0, '#dc2626')}>
                    <MessageSquare size={14} /> SMS{restants > 0 ? ` (${restants})` : ''}
                  </button>
                  <button
                    onClick={() => setModalEnvoi({ palier: p.id, canal: 'mail' })}
                    disabled={restantsMail === 0}
                    title={restantsMail === 0
                      ? 'Aucun mail en attente pour ce palier'
                      : `Envoyer le mail ${p.label} à ${restantsMail} patientes`}
                    style={styleEnvoi(restantsMail > 0, '#7c3aed')}>
                    <Mail size={14} /> Mail{restantsMail > 0 ? ` (${restantsMail})` : ''}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Onglets ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {PALIERS.map(p => {
          const actif = onglet === p.id;
          const n = (p.id === 'J30' ? stats?.j30.total : stats?.j15.total) ?? 0;
          return (
            <button key={p.id} onClick={() => setOnglet(p.id)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9,
              border: `1px solid ${actif ? p.teinte : 'var(--border)'}`, background: actif ? p.teinte : 'white',
              color: actif ? 'white' : 'var(--text)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
              fontFamily: 'Lexend,sans-serif',
            }}>
              {p.label}
              <span style={{ fontSize: 11, opacity: .85, fontWeight: 600 }}>({n})</span>
            </button>
          );
        })}
        <button onClick={() => setOnglet('lots')} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9,
          border: `1px solid ${onglet === 'lots' ? 'var(--text)' : 'var(--border)'}`,
          background: onglet === 'lots' ? 'var(--text)' : 'white',
          color: onglet === 'lots' ? 'white' : 'var(--text)', fontSize: 12.5, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'Lexend,sans-serif',
        }}>
          <Layers size={13} /> Extractions ({lots.length})
        </button>
      </div>

      {/* ── Contenu ──────────────────────────────────────────────────────── */}
      {loading && !data ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 260, gap: 14, color: 'var(--muted)' }}>
          <RefreshCw size={26} style={{ color: 'var(--blue)', animation: 'spin .8s linear infinite' }} />
          <p style={{ fontSize: 13 }}>Chargement…</p>
        </div>
      ) : onglet === 'lots' ? (
        <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>
                {['Palier', 'Fin de location', 'Lignes', 'À envoyer', 'Livrés', 'Échecs', 'Extrait le'].map(h => <th key={h} style={thStyle}>{h}</th>)}
              </tr></thead>
              <tbody>
                {lots.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: 'var(--muted)', padding: '30px 10px' }}>
                    Aucune extraction pour l’instant.
                  </td></tr>
                ) : lots.map(l => {
                  return (
                    <tr key={l.batch_id}>
                      <td style={tdStyle}><PalierChip palier={l.palier} /></td>
                      <td style={tdStyle} title={`Applicable du ${formatDate(l.date_echeance)}`}>
                        {formatDate(finDeLocation(l.date_echeance))}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{l.total}</td>
                      <td style={tdStyle}>{l.a_envoyer}</td>
                      <td style={tdStyle}>{l.livre}</td>
                      <td style={{ ...tdStyle, color: l.echec > 0 ? '#dc2626' : 'var(--muted)' }}>{l.echec}</td>
                      <td style={{ ...tdStyle, color: 'var(--muted)', fontSize: 12 }}>{formatDateTime(l.date_import)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          <StatsBar
            sousTitre={`${duPalier.length} ligne${duPalier.length > 1 ? 's' : ''} sur ce palier`}
            rangees={[
              { titre: 'SMS',  icone: MessageSquare, puces: puces('sms') },
              { titre: 'Mail', icone: Mail,          puces: puces('mail') },
            ]}
            actif={vue === 'tout' ? null : vue}
            onActif={id => setVue(id ?? 'tout')}
            libelleActif={vueParId(vue).libelle}
          />

          {/* Filtres */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <SearchInput
              valeur={recherche}
              onChange={setRecherche}
              placeholder="Nom, prénom, téléphone, email, n° prescription…"
            />
            {echeances.length > 1 && (
              <select value={echeance} onChange={e => setEcheance(e.target.value)} style={{ ...champStyle, cursor: 'pointer' }}>
                <option value="">Toutes les fins de location ({echeances.length})</option>
                {echeances.map(d => <option key={d} value={d}>{formatDate(finDeLocation(d))}</option>)}
              </select>
            )}
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {visibles.length} ligne{visibles.length > 1 ? 's' : ''} · {groupes.length} échéance{groupes.length > 1 ? 's' : ''}
            </span>
            {groupes.length > 1 && (
              <>
                <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => toutOuvrir(true)}>
                  Tout déplier
                </button>
                <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => toutOuvrir(false)}>
                  Tout replier
                </button>
              </>
            )}
            <button className="btn btn-ghost" onClick={exporterCsv} disabled={visibles.length === 0}
              title="Exporter la liste affichée en CSV — pratique pour recouper avec un export ORTHOP"
              style={{ marginLeft: 'auto' }}>
              <Download size={14} /> Exporter en CSV
            </button>
          </div>

          {/* ⚠️ Groupé par échéance, et non en liste plate : l'extraction quotidienne empile
              une centaine de lignes par jour — 769 sur ce seul palier. Le regroupement suit
              la façon dont le travail se fait, une échéance à la fois.
              Ordre DÉCROISSANT : la plus récente est celle qu'on traite. */}
          <GroupedList
            groupes={groupes.map((g): GroupeEntete => {
              const conf = palierConf(onglet);
              const cible = g.date === echeanceCible;
              return {
                cle: g.date,
                titre: formatDateLongue(finDeLocation(g.date)) || '(échéance inconnue)',
                compte: `${g.lignes.length} patiente${g.lignes.length > 1 ? 's' : ''}`,
                puces: g.resume.map(r => ({ texte: `${r.n} ${r.libelle}`, ton: r.ton })),
                marque: cible ? 'échéance visée aujourd’hui' : undefined,
                accent: cible,
                accentBord: conf.bord,
                accentFond: conf.fond,
              };
            })}
            estOuvert={estOuvert}
            onToggle={cle => setOuverts(o => ({ ...o, [cle]: !estOuvert(cle) }))}
            vide={duPalier.length > 0
              ? 'Aucune ligne ne correspond à ce filtre.'
              : `Aucune ligne ${palierConf(onglet).label} — lancez une extraction ci-dessus.`}
            rendu={cle => {
              const g = groupes.find(x => x.date === cle);
              if (!g) return null;
              return (
                /* Pas de colonne « Fin de location » : elle est dans l'en-tête du groupe. */
                <DataTable encadre={false}
                  colonnes={['Patiente', 'Téléphone', 'Email', 'SMS', 'Mail', 'Prescription', 'Extrait le']}>
                  {g.lignes.map(f => (
                    <tr key={f.id}>
                      <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {[f.nom, f.prenom].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <Phone size={11} style={{ color: 'var(--muted)' }} />
                          {f.telephone || '—'}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.email
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <Mail size={11} style={{ color: 'var(--muted)', flexShrink: 0 }} />{f.email}
                            </span>
                          : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={tdStyle}><SmsChip f={f} /></td>
                      <td style={tdStyle}><MailChip f={f} /></td>
                      <td style={tdDiscret}>{f.orthop_prescription || '—'}</td>
                      <td style={tdDiscret}>{formatDateTime(f.importe_le ?? null)}</td>
                    </tr>
                  ))}
                </DataTable>
              );
            }}
          />
        </>
      )}

      {modal && (
        <ExtractionModal
          token={user.token}
          palier={modal}
          reference={reference}
          onClose={() => setModal(null)}
          onDone={(n, p) => {
            setSucces(n > 0
              ? `${n} ligne(s) ajoutée(s) au palier ${palierConf(p).label}.`
              : `Aucune nouvelle ligne pour le palier ${palierConf(p).label} — la liste était déjà à jour.`);
            setOnglet(p);
            charger();
          }}
        />
      )}

      {modalEnvoi && (
        <EnvoiModal
          token={user.token}
          palier={modalEnvoi.palier}
          canal={modalEnvoi.canal}
          onClose={() => setModalEnvoi(null)}
          onFini={r => {
            const n = r.envoyes ?? 0;
            const e = r.echecs ?? 0;
            const quoi = modalEnvoi.canal === 'mail' ? 'mail(s)' : 'SMS';
            setSucces(`${n} ${quoi} envoyé(s)${e > 0 ? `, ${e} en échec` : ''}.`);
            charger();
          }}
        />
      )}
    </div>
  );
}
