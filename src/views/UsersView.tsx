import { useState, useEffect, useCallback, useRef } from 'react';
import { UserPlus, Pencil, UserX, ShieldCheck, User as UserIcon, RefreshCw, X, Eye, EyeOff, Users, Plus, Trash2, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import type { AuthUser, DashboardUser } from '../types';
import { Portal } from '../lib/Portal';

const API = 'https://n8n.srv778935.hstgr.cloud/webhook/dashboard-users';

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiUsers(body: Record<string, unknown>, token: string) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return res.json();
}

// ─── Modal ────────────────────────────────────────────────────────────────────

type ModalMode = 'create' | 'edit';

interface UserFormData {
  username: string;
  nom: string;
  email: string;
  role: 'admin' | 'conseillere' | 'recouvrement';
  password: string;
}

function UserModal({
  mode, initial, onSave, onClose, saving,
}: {
  mode: ModalMode;
  initial?: DashboardUser;
  onSave: (data: UserFormData) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<UserFormData>({
    username: initial?.username ?? '',
    nom:      initial?.nom ?? '',
    email:    initial?.email ?? '',
    role:     (initial?.role as 'admin' | 'conseillere' | 'recouvrement') ?? 'conseillere',
    password: '',
  });
  const [showPwd, setShowPwd] = useState(false);

  const set = (k: keyof UserFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const inputCls: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 9, fontSize: 13,
    border: '1px solid var(--border)', fontFamily: 'DM Sans, sans-serif',
    color: 'var(--text)', background: 'white', outline: 'none',
  };

  const labelCls: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.8px',
    textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 5,
    fontFamily: 'Lexend, sans-serif',
  };

  return (
    <Portal>
      <div className="panel-overlay animate-fade-in" onClick={onClose} />
      <div className="modal-dialog animate-fade-up" style={{ zIndex: 60 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>
            {mode === 'create' ? 'Nouvel utilisateur' : 'Modifier l\'utilisateur'}
          </h3>
          <button onClick={onClose} style={{ background: 'var(--blue-faint)', border: 'none', borderRadius: 8, padding: 7, cursor: 'pointer', display: 'flex' }}>
            <X size={15} style={{ color: 'var(--muted)' }} />
          </button>
        </div>

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelCls}>Identifiant</label>
              <input style={inputCls} value={form.username} onChange={set('username')}
                placeholder="ex: sophie" disabled={mode === 'edit'} />
            </div>
            <div>
              <label style={labelCls}>Nom complet</label>
              <input style={inputCls} value={form.nom} onChange={set('nom')} placeholder="ex: Sophie Martin" />
            </div>
          </div>
          <div>
            <label style={labelCls}>Email</label>
            <input style={inputCls} type="email" value={form.email} onChange={set('email')} placeholder="sophie@example.com" />
          </div>
          <div>
            <label style={labelCls}>Rôle</label>
            <select style={{ ...inputCls, cursor: 'pointer' }} value={form.role} onChange={set('role')}>
              <option value="conseillere">Conseillère</option>
              <option value="recouvrement">Recouvrement</option>
              <option value="facturation">Facturation</option>
              <option value="admin">Administrateur</option>
            </select>
          </div>
          <div>
            <label style={labelCls}>
              {mode === 'create' ? 'Mot de passe' : 'Nouveau mot de passe (laisser vide = inchangé)'}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                style={{ ...inputCls, paddingRight: 40 }}
                type={showPwd ? 'text' : 'password'}
                value={form.password}
                onChange={set('password')}
                placeholder={mode === 'create' ? 'Mot de passe' : '••••••••'}
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)',
                  display: 'flex', padding: 0,
                }}
              >
                {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
          <button onClick={onClose} className="btn btn-ghost">Annuler</button>
          <button
            onClick={() => onSave(form)}
            disabled={saving || !form.username || (mode === 'create' && !form.password)}
            className="btn btn-primary"
          >
            {saving ? <RefreshCw size={13} className="animate-spin" /> : null}
            {mode === 'create' ? 'Créer' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </Portal>
  );
}

// ─── Delete Confirm ───────────────────────────────────────────────────────────

