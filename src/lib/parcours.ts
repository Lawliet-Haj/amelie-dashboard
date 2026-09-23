/**
 * RETROUVER UNE PATIENTE, ET RACONTER TOUT CE QUI LUI A ÉTÉ FAIT (2026-09-23).
 *
 * Demande du client : *« une barre de recherche pour facilement trouver une personne peu
 * importe quand elle a été insérée dans le parcours, pour qu'on puisse voir toutes les
 * actions qui lui ont été faites »*.
 *
 *   rechercherPatientes()  la recherche, sur TOUT le stock chargé — pas sur la journée
 *   chronologie()          le récit d'un dossier, dans l'ordre où les choses sont arrivées
 *
 * ⚠️ Vit dans `src/lib/`, pas dans la vue : c'est ce qui permet de l'éprouver sur les vraies
 * données sans charger React (la leçon du 2026-09-16 — un contrôle qui recopie les helpers
 * ne voit pas que la source a divergé).
 *
 * ⚠️⚠️ UN CANAL NE GARDE QUE SON DERNIER ENVOI dans `relances` (`sms_le`, `email_le`). Les
 * envois précédents ne survivent que dans deux journaux : l'ARCHIVE posée à l'entrée d'une
 * étape (`relance_evenements`, canal `archive`) et les événements du rail J+7. On lit donc
 * les trois, et on dédoublonne — sans quoi le SMS du J+1 disparaîtrait de l'histoire dès
 * que celui du J+7 est parti.
 */
import type { Relance } from '../types';
import type { Ton } from '../ui/Chip';
import type { EntreeAppel, HistoriquePatiente, LigneParcours, Traitement } from './controleApi';
import { railAtteint, type Rail } from './rails';
import { aujourdhuiIso, jourLocal, parseUtc, formatDuration } from './format';

// ─────────────────────────────────────────────────────────────────────────────
// LA RECHERCHE
// ─────────────────────────────────────────────────────────────────────────────

const sansAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const chiffres = (s: string | null | undefined) => String(s || '').replace(/\D/g, '');

/** Les neuf derniers chiffres : ce qui identifie un numéro français, quel que soit son format. */
const neufDerniers = (tel: string | null | undefined) => chiffres(tel).slice(-9);

export interface PatienteTrouvee {
  /** Clé de regroupement : même numéro ET même nom. */
  cle: string;
  nom: string;
  telephone: string | null;
  email: string | null;
  /** Toutes ses lignes, la plus récente échéance d'abord. */
  lignes: Relance[];
}

/**
 * Cherche dans TOUT le stock, quelle que soit la date d'entrée dans le parcours.
 *
 * Une saisie faite de chiffres (≥ 4, espaces et points tolérés) est un NUMÉRO : on la
 * compare aux chiffres du téléphone, zéro initial ou indicatif 33 retirés — la base porte
 * `+33612…` quand l'équipe tape `06 12…`. Sinon, chaque mot doit se trouver dans le nom,
 * le prénom, l'e-mail ou le n° de prescription, sans tenir compte des accents.
 *
 * ⚠️ Le regroupement se fait sur le NUMÉRO + le NOM, jamais sur le numéro seul : deux
 * sœurs sous le même numéro existent en base, et les fondre en une seule patiente
 * mélangerait leurs deux histoires.
 */
