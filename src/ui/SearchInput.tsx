import { Search, X } from 'lucide-react';

/**
 * Champ de recherche avec effacement.
 *
 * ⚠️ Le bouton d'effacement n'est pas cosmétique : sans lui, sortir d'une recherche demande
 * de sélectionner le texte puis de le supprimer, et une recherche active modifie l'affichage
 * (les groupes se déplient). On doit pouvoir revenir à l'état neutre d'un seul clic.
 */
export function SearchInput({
  valeur, onChange, placeholder = 'Rechercher…', largeur = 300,
}: {
  valeur: string;
  onChange: (v: string) => void;
  placeholder?: string;
  largeur?: number;
}) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--muted)', pointerEvents: 'none' }} />
      <input
        value={valeur}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: largeur, paddingLeft: 30, paddingRight: valeur ? 26 : 10,
          height: 32, borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
          fontSize: 'var(--fs-md)', color: 'var(--text)', background: 'var(--card)',
          fontFamily: 'inherit', outline: 'none',
        }}
      />
      {valeur !== '' && (
        <button
          onClick={() => onChange('')}
          title="Effacer la recherche"
          aria-label="Effacer la recherche"
          style={{
            position: 'absolute', right: 6, background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--muted)', display: 'flex', padding: 2,
          }}>
          <X size={13} />
        </button>
      )}
    </div>
  );
}