function ConfirmModal({ user, onConfirm, onClose, saving }: {
  user: DashboardUser; onConfirm: () => void; onClose: () => void; saving: boolean;
}) {
  return (
    <Portal>
      <div className="panel-overlay animate-fade-in" onClick={onClose} />
      <div className="modal-dialog animate-fade-up" style={{ zIndex: 60, maxWidth: 380 }}>
        <div style={{ textAlign: 'center', padding: '8px 0 20px' }}>
          <div style={{
            width: 50, height: 50, borderRadius: '50%', background: '#fef2f2',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px',
          }}>
            <UserX size={22} style={{ color: '#dc2626' }} />
          </div>
          <h3 style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
            Supprimer {user.nom} ?
          </h3>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            L'utilisateur <strong>{user.username}</strong> sera définitivement supprimé. Cette action est irréversible.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn btn-ghost" style={{ flex: 1 }}>Annuler</button>
          <button onClick={onConfirm} disabled={saving} className="btn" style={{ flex: 1, background: '#dc2626', color: 'white' }}>
            {saving ? <RefreshCw size={13} className="animate-spin" /> : <UserX size={13} />}
            Supprimer
          </button>
        </div>
      </div>
    </Portal>
  );
}

// ─── Bulk Import Modal ────────────────────────────────────────────────────────

let _bulkRowId = 0;

interface BulkRow {
  id: number;
  username: string;
  nom: string;
  email: string;
  role: 'admin' | 'conseillere' | 'recouvrement';
  password: string;
  status: 'idle' | 'loading' | 'ok' | 'error';
  errorMsg?: string;
}

function emptyRow(): BulkRow {
  return { id: ++_bulkRowId, username: '', nom: '', email: '', role: 'conseillere', password: '', status: 'idle' };
}

