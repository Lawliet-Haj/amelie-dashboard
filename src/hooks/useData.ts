import { useState, useEffect, useCallback, useRef } from 'react';
import type { DashboardData } from '../types';

const API_URL = 'https://n8n.srv778935.hstgr.cloud/webhook/dashboard-data';

const MOCK: DashboardData = {
  kpis: { total_week: 42, anomalies_week: 3, avg_duration: 48, rappels_pending: 5, total_today: 7 },
  calls_by_day: [
    { date: '09/05', total: 5, anomalies: 0 },
    { date: '10/05', total: 8, anomalies: 1 },
    { date: '11/05', total: 3, anomalies: 0 },
    { date: '12/05', total: 9, anomalies: 2 },
    { date: '13/05', total: 6, anomalies: 0 },
    { date: '14/05', total: 4, anomalies: 0 },
    { date: '15/05', total: 7, anomalies: 0 },
  ],
  motifs: [
    { name: 'location',       count: 22 },
    { name: 'retour',         count: 10 },
    { name: 'ordonnance',     count: 6  },
    { name: 'transfert_voulu',count: 3  },
    { name: 'autre',          count: 1  },
  ],
  sentiment: [
    { name: 'positif', count: 27 },
    { name: 'neutre',  count: 11 },
    { name: 'negatif', count: 4  },
  ],
  actions: [
    { name: 'SMS envoyé',          count: 28 },
    { name: 'Transféré',           count: 8  },
    { name: 'SMS + Transféré',     count: 4  },
    { name: 'Callback enregistré', count: 2  },
  ],
  rappels: [
    { date: '15/05', date_full: '2026-05-15', heure: '11:42', phone: '+33 6 12 34 56 78', conv_id: 'conv-001', motif: 'transfert_echoue',  priorite: 'URGENT', statut: 'PENDING' },
    { date: '15/05', date_full: '2026-05-15', heure: '10:15', phone: '+33 7 98 76 54 32', conv_id: 'conv-002', motif: 'hors_ouverture',    priorite: 'NORMAL', statut: 'PENDING' },
    { date: '14/05', date_full: '2026-05-14', heure: '17:58', phone: '+33 6 55 44 33 22', conv_id: 'conv-003', motif: 'frustration_ia',   priorite: 'URGENT', statut: 'PENDING' },
    { date: '14/05', date_full: '2026-05-14', heure: '09:30', phone: '+33 6 11 22 33 44', conv_id: 'conv-004', motif: 'hors_ouverture',   priorite: 'NORMAL', statut: 'DONE'    },
    { date: '13/05', date_full: '2026-05-13', heure: '14:20', phone: '+33 7 66 77 88 99', conv_id: 'conv-005', motif: 'raccroche_abrupt', priorite: 'NORMAL', statut: 'PENDING' },
  ],
  recent_calls: [
    {
      date: '15/05', date_full: '2026-05-15', heure: '12:09', phone: '+33 6 12 34 56 78', duration: 55,  motif_ia: 'location',      action: 'SMS + Transféré',     sentiment: 'positif', anomalie: 'NON',
      conv_id: 'conv-006',
      transcript: 'Agent: Bonjour, je suis Amélie, l\'assistante virtuelle de Tire-Lait Express. Comment puis-je vous aider ?\nUtilisateur: Bonjour, je voudrais louer un tire-lait.\nAgent: Bien sûr ! Je vais vous envoyer un SMS avec le lien pour démarrer votre dossier, et je vais également vous mettre en relation avec une conseillère. Un instant s\'il vous plaît.\nUtilisateur: Merci beaucoup !\nAgent: C\'est fait ! Vous allez recevoir un SMS dans quelques instants. Une conseillère vous contactera très bientôt.',
    },
    {
      date: '15/05', date_full: '2026-05-15', heure: '11:42', phone: '+33 7 98 76 54 32', duration: 28,  motif_ia: 'retour',        action: 'SMS envoyé',          sentiment: 'neutre',  anomalie: 'NON',
      conv_id: 'conv-001',
      transcript: 'Agent: Bonjour, je suis Amélie de Tire-Lait Express. Que puis-je faire pour vous ?\nUtilisateur: Je souhaite rendre mon tire-lait.\nAgent: Je comprends. Je vous envoie immédiatement le lien pour générer votre étiquette de retour par SMS.\nUtilisateur: D\'accord merci.',
    },
    {
      date: '15/05', date_full: '2026-05-15', heure: '11:10', phone: '+33 6 55 44 33 22', duration: 12,  motif_ia: 'hors_ouverture', action: 'Callback enregistré', sentiment: 'neutre', anomalie: 'NON',
      conv_id: 'conv-007',
      transcript: 'Agent: Bonjour, je suis Amélie de Tire-Lait Express. Notre service est actuellement fermé. Une conseillère vous rappellera dès l\'ouverture.\nUtilisateur: D\'accord, merci.',
    },
    {
      date: '15/05', date_full: '2026-05-15', heure: '10:45', phone: '+33 6 11 22 33 44', duration: 180, motif_ia: 'autre',         action: 'Transféré',           sentiment: 'negatif', anomalie: 'OUI',
      conv_id: 'conv-008',
      transcript: 'Agent: Bonjour, je suis Amélie de Tire-Lait Express. Comment puis-je vous aider ?\nUtilisateur: Ça fait 20 minutes que j\'essaie de vous joindre ! C\'est scandaleux !\nAgent: Je suis vraiment désolée pour cette attente. Laissez-moi vous mettre en relation avec une conseillère immédiatement.\nUtilisateur: Enfin ! J\'espère que quelqu\'un va régler mon problème.\nAgent: Bien sûr, je vous transfère maintenant.',
    },
    {
      date: '15/05', date_full: '2026-05-15', heure: '10:15', phone: '+33 7 66 77 88 99', duration: 34,  motif_ia: 'ordonnance',    action: 'SMS envoyé',          sentiment: 'positif', anomalie: 'NON',
      conv_id: 'conv-009',
      transcript: 'Agent: Bonjour, je suis Amélie de Tire-Lait Express. Comment puis-je vous aider ?\nUtilisateur: J\'ai besoin d\'informations sur l\'ordonnance pour le tire-lait.\nAgent: Bien sûr ! Je vous envoie le lien avec toutes les informations nécessaires par SMS.\nUtilisateur: Super, merci !',
    },
    {
      date: '14/05', date_full: '2026-05-14', heure: '17:58', phone: '+33 9 72 30 37 86', duration: 95,  motif_ia: 'location',      action: 'SMS envoyé',          sentiment: 'negatif', anomalie: 'OUI',
      conv_id: 'conv-003',
      transcript: 'Agent: Bonjour, je suis Amélie de Tire-Lait Express.\nUtilisateur: Je veux un tire-lait, ça fait longtemps que j\'attends.\nAgent: Je comprends votre impatience. Je vous envoie le lien par SMS pour démarrer votre dossier.\nUtilisateur: Je l\'ai déjà reçu ce lien ! Personne ne m\'aide !\nAgent: Je suis vraiment désolée. Je vais escalader votre demande.',
    },
  ],
};

export function useData() {
  const [data, setData]               = useState<DashboardData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [hasNewUrgent, setHasNewUrgent] = useState(false);
  const prevUrgentRef = useRef<number>(0);
  const isFirstFetch  = useRef(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API_URL, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DashboardData = await res.json();
      const urgentNow = json.rappels.filter(r => r.priorite === 'URGENT' && r.statut !== 'DONE').length;
      if (!isFirstFetch.current && urgentNow > prevUrgentRef.current) {
        setHasNewUrgent(true);
      }
      prevUrgentRef.current = urgentNow;
      isFirstFetch.current = false;
      setData(json);
    } catch {
      isFirstFetch.current = false;
      setData(MOCK);
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  // Initial fetch
  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 30 s
  useEffect(() => {
    const id = setInterval(fetchData, 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const dismissNewUrgent = useCallback(() => setHasNewUrgent(false), []);

  return { data, loading, error, refresh: fetchData, lastRefresh, hasNewUrgent, dismissNewUrgent };
}
