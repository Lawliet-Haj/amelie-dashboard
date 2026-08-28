/**
 * Coût d'un SMS : encodage et nombre de segments facturés.
 *
 * ⚠️ Un SEUL caractère hors GSM-7 fait basculer TOUT le message en UCS-2, où la limite
 * tombe de 160 à 70 caractères par segment. Les textes fournis à l'origine contenaient
 * `«`, `»` et l'apostrophe courbe `’` : 270 caractères → **5 segments** au lieu de 2.
 * Les accents `é è à ù ì ò ä ö ü` sont en revanche gratuits (1 unité, comme une lettre).
 * Le `ç` minuscule, lui, n'y est PAS (seul le `Ç` majuscule existe).
 *
 * ⚠️ **Les modèles de SMS ne sont PAS ici.** Ils vivent uniquement dans le workflow n8n
 * `EL - Dashboard Facturation Send SMS` (nœud `Preparer Envois`), qui est la seule source
 * de vérité. Le dashboard n'envoie jamais de texte — il l'affiche en appelant ce workflow
 * en `dry_run`, si bien que l'aperçu montré ne peut pas diverger de ce qui part vraiment.
 * En garder une copie ici serait exactement le piège que ce projet a déjà connu ailleurs.
 */

// Alphabet GSM 03.38 par défaut (128 positions).
const GSM7_BASE =
  '@£$¥èéùìòÇ\nØø\rÅå' +
  'Δ_ΦΓΛΩΠΨΣΘΞ' +
  'ÆæßÉ' +
  ' !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§' +
  '¿abcdefghijklmnopqrstuvwxyzäöñüà';

// Table d'extension : ces caractères existent mais coûtent DEUX unités (échappement).
const GSM7_EXT = '^{}\\[~]|€';

const BASE_SET = new Set(Array.from(GSM7_BASE));
const EXT_SET = new Set(Array.from(GSM7_EXT));

export interface AnalyseSms {
  /** Nombre d'unités facturées (≠ nombre de caractères si extension GSM-7). */
  unites: number;
  /** Le message tient-il dans l'alphabet GSM-7 ? */
  gsm7: boolean;
  /** Nombre de segments réellement facturés par Brevo. */
  segments: number;
  /** Caractères qui forcent l'UCS-2, s'il y en a. */
  fautifs: string[];
  /** Unités restantes avant de basculer sur un segment de plus. */
  marge: number;
}

export function analyserSms(texte: string): AnalyseSms {
  const chars = Array.from(texte ?? '');
  const fautifs: string[] = [];
  let unites = 0;
  for (const c of chars) {
    if (BASE_SET.has(c)) unites += 1;
    else if (EXT_SET.has(c)) unites += 2;
    else {
      unites += 1;
      if (!fautifs.includes(c)) fautifs.push(c);
    }
  }
  const gsm7 = fautifs.length === 0;
  // Un SMS seul : 160 (GSM-7) ou 70 (UCS-2). Concaténé : 153 ou 67 par segment,
  // les 7 caractères manquants servant à l'en-tête de concaténation.
  const limiteSeule = gsm7 ? 160 : 70;
  const limiteSegment = gsm7 ? 153 : 67;
  const taille = gsm7 ? unites : chars.length;
  const segments = taille <= limiteSeule ? 1 : Math.ceil(taille / limiteSegment);
  const plafond = segments === 1 ? limiteSeule : segments * limiteSegment;
  return { unites: taille, gsm7, segments, fautifs, marge: plafond - taille };
}
