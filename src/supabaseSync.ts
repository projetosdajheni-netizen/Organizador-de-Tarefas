const SYNC_URL = 'https://lrpjprbfwqzaywmrmlvd.supabase.co/functions/v1/meu-ritmo-sync'

export type SyncTask = {
  id: string; title: string; dueDate: string; dueTime: string; duration: number
  priority: 'alta' | 'media' | 'baixa'; availability: 'qualquer' | 'manha' | 'tarde' | 'noite'
  done: boolean; createdAt: number; category: string; completedAt?: string | null; deletedAt?: string | null
}
export type SyncHabit = { id: string; title: string; note: string; periodicity?: 'daily' | 'weekly' | 'weekdays' | 'custom'; completed: string[] }
export type SyncLibraryItem = { id: string; title: string; kind: 'Leitura' | 'Curso' | 'Anotação'; note: string; done: boolean }
export type FocusSession = { id: string; started_at: string; ended_at: string; duration_minutes: number; completed: boolean }
export type SyncData = { tasks: SyncTask[]; habits: SyncHabit[]; library: SyncLibraryItem[]; focusSessions: FocusSession[] }

async function request<T>(syncCode: string, action: 'load' | 'save', data?: SyncData): Promise<T> {
  const response = await fetch(SYNC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: 'sb_publishable_14zi-65trGd1cr6JZEZxVg_aJ8itflN' },
    body: JSON.stringify({ syncCode, action, ...(data ? { data } : {}) }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Falha na sincronização.')
  return result as T
}

export function loadRemote(syncCode: string) {
  return request<SyncData & { updatedAt: string }>(syncCode, 'load')
}
export function saveRemote(syncCode: string, data: SyncData) {
  return request<{ ok: boolean; saved: Record<string, number> }>(syncCode, 'save', data)
}