function BulkImportModal({
  onClose, onDone, token,
}: {
  onClose: () => void;
  onDone: () => void;
  token: string;
}) {
  const [rows, setRows]       = useState<BulkRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [running, setRunning] = useState(false);
  const [done, setDone]       = useState(false);
  const bodyRef               = useRef<HTMLDivElement>(null);

  const update = (id: number, patch: Partial<BulkRow>) =>
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));

  const addRow = () => {
    setRows(rs => [...rs, emptyRow()]);
    setTimeout(() => bodyRef.current?.scrollTo({ top: 99999, behavior: 'smooth' }), 50);
  };

  const removeRow = (id: number) =>
    setRows(rs => rs.filter(r => r.id !== id));

  const validRows = rows.filter(r => r.username.trim() && r.password.trim());

  const handleCreate = async () => {
    if (!validRows.length) return;
    setRunning(true);
    for (const r of rows) {
      if (!r.username.trim() || !r.password.trim()) continue;
      update(r.id, { status: 'loading' });
      try {
        const res = await apiUsers({
          action: 'create',
          username: r.username.trim(),
          nom: r.nom.trim(),
          email: r.email.trim(),
          role: r.role,
          password: r.password,
        }, token);
        if (res.ok) {
          update(r.id, { status: 'ok' });
        } else {
          update(r.id, { status: 'error', errorMsg: res.error ?? 'Erreur inconnue' });
        }
      } catch {
        update(r.id, { status: 'error', errorMsg: 'Serveur inaccessible' });
      }
    }
    setRunning(false);
    setDone(true);
    onDone();
  };

  const colW = ['145px', '145px', '165px', '115px', '130px', '36px'];
  const inputSm: React.CSSProperties = {
    width: '100%', padding: '6px 8px', borderRadius: 7, fontSize: 12,
    border: '1px solid var(--border)', fontFamily: 'DM Sans, sans-serif',
    color: 'var(--text)', background: 'white', outline: 'none', boxSizing: 'border-box',
  };

  const okCount    = rows.filter(r => r.status === 'ok').length;
  const errCount   = rows.filter(r => r.status === 'error').length;

  return (
    <Portal>
      <div className="panel-overlay animate-fade-in" onClick={!running ? onClose : undefined} />
      <div
        className="modal-dialog animate-fade-up"
        style={{ zIndex: 60, maxWidth: 820, width: '95vw', padding: 0, overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#6366f1,#7c3aed)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Users size={15} style={{ color: 'white' }} />
            </div>
            <div>
              <h3 style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 15, color: 'var(--text)', lineHeight: 1 }}>
                Saisie groupée
              </h3>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                Remplissez les lignes puis cliquez sur «&nbsp;Créer tout&nbsp;»
              </p>
            </div>
          </div>
          <button onClick={!running ? onClose : undefined} style={{
            background: 'var(--blue-faint)', border: 'none', borderRadius: 8, padding: 7,
            cursor: running ? 'not-allowed' : 'pointer', display: 'flex', opacity: running ? 0.4 : 1,
          }}>
            <X size={15} style={{ color: 'var(--muted)' }} />
          </button>
        </div>

        {/* Column headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: colW.join(' '),
          gap: 6, padding: '8px 20px 6px',
          background: 'var(--bg-page)',
          borderBottom: '1px solid var(--border)',
        }}>
          {['Identifiant *', 'Nom complet', 'Email', 'Rôle', 'Mot de passe *', ''].map((h, i) => (
            <div key={i} style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.7px',
              textTransform: 'uppercase', color: 'var(--muted)', fontFamily: 'Lexend,sans-serif',
            }}>{h}</div>
          ))}
        </div>

        {/* Rows */}
        <div ref={bodyRef} style={{ maxHeight: 360, overflowY: 'auto', padding: '8px 20px' }}>
          {rows.map((r, idx) => (
            <div key={r.id} style={{ marginBottom: 6 }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: colW.join(' '),
                gap: 6,
                alignItems: 'center',
                opacity: r.status === 'ok' ? 0.6 : 1,
              }}>
                {/* Username */}
                <input
                  style={{ ...inputSm, borderColor: r.status === 'error' ? '#fca5a5' : undefined }}
                  value={r.username}
                  onChange={e => update(r.id, { username: e.target.value })}
                  placeholder={`user${idx + 1}`}
                  disabled={running || r.status === 'ok'}
                />
                {/* Nom */}
                <input
                  style={inputSm}
                  value={r.nom}
                  onChange={e => update(r.id, { nom: e.target.value })}
                  placeholder="Nom Prénom"
                  disabled={running || r.status === 'ok'}
                />
                {/* Email */}
                <input
                  style={inputSm}
                  type="email"
                  value={r.email}
                  onChange={e => update(r.id, { email: e.target.value })}
                  placeholder="email@example.com"
                  disabled={running || r.status === 'ok'}
                />
                {/* Rôle */}
                <select
                  style={{ ...inputSm, cursor: running || r.status === 'ok' ? 'not-allowed' : 'pointer' }}
                  value={r.role}
                  onChange={e => update(r.id, { role: e.target.value as 'admin' | 'conseillere' | 'recouvrement' })}
                  disabled={running || r.status === 'ok'}
                >
                  <option value="conseillere">Conseillère</option>
                  <option value="recouvrement">Recouvrement</option>
                  <option value="facturation">Facturation</option>
                  <option value="admin">Admin</option>
                </select>
                {/* Password */}
                <input
                  style={{ ...inputSm, borderColor: r.status === 'error' ? '#fca5a5' : undefined }}
                  type="password"
                  value={r.password}
                  onChange={e => update(r.id, { password: e.target.value })}
                  placeholder="••••••••"
                  disabled={running || r.status === 'ok'}
                />
                {/* Delete */}
                <button
                  onClick={() => removeRow(r.id)}
                  disabled={running || rows.length === 1}
                  style={{
                    background: 'none', border: 'none', cursor: running || rows.length === 1 ? 'not-allowed' : 'pointer',
                    color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: running || rows.length === 1 ? 0.3 : 0.7, padding: 4,
                  }}
                  title="Supprimer la ligne"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Status / error row */}
              {r.status !== 'idle' && (
                <div style={{ paddingLeft: 4, marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {r.status === 'loading' && <Loader2 size={12} style={{ color: 'var(--blue)', animation: 'spin 0.7s linear infinite' }} />}
                  {r.status === 'ok'      && <CheckCircle2 size={12} style={{ color: '#16a34a' }} />}
                  {r.status === 'error'   && <AlertCircle  size={12} style={{ color: '#dc2626' }} />}
                  <span style={{ fontSize: 11, color: r.status === 'ok' ? '#16a34a' : r.status === 'error' ? '#dc2626' : 'var(--muted)' }}>
                    {r.status === 'loading' ? 'Création en cours…'
                      : r.status === 'ok'  ? 'Compte créé — email envoyé'
                      : r.errorMsg}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 20px 16px', borderTop: '1px solid var(--border)',
          background: 'var(--bg-page)',
        }}>
          <button
            onClick={addRow}
            disabled={running || done}
            className="btn btn-ghost btn-sm"
            style={{ opacity: running || done ? 0.4 : 1 }}
          >
            <Plus size={13} />
            Ajouter une ligne
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {done && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {okCount > 0 && <span style={{ color: '#16a34a', fontWeight: 600 }}>{okCount} créé{okCount > 1 ? 's' : ''}</span>}
                {okCount > 0 && errCount > 0 && ' · '}
                {errCount > 0 && <span style={{ color: '#dc2626', fontWeight: 600 }}>{errCount} erreur{errCount > 1 ? 's' : ''}</span>}
              </span>
            )}
            {done ? (
              <button onClick={onClose} className="btn btn-primary btn-sm">
                Fermer
              </button>
            ) : (
              <>
                <button onClick={!running ? onClose : undefined} className="btn btn-ghost btn-sm" style={{ opacity: running ? 0.4 : 1 }}>
                  Annuler
                </button>
                <button
                  onClick={handleCreate}
                  disabled={running || validRows.length === 0}
                  className="btn btn-primary btn-sm"
                >
                  {running
                    ? <><Loader2 size={13} className="animate-spin" /> Création…</>
                    : <><CheckCircle2 size={13} /> Créer tout ({validRows.length})</>}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

// ─── Users View ───────────────────────────────────────────────────────────────

export function UsersView({ currentUser }: { currentUser: AuthUser }) {
  const [users, setUsers]         = useState<DashboardUser[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [modal, setModal]         = useState<{ mode: ModalMode; user?: DashboardUser } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DashboardUser | null>(null);
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState<string | null>(null);
  const [showBulk, setShowBulk]   = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiUsers({ action: 'list' }, currentUser.token);
      if (res.ok) setUsers(res.users ?? []);
      else setError(res.error ?? 'Erreur de chargement');
    } catch {
      setError('Impossible de contacter le serveur');
    } finally {
      setLoading(false);
    }
  }, [currentUser.token]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleSave = async (form: UserFormData) => {
    setSaving(true);
    try {
      const isEdit = modal?.mode === 'edit';
      const body: Record<string, unknown> = {
        action: isEdit ? 'update' : 'create',
        username: form.username,
        nom: form.nom,
        email: form.email,
        role: form.role,
      };
      if (form.password) body.password = form.password;
      if (isEdit && modal?.user) body.id = modal.user.id;

      const res = await apiUsers(body, currentUser.token);
      if (res.ok) {
        showToast(isEdit ? 'Utilisateur mis à jour ✓' : 'Utilisateur créé ✓');
        setModal(null);
        loadUsers();
      } else {
        showToast(`Erreur : ${res.error}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const res = await apiUsers({ action: 'delete', id: deleteTarget.id }, currentUser.token);
      if (res.ok) {
        showToast('Utilisateur supprimé ✓');
        setDeleteTarget(null);
        loadUsers();
      } else {
        showToast(`Erreur : ${res.error}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 18, right: 18, zIndex: 200,
          background: toast.startsWith('Erreur') ? '#dc2626' : '#16a34a',
          color: 'white', padding: '10px 18px', borderRadius: 10,
          fontFamily: 'Lexend,sans-serif', fontSize: 13, fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,.2)',
          animation: 'toastSlide 0.3s ease both',
        }}>
          {toast}
        </div>
      )}

      {/* Modals */}
      {modal && (
        <UserModal
          mode={modal.mode}
          initial={modal.user}
          onSave={handleSave}
          onClose={() => setModal(null)}
          saving={saving}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          user={deleteTarget}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
          saving={saving}
        />
      )}
      {showBulk && (
        <BulkImportModal
          token={currentUser.token}
          onClose={() => setShowBulk(false)}
          onDone={loadUsers}
        />
      )}

      {/* Header card */}
      <div className="card animate-fade-up" style={{ padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ fontFamily: 'Lexend,sans-serif', fontWeight: 700, fontSize: 15 }}>
            Gestion des utilisateurs
          </h3>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
            {users.filter(u => u.actif !== false).length} compte{users.filter(u => u.actif !== false).length !== 1 ? 's' : ''} actif{users.filter(u => u.actif !== false).length !== 1 ? 's' : ''}{users.some(u => u.actif === false) ? ` · ${users.filter(u => u.actif === false).length} inactif${users.filter(u => u.actif === false).length !== 1 ? 's' : ''}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={loadUsers} className="btn btn-ghost btn-sm">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setShowBulk(true)} className="btn btn-ghost btn-sm">
            <Users size={13} />
            Saisie multiple
          </button>
          <button onClick={() => setModal({ mode: 'create' })} className="btn btn-primary btn-sm">
            <UserPlus size={13} />
            Ajouter
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card animate-fade-up" style={{ overflow: 'hidden' }}>
        {error ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#dc2626', fontSize: 13 }}>
            ⚠ {error}
          </div>
        ) : loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)' }}>
            <RefreshCw size={20} style={{ animation: 'spin 0.8s linear infinite', color: 'var(--blue)' }} />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  {['Utilisateur', 'Nom', 'Email', 'Rôle', 'Créé le', 'Dernière connexion', 'Actions'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={i} style={{ opacity: u.actif === false ? 0.55 : 1 }}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <div style={{
                          width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                          background: u.actif === false
                            ? 'linear-gradient(135deg,#94a3b8,#64748b)'
                            : u.role === 'admin'
                            ? 'linear-gradient(135deg,#6366f1,#4f46e5)'
                            : u.role === 'recouvrement'
                            ? 'linear-gradient(135deg,#d97706,#b45309)'
                            : u.role === 'facturation'
                            ? 'linear-gradient(135deg,#0d9488,#0f766e)'
                            : 'linear-gradient(135deg,#2d7fc2,#1a5ea0)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 800, color: 'white',
                          fontFamily: 'Lexend,sans-serif',
                        }}>
                          {String(u.username || '').charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>
                          {u.username}
                        </span>
                        {u.username === currentUser.username && (
                          <span style={{ fontSize: 10, padding: '1px 6px', background: 'var(--blue-light)', color: 'var(--blue-dark)', borderRadius: 4, fontWeight: 700 }}>
                            vous
                          </span>
                        )}
                        {u.actif === false && (
                          <span style={{ fontSize: 10, padding: '1px 6px', background: '#fee2e2', color: '#dc2626', borderRadius: 4, fontWeight: 700 }}>
                            inactif
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ fontSize: 13 }}>{u.nom}</td>
                    <td style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>{u.email || '—'}</td>
                    <td>
                      {u.role === 'admin' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '3px 10px', borderRadius: 20, background: '#ede9fe', color: '#7c3aed', fontWeight: 700, fontFamily: 'Lexend,sans-serif' }}>
                          <ShieldCheck size={11} /> Admin
                        </span>
                      ) : u.role === 'recouvrement' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '3px 10px', borderRadius: 20, background: '#fef3c7', color: '#b45309', fontWeight: 600, fontFamily: 'Lexend,sans-serif' }}>
                          💼 Recouvrement
                        </span>
                      ) : u.role === 'facturation' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '3px 10px', borderRadius: 20, background: '#ccfbf1', color: '#0f766e', fontWeight: 600, fontFamily: 'Lexend,sans-serif' }}>
                          🧾 Facturation
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '3px 10px', borderRadius: 20, background: 'var(--blue-light)', color: 'var(--blue-dark)', fontWeight: 600, fontFamily: 'Lexend,sans-serif' }}>
                          <UserIcon size={11} /> Conseillère
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{u.created_at || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{u.last_login || 'Jamais'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setModal({ mode: 'edit', user: u })}
                        >
                          <Pencil size={12} />
                        </button>
                        {u.username !== currentUser.username && (
                          <button
                            className="btn btn-sm"
                            style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5' }}
                            onClick={() => setDeleteTarget(u)}
                          >
                            <UserX size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                      Aucun utilisateur
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