export function rechercherPatientes(relances: Relance[], saisie: string, max = 8): { resultats: PatienteTrouvee[]; total: number } {
  const brut = saisie.trim();
  if (brut.length < 2) return { resultats: [], total: 0 };

  const compact = brut.replace(/[\s.\-()+]/g, '');
  let filtre: (r: Relance) => boolean;
  if (/^[0-9]{4,}$/.test(compact)) {
    let num = compact;
    if (num.startsWith('0033')) num = num.slice(4);
    else if (num.startsWith('33') && num.length > 9) num = num.slice(2);
    else if (num.startsWith('0')) num = num.slice(1);
    // « 0033 » ou « 06 » seuls ne désignent personne : ils feraient sortir tout le stock.
    if (num.length < 3) return { resultats: [], total: 0 };
    filtre = r => chiffres(r.telephone).includes(num) || String(r.orthop_prescription || '') === compact;
  } else {
    const mots = sansAccents(brut).split(/\s+/).filter(Boolean);
    // ⚠️ L'ADRESSE N'ENTRE EN JEU QUE POUR UNE SAISIE QUI Y RESSEMBLE (un « @ », un point, ou
    // un mot de 5 lettres et plus). Sans cela, « ma » trouvait 2 072 patientes sur 2 470 :
    // presque toutes ont une adresse en « gmail ».
    const avecAdresse = /[@.]/.test(brut) || mots.some(m => m.length >= 5);
    filtre = r => {
      const texte = sansAccents([r.nom, r.prenom, r.orthop_prescription, avecAdresse ? r.email : null].filter(Boolean).join(' '));
      return mots.every(m => texte.includes(m));
    };
  }

  const groupes = new Map<string, PatienteTrouvee>();
  for (const r of relances) {
    if (!filtre(r)) continue;
    const nom = [r.nom, r.prenom].filter(Boolean).join(' ').trim();
    const cle = (neufDerniers(r.telephone) || 'id' + r.id) + '|' + sansAccents(nom);
    const g = groupes.get(cle) ?? { cle, nom, telephone: r.telephone, email: r.email ?? null, lignes: [] };
    g.lignes.push(r);
    if (!g.email && r.email) g.email = r.email;
    groupes.set(cle, g);
  }
  const tous = [...groupes.values()];
  for (const g of tous) g.lignes.sort((a, b) => String(b.date_echeance || '').localeCompare(String(a.date_echeance || '')));
  tous.sort((a, b) => String(b.lignes[0].date_echeance || '').localeCompare(String(a.lignes[0].date_echeance || '')));
  return { resultats: tous.slice(0, max), total: tous.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// LA CHRONOLOGIE
// ─────────────────────────────────────────────────────────────────────────────

export type TypeEvenement = 'entree' | 'appel' | 'appel-rate' | 'sms' | 'mail' | 'alerte' | 'controle' | 'orthop';

export interface EvenementAffiche {
  /** Horodatage tel que reçu (UTC, avec ou sans `Z`). */
  quand: string;
  /** Millisecondes, pour trier. */
  t: number;
  /** L'étape où en était la patiente ce jour-là (dernière étape dépassée). */
  etape: Rail | null;
  type: TypeEvenement;
  titre: string;
  detail?: string | null;
  ton: Ton;
  /** Pour les appels : de quoi ouvrir le transcript. */
  appel?: EntreeAppel;
  /** Pour les gestes de l'équipe : qui. */
  par?: string;
}

export interface EtatDossier { texte: string; ton: Ton }

export interface RecitDossier {
  ligne: LigneParcours;
  /** Où en est le dossier AUJOURD'HUI, en clair. */
  etats: EtatDossier[];
  etapeAtteinte: Rail | null;
  evenements: EvenementAffiche[];
  /**
   * Tentatives comptées par le parcours mais absentes du récit. ⚠️ Le rail J+1 ne
   * journalise pas ses échecs de lancement : seule la DERNIÈRE survit dans les colonnes.
   * On le dit plutôt que de laisser « 3/5 tentatives » au-dessus de deux appels.
   */
  tentativesSansTrace: number;
}

const TITRE_APPEL: Record<string, { titre: string; ton: Ton }> = {
  'Répondu SMS':       { titre: 'Appel — elle a parlé', ton: 'ok' },
  'Répondu transfert': { titre: 'Appel — transférée à une conseillère', ton: 'ok' },
  'Répondeur':         { titre: 'Appel — messagerie', ton: 'attente' },
  'Raccroché':         { titre: 'Appel — a décroché puis raccroché', ton: 'attente' },
  'Non répondu':       { titre: 'Appel — sans réponse', ton: 'attente' },
};

function titreSms(statut: string | null | undefined): { titre: string; ton: Ton } {
  switch (statut) {
    case 'livre':       return { titre: 'SMS livré', ton: 'ok' };
    case 'envoye':      return { titre: 'SMS envoyé — livraison non confirmée', ton: 'encours' };
    case 'echec':       return { titre: 'SMS non livré', ton: 'echec' };
    case 'echec_envoi': return { titre: 'SMS jamais parti', ton: 'echec' };
    default:            return { titre: 'SMS' + (statut ? ' (' + statut + ')' : ''), ton: 'neutre' };
  }
}

/** L'ENVOI du mail. Ouverture et clic sont des événements à part, à leur propre date. */
function titreMail(statut: string | null | undefined): { titre: string; ton: Ton } {
  switch (statut) {
    case 'livre': case 'ouvert': case 'clique':
                        return { titre: 'Mail livré', ton: 'ok' };
    case 'envoye':      return { titre: 'Mail envoyé — livraison non confirmée', ton: 'encours' };
    case 'echec':       return { titre: 'Mail non livré', ton: 'echec' };
    case 'echec_envoi': return { titre: 'Mail jamais parti', ton: 'echec' };
    default:            return { titre: 'Mail' + (statut ? ' (' + statut + ')' : ''), ton: 'neutre' };
  }
}

/**
 * La raison d'un appel non composé, en français courant.
 *
 * ⚠️ Le texte brut de l'opérateur (« sip status: 503: Trunk CPS limit exceeded ») est
 * exact mais illisible pour l'équipe de contrôle. On le traduit pour les cas connus, et on
 * garde le code entre parenthèses : c'est lui qu'on cite pour creuser. Un message inconnu
 * reste affiché tel quel — mieux vaut un texte technique qu'une traduction inventée.
 */
export function raisonEchec(brut: string | null | undefined): string | null {
  if (!brut) return null;
  const s = String(brut);
  const code = (s.match(/sip status:\s*(\d{3})/i) || s.match(/\(SIP (\d{3})\)/))?.[1];
  const suffixe = code ? ' (code ' + code + ')' : '';
  if (/CPS limit/i.test(s)) return 'Ligne d’appel saturée : trop d’appels lancés dans la même seconde' + suffixe;
  if (code === '480') return 'Téléphone injoignable (éteint ou hors réseau)' + suffixe;
  if (code === '486' || /busy/i.test(s)) return 'Ligne occupée' + suffixe;
  if (code === '404') return 'Numéro inexistant' + suffixe;
  if (code === '603' || /decline/i.test(s)) return 'Appel rejeté par le téléphone' + suffixe;
  if (code === '408') return 'Le réseau n’a pas répondu' + suffixe;
  if (/^[ÉE]chec d[ée]clenchement$/i.test(s.trim())) return 'Le lancement de l’appel a échoué';
  return s;
}

const temps = (s: string | null | undefined) => parseUtc(s)?.getTime() ?? NaN;
const TROIS_MINUTES = 3 * 60 * 1000;

/**
 * Le récit de chaque dossier d'une patiente.
 *
 * ⚠️ Aucune date n'est recalculée : l'étape d'un événement vient de `railAtteint()` au jour
 * de l'événement, le seul dépositaire des écarts restant `ecartEcheance()`.
 */
export function chronologie(h: HistoriquePatiente, auj: string = aujourdhuiIso()): RecitDossier[] {
  return h.lignes.map(l => {
    const pourRail = l as unknown as Relance;   // `railAtteint` ne lit que `date_echeance`
    const evts: EvenementAffiche[] = [];
    const ajouter = (e: Omit<EvenementAffiche, 't' | 'etape'>) => {
      const t = temps(e.quand);
      if (!Number.isFinite(t)) return;
      evts.push({ ...e, t, etape: railAtteint(pourRail, jourLocal(e.quand)) });
    };

    // ── L'entrée dans le parcours ──
    if (l.importe_le) {
      ajouter({
        quand: l.importe_le, type: 'entree', ton: 'neutre',
        titre: 'Entrée dans le parcours',
        detail: l.batch_label ? 'Liste : ' + l.batch_label : null,
      });
    }

    // ── Les appels ──
    const appels = Array.isArray(l.call_history) ? l.call_history : [];
    for (const a of appels) {
      const c = TITRE_APPEL[a.statut || ''] ?? { titre: 'Appel' + (a.statut ? ' — ' + a.statut : ''), ton: 'neutre' as Ton };
      ajouter({
        quand: a.ts, type: 'appel', ton: c.ton, titre: c.titre, appel: a,
        detail: [a.resultat, a.duree ? formatDuration(a.duree) : null].filter(Boolean).join(' · ') || null,
      });
    }
    // ⚠️ Lignes anciennes : l'historique d'appels n'existait pas encore, seul le dernier
    // appel est dans les colonnes. On le raconte plutôt que de le taire.
    if (appels.length === 0 && l.dernier_appel && (l.transcript || l.resultat_ia)) {
      const c = TITRE_APPEL[l.statut || ''] ?? { titre: 'Appel', ton: 'neutre' as Ton };
      ajouter({
        quand: l.dernier_appel, type: 'appel', ton: c.ton, titre: c.titre,
        appel: { ts: l.dernier_appel, statut: l.statut, duree: l.duree_sec, resultat: l.resultat_ia, transcript: l.transcript, sentiment: l.sentiment },
        detail: l.resultat_ia,
      });
    }

    // ── Les appels qui n'ont pas pu être composés ──
    const echecs = h.evenements.filter(e => e.relance_id === l.id && e.canal === 'appel' && e.evenement === 'echec_lancement');
    for (const e of echecs) {
      ajouter({ quand: e.cree_le, type: 'appel-rate', ton: 'echec', titre: 'Appel non composé', detail: raisonEchec(e.detail) });
    }
    // Le rail J+1 ne journalise pas ses échecs : seule la dernière trace est dans les colonnes.
    if (l.dernier_echec && !echecs.some(e => Math.abs(temps(e.cree_le) - temps(l.dernier_echec)) < TROIS_MINUTES)) {
      ajouter({ quand: l.dernier_echec, type: 'appel-rate', ton: 'echec', titre: 'Appel non composé', detail: raisonEchec(l.echec_motif) });
    }

    // Un appel LANCÉ dont rien n'est revenu (ni post-call, ni échec de lancement) : l'écran
    // de contrôle l'appelle « Appel lancé, aucun résultat enregistré ». Le taire ferait
    // disparaître une tentative qui a pourtant consommé un essai.
    const QUINZE_MINUTES = 15 * 60 * 1000;
    if (l.dernier_appel) {
      const t0 = temps(l.dernier_appel);
      const explique = evts.some(e => (e.type === 'appel' || e.type === 'appel-rate') && Math.abs(e.t - t0) < QUINZE_MINUTES);
      if (!explique) {
        ajouter({ quand: l.dernier_appel, type: 'appel-rate', ton: 'neutre', titre: 'Appel lancé — aucun résultat enregistré' });
      }
    }

    // ── Les écrits : colonnes (dernier envoi), puis archive, puis journal du J+7 ──
    // ⚠️ L'ORDRE EST UNE PRIORITÉ : la colonne porte le statut le plus à jour (le rapport
    // de livraison y arrive), l'archive un état figé, le journal seulement « envoyé ». Un
    // même envoi vu par deux sources n'est gardé qu'une fois, sous la plus renseignée.
    const ecrits: Omit<EvenementAffiche, 't' | 'etape'>[] = [];
    const ecrit = (type: 'sms' | 'mail', quand: string | null | undefined, c: { titre: string; ton: Ton }, detail?: string) => {
      if (quand) ecrits.push({ quand, type, titre: c.titre, ton: c.ton, detail: detail ?? null });
    };
    ecrit('sms', l.sms_le, titreSms(l.sms_statut));
    ecrit('mail', l.email_le, titreMail(l.email_statut));
    ecrit('mail', l.email_ouvert_le, { titre: 'Mail ouvert', ton: 'ok' });
    ecrit('mail', l.email_clic_le, { titre: 'Lien du mail cliqué', ton: 'fort' });
    for (const e of h.evenements.filter(x => x.relance_id === l.id && x.canal === 'archive')) {
      let a: Record<string, string | null>;
      try { a = JSON.parse(e.detail || '{}'); } catch { continue; }
      ecrit('sms', a.sms_le, titreSms(a.sms));
      ecrit('mail', a.mail_le, titreMail(a.mail));
      ecrit('mail', a.mail_ouvert_le, { titre: 'Mail ouvert', ton: 'ok' });
      ecrit('mail', a.mail_clic_le, { titre: 'Lien du mail cliqué', ton: 'fort' });
    }
    for (const e of h.evenements.filter(x => x.relance_id === l.id && x.canal === 'sms')) {
      ecrit('sms', e.cree_le, titreSms(e.evenement === 'echec_envoi' ? 'echec_envoi' : 'envoye'));
    }
    const gardes: Omit<EvenementAffiche, 't' | 'etape'>[] = [];
    for (const c of ecrits) {
      const t = temps(c.quand);
      // Deux « Mail ouvert » ne se confondent qu'entre eux : on compare le TITRE pour les
      // ouvertures et clics, le seul type pour les envois.
      const famille = (x: typeof c) => /ouvert|cliqué/.test(x.titre) ? x.titre : x.type;
      if (gardes.some(g => famille(g) === famille(c) && Math.abs(temps(g.quand) - t) < TROIS_MINUTES)) continue;
      gardes.push(c);
    }
    gardes.forEach(ajouter);

    // ── Les signalements à l'équipe ──
    for (const e of h.evenements.filter(x => x.relance_id === l.id && x.canal === 'alerte')) {
      ajouter({
        quand: e.cree_le, type: 'alerte', ton: 'attente',
        titre: e.evenement === 'mecontentement'
          ? 'Signalée à l’équipe : patiente mécontente'
          : 'Signalée à l’équipe : dit avoir déjà envoyé son ordonnance',
      });
    }

    // ── Les gestes de l'équipe de contrôle ──
    for (const t of h.traitements.filter((x: Traitement) => x.relance_id === l.id)) {
      ajouter({
        quand: t.traite_le, type: 'controle', ton: 'ok', par: t.traite_par,
        titre: t.verif_orthop
          ? 'Vérifiée dans ORTHOP par ' + t.traite_par + ' — ' + (t.verif_orthop === 'recue' ? 'ordonnance reçue' : 'pas encore reçue')
          : 'Traitée par ' + t.traite_par,
        detail: t.commentaire,
      });
    }

    // ── La sortie du parcours ──
    if (l.resolu_le) {
      ajouter({
        quand: l.resolu_le, type: 'orthop', ton: 'ok',
        titre: 'Ordonnance reçue — ORTHOP ne la réclame plus, sortie du parcours',
      });
    }

    evts.sort((a, b) => a.t - b.t);

    const etats: EtatDossier[] = [];
    if (l.resolu_le) etats.push({ texte: 'Ordonnance reçue', ton: 'ok' });
    else if (l.fin_application && String(l.fin_application).slice(0, 10) > auj) {
      etats.push({ texte: 'Couverte jusqu’au ' + String(l.fin_application).slice(8, 10) + '/' + String(l.fin_application).slice(5, 7), ton: 'ok2' });
    } else etats.push({ texte: 'ORTHOP réclame toujours l’ordonnance', ton: 'attente' });
    if (l.ordonnance_deja_envoyee) etats.push({ texte: 'Dit avoir envoyé — à vérifier', ton: 'attente' });

    const visibles = evts.filter(e => e.type === 'appel' || e.type === 'appel-rate').length;
    return {
      ligne: l, etats, etapeAtteinte: railAtteint(pourRail, auj), evenements: evts,
      tentativesSansTrace: Math.max(0, (l.nb_tentatives ?? 0) - visibles),
    };
  });
}
