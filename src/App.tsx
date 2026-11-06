import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { TaskAssistant } from './TaskAssistant'
import { MeuAgora } from './MeuAgora'
import { loadRemote, saveRemote, claimLegacyData, type FocusSession, type SyncData } from './supabaseSync'
import {
  AlarmClock, BookOpen, Check, CheckCircle2, ChevronRight,
  Circle, Clock3, Coffee, Flame, Leaf, ListTodo, Pause, Play, Plus,
  RotateCcw, Sparkles, Target, TimerReset, Trash2, Waves, X
} from 'lucide-react'

type Tab = 'Meu Agora' | 'Tarefas' | 'Hábitos' | 'Foco' | 'Biblioteca'
type Task = {
  id: string; title: string; dueDate: string; dueTime: string; duration: number
  priority: 'alta' | 'media' | 'baixa'; availability: 'qualquer' | 'manha' | 'tarde' | 'noite'
  done: boolean; createdAt: number; category: string; completedAt?: string | null; deletedAt?: string | null
}
type Habit = { id: string; title: string; note: string; completed: string[]; periodicity?: 'daily' | 'weekly' | 'weekdays' | 'custom' }
type LibraryItem = { id: string; title: string; kind: 'Leitura' | 'Curso' | 'Anotação'; note: string; done: boolean }
type Persisted = { tasks: Task[]; habits: Habit[]; library: LibraryItem[]; activeTab: Tab; focusMinutes: number; focusSessions?: FocusSession[] }

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const id = () => Math.random().toString(36).slice(2, 10)
const starterTasks: Task[] = [
  { id: 't1', title: 'Separar 25 minutos para me movimentar', dueDate: todayISO(), dueTime: '05:00', duration: 25, priority: 'media', availability: 'manha', done: false, createdAt: 1, category: 'Bem-estar' },
  { id: 't2', title: 'Estudar AWS — uma sessão curta', dueDate: todayISO(), dueTime: '12:30', duration: 45, priority: 'alta', availability: 'tarde', done: false, createdAt: 2, category: 'Estudos' },
  { id: 't3', title: 'Ler por 20 minutos', dueDate: todayISO(), dueTime: '22:50', duration: 20, priority: 'baixa', availability: 'noite', done: false, createdAt: 3, category: 'Leitura' },
]
const starterHabits: Habit[] = [
  { id: 'h1', title: 'Beber água ao longo do dia', note: 'Pequenos goles, sem cobrança.', completed: [] },
  { id: 'h2', title: 'Movimentar o corpo', note: '25 minutos; pode pular sem criar pendência.', completed: [] },
  { id: 'h3', title: 'Preparar o dia seguinte', note: 'Escolher só as prioridades possíveis.', completed: [] },
]
const starterLibrary: LibraryItem[] = [
  { id: 'l1', title: 'AWS Cloud Foundations', kind: 'Curso', note: 'Retomar do último módulo concluído.', done: false },
  { id: 'l2', title: 'Leitura em andamento', kind: 'Leitura', note: 'Anotar uma ideia que vale guardar.', done: false },
]
const readSaved = (): Partial<Persisted> => {
  try {
    const legacyOwner = localStorage.getItem('meu-ritmo-local-history-owner')
    const key = legacyOwner ? 'meu-ritmo-v1:' + legacyOwner : 'meu-ritmo-v1'
    return JSON.parse(localStorage.getItem(key) || '{}') as Partial<Persisted>
  } catch { return {} }
}
const getTimeWindow = (date = new Date()): Task['availability'] => {
  const hour = date.getHours()
  if (hour < 12) return 'manha'
  if (hour < 18) return 'tarde'
  return 'noite'
}
function urgency(task: Task) {
  if (!task.dueDate) return 3
  const now = new Date()
  const due = new Date(`${task.dueDate}T${task.dueTime || '23:59'}:00`)
  if (due < now) return 0
  const today = todayISO()
  if (task.dueDate === today) return 1
  if (due.getTime() - now.getTime() <= 24 * 60 * 60 * 1000) return 2
  return 3
}
function mergeTasks(remote: Task[], local: Task[]): Task[] {
  const byId = new Map(remote.map(task => [task.id, task]))
  for (const task of local) {
    const existing = byId.get(task.id)
    if (!existing) byId.set(task.id, task)
    else if (existing.deletedAt || task.deletedAt) {
      byId.set(task.id, { ...existing, deletedAt: existing.deletedAt || task.deletedAt })
    }
  }
  return [...byId.values()]
}
function sortTasks(tasks: Task[]) {
  const window = getTimeWindow()
  return [...tasks].sort((a, b) => {
    const urgencyDiff = urgency(a) - urgency(b)
    if (urgencyDiff) return urgencyDiff
    const availabilityDiff = Number(a.availability !== 'qualquer' && a.availability !== window) - Number(b.availability !== 'qualquer' && b.availability !== window)
    if (availabilityDiff) return availabilityDiff
    const priority = { alta: 0, media: 1, baixa: 2 }
    if (priority[a.priority] !== priority[b.priority]) return priority[a.priority] - priority[b.priority]
    return a.createdAt - b.createdAt
  })
}
function formatTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export default function App() {
  const saved = useMemo(readSaved, [])
  const [tab, setTab] = useState<Tab>((String(saved.activeTab) === 'Hoje' ? 'Meu Agora' : saved.activeTab) || 'Meu Agora')
  const [tasks, setTasks] = useState<Task[]>(saved.tasks || starterTasks)
  const [habits, setHabits] = useState<Habit[]>(saved.habits || starterHabits)
  const [library, setLibrary] = useState<LibraryItem[]>(saved.library || starterLibrary)
  const [focusMinutes, setFocusMinutes] = useState(saved.focusMinutes || 25)
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>(saved.focusSessions || [])
  const [syncCode, setSyncCode] = useState(() => localStorage.getItem('meu-ritmo-sync-code') || '')
  const [syncReady, setSyncReady] = useState(false)
  const [syncStatus, setSyncStatus] = useState('Conectando à sua conta…')
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'recovery' | 'updatePassword'>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [historyPeriod, setHistoryPeriod] = useState<'week' | 'month'>('week')
  const [secondsLeft, setSecondsLeft] = useState((saved.focusMinutes || 25) * 60)
  const [running, setRunning] = useState(false)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [showLibraryForm, setShowLibraryForm] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', dueDate: todayISO(), dueTime: '18:00', duration: '25', priority: 'media' as Task['priority'], availability: 'qualquer' as Task['availability'], category: 'Pessoal' })
  const [newLibrary, setNewLibrary] = useState({ title: '', kind: 'Leitura' as LibraryItem['kind'], note: '' })
  const [note, setNote] = useState('')

  useEffect(() => {
    const data = JSON.stringify({ tasks, habits, library, activeTab: tab, focusMinutes, focusSessions })
    const legacyOwner = localStorage.getItem('meu-ritmo-local-history-owner')
    if (session?.user.id && (!legacyOwner || legacyOwner === session.user.id || syncReady)) {
      localStorage.setItem('meu-ritmo-v1:' + session.user.id, data)
    } else if (!session && !legacyOwner) localStorage.setItem('meu-ritmo-v1', data)
  }, [tasks, habits, library, tab, focusMinutes, focusSessions, session?.user.id, syncReady])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => { if (alive) { setSession(data.session); setAuthReady(true) } }).catch(() => { if (alive) setAuthReady(true) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => { if (event === 'PASSWORD_RECOVERY') { setAuthMode('updatePassword'); setAuthError(''); setAuthMessage('Defina uma nova senha para sua conta.') } setSession(nextSession); setAuthReady(true); if (!nextSession) { setSyncReady(false); setSyncStatus('Entre para acessar seus dados') } })
    return () => { alive = false; subscription.unsubscribe() }
  }, [])
  useEffect(() => {
    const token = session?.access_token
    if (!token) { setSyncReady(false); return }
    let cancelled = false
    setSyncReady(false); setSyncStatus('Carregando seu histórico…')
    ;(async () => {
      try {
        const userId = session!.user.id
        const migrationOwner = localStorage.getItem('meu-ritmo-local-history-owner')
        const isFirstLocalMigration = !migrationOwner
        const userSavedRaw = localStorage.getItem('meu-ritmo-v1:' + userId)
        let userSaved: Partial<Persisted> = {}
        try { userSaved = userSavedRaw ? JSON.parse(userSavedRaw) as Partial<Persisted> : {} } catch { userSaved = {} }
        if (syncCode) { await claimLegacyData(token, syncCode); localStorage.removeItem('meu-ritmo-sync-code'); setSyncCode('') }
        const remote = await loadRemote(token)
        if (cancelled) return
        const localData = {
          tasks: (isFirstLocalMigration ? tasks : userSaved.tasks || []) as Task[],
          habits: (isFirstLocalMigration ? habits : userSaved.habits || []) as Habit[],
          library: (isFirstLocalMigration ? library : userSaved.library || []) as LibraryItem[],
          focusSessions: (isFirstLocalMigration ? focusSessions : userSaved.focusSessions || []) as FocusSession[],
        } as SyncData
        const hasRemote = remote.tasks.length + remote.habits.length + remote.library.length + remote.focusSessions.length > 0
        const hasLocal = localData.tasks.length + localData.habits.length + localData.library.length + localData.focusSessions.length > 0
        if (!hasRemote && hasLocal) await saveRemote(token, localData)
        else if (!hasRemote && !hasLocal) {
          setTasks([]); setHabits([]); setLibrary([]); setFocusSessions([])
        } else {
          // Merge only this account's saved local history, never stale state from another session.
          const mergedTasks = mergeTasks(remote.tasks as Task[], localData.tasks)
          const mergedHabits = [...remote.habits].map(h => { const local = localData.habits.find(x => x.id === h.id); return local ? { ...h, completed: [...new Set([...h.completed, ...local.completed])] } : h })
          for (const item of localData.habits) if (!mergedHabits.some(x => x.id === item.id)) mergedHabits.push(item)
          const mergedLibrary = [...remote.library]; for (const item of localData.library) if (!mergedLibrary.some(x => x.id === item.id)) mergedLibrary.push(item)
          const mergedFocus = [...remote.focusSessions]; for (const item of localData.focusSessions) if (!mergedFocus.some(x => x.id === item.id)) mergedFocus.push(item)
          setTasks(mergedTasks as Task[]); setHabits(mergedHabits as Habit[]); setLibrary(mergedLibrary as LibraryItem[]); setFocusSessions(mergedFocus)
          await saveRemote(token, { tasks: mergedTasks, habits: mergedHabits, library: mergedLibrary, focusSessions: mergedFocus } as SyncData)
        }
        if (isFirstLocalMigration) localStorage.setItem('meu-ritmo-local-history-owner', userId)
        setTasks(current => hasRemote ? current : localData.tasks)
        setHabits(current => hasRemote ? current : localData.habits)
        setLibrary(current => hasRemote ? current : localData.library)
        setFocusSessions(current => hasRemote ? current : localData.focusSessions)
        if (!cancelled) { setSyncReady(true); setSyncStatus('Histórico sincronizado com sua conta') }
      } catch (error) { if (!cancelled) setSyncStatus(error instanceof Error ? error.message : 'Falha ao carregar seus dados') }
    })()
    return () => { cancelled = true }
  // Capture browser history once so it can be merged into the signed-in account.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token])

  useEffect(() => {
    const token = session?.access_token; if (!token || !syncReady) return
    const timer = window.setTimeout(() => { saveRemote(token, { tasks, habits, library, focusSessions } as SyncData).then(() => setSyncStatus('Histórico sincronizado com sua conta')).catch(() => setSyncStatus('Sem conexão — alterações locais preservadas')) }, 700)
    return () => window.clearTimeout(timer)
  }, [session?.access_token, syncReady, tasks, habits, library, focusSessions])

  useEffect(() => {
    const token = session?.access_token; if (!token || !syncReady) return
    const timer = window.setInterval(() => {
      loadRemote(token).then(remote => {
        setTasks(current => mergeTasks(remote.tasks as Task[], current))
        setHabits(current => { const merged = [...remote.habits].map(h => { const local = current.find(x => x.id === h.id); return local ? { ...h, completed: [...new Set([...h.completed, ...local.completed])] } : h }) as Habit[]; for (const item of current) if (!merged.some(x => x.id === item.id)) merged.push(item); return merged })
        setLibrary(current => { const merged = [...remote.library] as LibraryItem[]; for (const item of current) if (!merged.some(x => x.id === item.id)) merged.push(item); return merged })
        setFocusSessions(current => { const merged = [...remote.focusSessions]; for (const item of current) if (!merged.some(x => x.id === item.id)) merged.push(item); return merged })
        setSyncStatus('Histórico sincronizado com sua conta')
      }).catch(() => setSyncStatus('Sem conexão — tentando novamente'))
    }, 8000)
    return () => window.clearInterval(timer)
  }, [session?.access_token, syncReady])

  async function submitAuth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setAuthBusy(true); setAuthError(''); setAuthMessage('')
    try {
      const email = authEmail.trim()
      const redirectTo = window.location.origin + window.location.pathname
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password: authPassword, options: { emailRedirectTo: redirectTo } })
        if (error) throw error
        if (!data.session) setAuthMessage('Cadastro iniciado. Confira sua caixa de entrada e confirme o e-mail antes de entrar.')
      } else if (authMode === 'recovery') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
        if (error) throw error
        setAuthMessage('Se esse e-mail estiver cadastrado, você receberá um link para redefinir a senha. Confira também o spam.')
      } else if (authMode === 'updatePassword') {
        const { error } = await supabase.auth.updateUser({ password: authPassword })
        if (error) throw error
        await supabase.auth.signOut()
        setAuthMode('login'); setAuthPassword('')
        setAuthMessage('Senha atualizada. Agora entre com sua nova senha.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: authPassword })
        if (error) throw error
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível autenticar.'
      setAuthError(/email not confirmed/i.test(message) ? 'Seu e-mail ainda não foi confirmado. Use “Reenviar confirmação de e-mail” abaixo.' : message)
    } finally { setAuthBusy(false) }
  }
  async function resendConfirmation() {
    setAuthBusy(true); setAuthError(''); setAuthMessage('')
    try {
      if (!authEmail.trim()) throw new Error('Digite seu e-mail no campo acima antes de solicitar a confirmação.')
      const { error } = await supabase.auth.resend({ type: 'signup', email: authEmail.trim(), options: { emailRedirectTo: window.location.origin + window.location.pathname } })
      if (error) throw error
      setAuthMessage('Solicitação enviada. Confira sua caixa de entrada e o spam.')
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Não foi possível reenviar a confirmação.') }
    finally { setAuthBusy(false) }
  }
  async function signOut() { await supabase.auth.signOut(); setTab('Meu Agora'); setSyncReady(false); setTasks(starterTasks); setHabits(starterHabits); setLibrary(starterLibrary); setFocusSessions([]) }
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setSecondsLeft(s => {
      if (s <= 1) { window.clearInterval(timer); setRunning(false); setFocusSessions(prev => [...prev, { id: crypto.randomUUID(), started_at: new Date(Date.now() - focusMinutes * 60000).toISOString(), ended_at: new Date().toISOString(), duration_minutes: focusMinutes, completed: true }]); return 0 }
      return s - 1
    }), 1000)
    return () => window.clearInterval(timer)
  }, [running, focusMinutes])
  useEffect(() => { if (!running) setSecondsLeft(focusMinutes * 60) }, [focusMinutes, running])

  const visibleTasks = tasks.filter(t => !t.deletedAt)
  const orderedTasks = useMemo(() => sortTasks(tasks.filter(t => !t.done && !t.deletedAt)), [tasks])
  const todayKey = todayISO()
  const doneHabits = habits.filter(h => h.completed.includes(todayKey)).length
  const historyStart = new Date()
  if (historyPeriod === 'month') historyStart.setDate(1)
  else historyStart.setDate(historyStart.getDate() - 6)
  historyStart.setHours(0, 0, 0, 0)
  const historyStartKey = `${historyStart.getFullYear()}-${String(historyStart.getMonth() + 1).padStart(2, '0')}-${String(historyStart.getDate()).padStart(2, '0')}`
  const habitCompletionsInPeriod = habits.reduce((sum, h) => sum + h.completed.filter(day => day >= historyStartKey && day <= todayKey).length, 0)
  const tasksCompletedInPeriod = tasks.filter(t => t.done && t.completedAt && new Date(t.completedAt) >= historyStart).length
  const focusMinutesInPeriod = focusSessions.filter(s => new Date(s.started_at) >= historyStart).reduce((sum, s) => sum + s.duration_minutes, 0)

  function toggleTask(taskId: string) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, done: !t.done, completedAt: !t.done ? new Date().toISOString() : null } : t))
  }
  function deleteTask(task: Task) {
    if (!window.confirm(`Excluir a tarefa "${task.title}"? Essa exclusão será sincronizada nos seus dispositivos.`)) return
    setTasks(prev => prev.map(item => item.id === task.id ? { ...item, deletedAt: new Date().toISOString() } : item))
  }
  function addTask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!newTask.title.trim()) return
    setTasks(prev => [...prev, { ...newTask, id: id(), duration: Math.max(5, Number(newTask.duration) || 25), done: false, createdAt: Date.now(), dueDate: newTask.dueDate, dueTime: newTask.dueTime, category: newTask.category }])
    setNewTask({ title: '', dueDate: todayISO(), dueTime: '18:00', duration: '25', priority: 'media', availability: 'qualquer', category: 'Pessoal' })
    setShowTaskForm(false)
  }
  function toggleHabit(habitId: string) {
    setHabits(prev => prev.map(h => h.id !== habitId ? h : { ...h, completed: h.completed.includes(todayKey) ? h.completed.filter(d => d !== todayKey) : [...h.completed, todayKey] }))
  }
  function addLibraryItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!newLibrary.title.trim()) return
    setLibrary(prev => [...prev, { ...newLibrary, id: id(), done: false }])
    setNewLibrary({ title: '', kind: 'Leitura', note: '' })
    setShowLibraryForm(false)
  }
  const nav: { name: Tab; icon: typeof ListTodo }[] = [
    { name: 'Meu Agora', icon: Sparkles }, { name: 'Tarefas', icon: ListTodo },
    { name: 'Hábitos', icon: Leaf }, { name: 'Foco', icon: TimerReset }, { name: 'Biblioteca', icon: BookOpen },
  ]

  if (!authReady) return <main className="auth-shell"><section className="auth-card"><span className="brand-mark"><Waves size={20} /></span><h1>Meu Ritmo</h1><p>Verificando sua sessão segura…</p></section></main>
  if (!session || authMode === 'recovery' || authMode === 'updatePassword') return <main className="auth-shell"><section className="auth-card"><span className="brand-mark"><Waves size={20} /></span><p className="eyebrow">SEU ESPAÇO PESSOAL</p><h1>meu <b>ritmo</b></h1><p className="auth-subtitle">Entre para acessar suas tarefas, hábitos, foco e biblioteca.</p><form className="auth-form" onSubmit={submitAuth}>{authMode !== 'updatePassword' && <label>E-mail<input type="email" autoComplete="email" required value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="voce@exemplo.com" /></label>}{authMode !== 'recovery' && <label>{authMode === 'updatePassword' ? 'Nova senha' : 'Senha'}<input type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength={6} required value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="Mínimo de 6 caracteres" /></label>}{authError && <p className="auth-error" role="alert">{authError}</p>}{authMessage && <p className="auth-message" role="status">{authMessage}</p>}<button className="primary-button auth-submit" type="submit" disabled={authBusy}>{authBusy ? "Aguarde…" : authMode === 'login' ? "Entrar" : authMode === 'signup' ? "Criar conta" : authMode === 'recovery' ? "Enviar link de recuperação" : "Salvar nova senha"}</button></form>{authMode === 'login' ? <><p className="auth-switch">Ainda não tem conta? <button type="button" onClick={() => { setAuthMode('signup'); setAuthError(''); setAuthMessage('') }}>Criar conta</button></p><p className="auth-switch"><button type="button" disabled={authBusy} onClick={() => { setAuthMode('recovery'); setAuthError(''); setAuthMessage('') }}>Esqueci minha senha</button></p><p className="auth-switch"><button type="button" disabled={authBusy} onClick={resendConfirmation}>Reenviar confirmação de e-mail</button></p></> : <p className="auth-switch"><button type="button" onClick={() => { setAuthMode('login'); setAuthError(''); setAuthMessage(''); setAuthPassword('') }}>Voltar para entrar</button></p>}<p className="auth-privacy">Suas informações ficam vinculadas à sua conta.</p></section></main>
  if (session && !syncReady) return <main className="auth-shell"><section className="auth-card"><span className="brand-mark"><Waves size={20} /></span><h1>meu <b>ritmo</b></h1><p>{syncStatus}</p><button className="secondary-button" onClick={signOut}>Sair</button></section></main>

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#inicio" onClick={e => { e.preventDefault(); setTab('Meu Agora') }} aria-label="Meu Ritmo, início">
        <span className="brand-mark"><Waves size={20} /></span><span>meu <b>ritmo</b></span>
      </a>
      <div className="topbar-right"><span className="soft-status"><span className="status-dot" /> {syncStatus}</span><button className="secondary-button" onClick={signOut}>Sair</button><button className="avatar" aria-label="Perfil">{session.user.email?.slice(0,1).toUpperCase() || "U"}</button></div>
    </header>
    <main className="main-content">
      {tab === 'Meu Agora' && <MeuAgora
        tasks={visibleTasks}
        habits={habits}
        library={library}
        onToggleHabit={toggleHabit}
        onOpenTasks={() => setTab('Tarefas')}
        onOpenFocus={() => setTab('Foco')}
        onOpenLibrary={() => setTab('Biblioteca')}
      />}

      {tab === 'Tarefas' && <section className="page-view">
        <PageIntro eyebrow="UM PASSO DE CADA VEZ" title="Tarefas" text="Organize o que precisa ser feito sem transformar tudo em urgência." action={<button className="primary-button" onClick={() => setShowTaskForm(true)}><Plus size={17} /> Nova tarefa</button>} />
        <div className="filter-summary"><span><Sparkles size={16} /> Sugestão organizada por prazo, disponibilidade e prioridade</span><span>{orderedTasks.length} pendente{orderedTasks.length === 1 ? '' : 's'}</span></div>
        <div className="task-list full-task-list">{orderedTasks.map((task, i) => <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task.id)} onDelete={() => deleteTask(task)} rank={i + 1} showDate />)}</div>
        <h3 className="minor-heading">Concluídas</h3>
        <div className="task-list">{visibleTasks.filter(t => t.done).map(task => <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task.id)} onDelete={() => deleteTask(task)} />)}</div>
        {!visibleTasks.length && <EmptyState title="Comece pelo que importa" text="Crie sua primeira tarefa e organize o restante aos poucos." />}
      </section>}

      {tab === 'Hábitos' && <section className="page-view">
        <PageIntro eyebrow="CONSTÂNCIA SEM PERFECCIONISMO" title="Hábitos" text="Pequenas práticas que ajudam a cuidar de você. Marque o que conseguiu fazer hoje." />
        <div className="habit-summary"><div className="habit-sun"><Flame size={24} /></div><div><strong>{doneHabits} de {habits.length} hábitos</strong><p>O progresso não precisa ser perfeito para ser real.</p></div><span className="habit-percent">{habits.length ? Math.round(doneHabits / habits.length * 100) : 0}%</span></div>
        <div className="habit-list">{habits.map(h => { const done = h.completed.includes(todayKey); return <button className={`habit-card ${done ? 'habit-done' : ''}`} key={h.id} onClick={() => toggleHabit(h.id)}><span className="habit-check">{done ? <Check size={19} /> : <Circle size={20} />}</span><span className="habit-copy"><b>{h.title}</b><small>{h.note} · {h.periodicity === 'weekly' ? 'Semanal' : h.periodicity === 'weekdays' ? 'Dias úteis' : h.periodicity === 'custom' ? 'Personalizada' : 'Diário'}</small></span><span className="habit-streak">{h.completed.length} dia{h.completed.length === 1 ? '' : 's'}</span></button> })}</div>
        <section className="history-panel">
          <div className="section-heading"><div><p className="eyebrow">SEU PROGRESSO REAL</p><h2>Histórico</h2></div>
            <div className="history-switch"><button className={historyPeriod === 'week' ? 'primary-button' : 'secondary-button'} onClick={() => setHistoryPeriod('week')}>7 dias</button><button className={historyPeriod === 'month' ? 'primary-button' : 'secondary-button'} onClick={() => setHistoryPeriod('month')}>Este mês</button></div>
          </div>
          <p className="subheading">Contagem baseada nos registros salvos, sem estimar dias que não foram marcados.</p>
          <div className="stat-grid">
            <article className="stat-card stat-green"><span className="stat-label">Cumprimentos de hábitos</span><strong>{habitCompletionsInPeriod}</strong></article>
            <article className="stat-card stat-sand"><span className="stat-label">Tarefas concluídas com data</span><strong>{tasksCompletedInPeriod}</strong></article>
            <article className="stat-card stat-blue"><span className="stat-label">Minutos de foco registrados</span><strong>{focusMinutesInPeriod}</strong></article>
          </div>
        </section>
        <div className="gentle-note"><Leaf size={20} /><p><b>Lembrete gentil</b><br />O hábito de se movimentar pode ser pulado quando o dia estiver cheio — sem virar uma dívida para amanhã.</p></div>
      </section>}

      {tab === 'Foco' && <section className="page-view focus-view">
        <PageIntro eyebrow="PRESENÇA, NÃO PRESSA" title="Seu momento de foco" text="Uma coisa por vez. Escolha um tempo realista e dê espaço para a atenção." />
        <div className="focus-card">
          <div className="focus-tag"><span className="status-dot" /> CICLO DE CONCENTRAÇÃO</div>
          <div className="timer-ring"><div className="timer-inner"><span className="timer-label">{running ? 'EM ANDAMENTO' : secondsLeft === 0 ? 'CICLO FINALIZADO' : 'TEMPO PARA VOCÊ'}</span><strong>{formatTime(secondsLeft)}</strong><span className="timer-sub">minutos de presença</span></div></div>
          <div className="timer-presets">{[15, 25, 45].map(m => <button key={m} className={focusMinutes === m ? 'preset active' : 'preset'} onClick={() => { setRunning(false); setFocusMinutes(m); setSecondsLeft(m * 60) }}>{m} min</button>)}</div>
          <div className="timer-controls"><button className="primary-button focus-start" onClick={() => { if (secondsLeft === 0) setSecondsLeft(focusMinutes * 60); setRunning(v => !v) }}>{running ? <><Pause size={18} /> Pausar</> : <><Play size={18} fill="currentColor" /> Começar foco</>}</button><button className="icon-button" aria-label="Reiniciar timer" onClick={() => { setRunning(false); setSecondsLeft(focusMinutes * 60) }}><RotateCcw size={18} /></button></div>
          <p className="focus-quote">“Feito com calma ainda é feito.”</p>
        </div>
        <div className="focus-tips"><div><Coffee size={20} /><b>Antes</b><span>Deixe água por perto e escolha uma única tarefa.</span></div><div><AlarmClock size={20} /><b>Depois</b><span>Faça uma pausa e decida o próximo passo.</span></div><div><Target size={20} /><b>Sem culpa</b><span>Você pode ajustar o tempo ao seu dia real.</span></div></div>
      </section>}

      {tab === 'Biblioteca' && <section className="page-view">
        <PageIntro eyebrow="IDEIAS QUE ACOMPANHAM VOCÊ" title="Biblioteca" text="Reúna leituras, cursos e anotações para voltar quando tiver tempo." action={<button className="primary-button" onClick={() => setShowLibraryForm(true)}><Plus size={17} /> Adicionar</button>} />
        <div className="library-tools"><label htmlFor="library-note">Anotação rápida</label><div className="quick-note"><input id="library-note" value={note} onChange={e => setNote(e.target.value)} placeholder="Uma ideia para guardar..." onKeyDown={e => { if (e.key === 'Enter' && note.trim()) { setLibrary(prev => [...prev, { id: id(), title: note.trim(), kind: 'Anotação', note: 'Anotação rápida', done: false }]); setNote('') } }} /><button aria-label="Salvar anotação" onClick={() => { if (note.trim()) { setLibrary(prev => [...prev, { id: id(), title: note.trim(), kind: 'Anotação', note: 'Anotação rápida', done: false }]); setNote('') } }}><Plus size={18} /></button></div></div>
        <div className="library-list">{library.map(item => <article className={`library-card ${item.done ? 'library-done' : ''}`} key={item.id}><span className="library-icon">{item.kind === 'Curso' ? <Target size={20} /> : item.kind === 'Leitura' ? <BookOpen size={20} /> : <Sparkles size={20} />}</span><div className="library-copy"><span className="library-kind">{item.kind}</span><b>{item.title}</b><p>{item.note || 'Sem observações por enquanto.'}</p></div><button className="library-mark" aria-label={item.done ? 'Marcar como pendente' : 'Marcar como concluído'} onClick={() => setLibrary(prev => prev.map(i => i.id === item.id ? { ...i, done: !i.done } : i))}>{item.done ? <CheckCircle2 size={21} /> : <Circle size={21} />}</button><button className="delete-button" aria-label={`Excluir ${item.title}`} onClick={() => setLibrary(prev => prev.filter(i => i.id !== item.id))}><Trash2 size={16} /></button></article>)}</div>
        {!library.length && <EmptyState title="Sua biblioteca começa aqui" text="Adicione cursos, leituras e ideias para guardar." />}
      </section>}
    </main>
    <nav className="bottom-nav" aria-label="Navegação principal">{nav.map(({ name, icon: Icon }) => <button key={name} className={tab === name ? 'nav-item active' : 'nav-item'} onClick={() => setTab(name)}><span className="nav-icon"><Icon size={20} strokeWidth={tab === name ? 2.4 : 1.8} /></span><span>{name}</span></button>)}</nav>

    <TaskAssistant
      tasks={visibleTasks}
      onCreate={task => setTasks(prev => [...prev, { ...task, id: id(), createdAt: Date.now(), done: false }])}
      onUpdate={(taskId, changes) => setTasks(prev => prev.map(task => task.id === taskId ? { ...task, ...changes } : task))}
      onDelete={taskId => setTasks(prev => prev.map(task => task.id === taskId ? { ...task, deletedAt: new Date().toISOString() } : task))}
    />
    {showTaskForm && <div className="modal-backdrop" onClick={() => setShowTaskForm(false)}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="task-modal-title" onClick={e => e.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">NOVO PASSO</p><h2 id="task-modal-title">Adicionar tarefa</h2></div><button className="icon-button" onClick={() => setShowTaskForm(false)} aria-label="Fechar"><X size={20} /></button></div><form onSubmit={addTask} className="form-grid"><label className="wide-field">O que precisa ser feito?<input autoFocus required value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })} placeholder="Ex.: revisar uma aula de AWS" /></label><label>Prazo<input type="date" value={newTask.dueDate} onChange={e => setNewTask({ ...newTask, dueDate: e.target.value })} /></label><label>Horário<input type="time" value={newTask.dueTime} onChange={e => setNewTask({ ...newTask, dueTime: e.target.value })} /></label><label>Duração (min)<input type="number" min="5" step="5" value={newTask.duration} onChange={e => setNewTask({ ...newTask, duration: e.target.value })} /></label><label>Categoria<select value={newTask.category} onChange={e => setNewTask({ ...newTask, category: e.target.value })}><option>Pessoal</option><option>Estudos</option><option>Trabalho</option><option>Bem-estar</option><option>Família</option><option>Leitura</option></select></label><label>Prioridade<select value={newTask.priority} onChange={e => setNewTask({ ...newTask, priority: e.target.value as Task['priority'] })}><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option></select></label><label>Disponibilidade<select value={newTask.availability} onChange={e => setNewTask({ ...newTask, availability: e.target.value as Task['availability'] })}><option value="qualquer">Qualquer horário</option><option value="manha">Manhã</option><option value="tarde">Tarde</option><option value="noite">Noite</option></select></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowTaskForm(false)}>Cancelar</button><button className="primary-button" type="submit"><Plus size={17} /> Salvar tarefa</button></div></form></section></div>}
    {showLibraryForm && <div className="modal-backdrop" onClick={() => setShowLibraryForm(false)}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="library-modal-title" onClick={e => e.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">GUARDE PARA DEPOIS</p><h2 id="library-modal-title">Novo item</h2></div><button className="icon-button" onClick={() => setShowLibraryForm(false)} aria-label="Fechar"><X size={20} /></button></div><form onSubmit={addLibraryItem} className="form-grid"><label className="wide-field">Título<input autoFocus required value={newLibrary.title} onChange={e => setNewLibrary({ ...newLibrary, title: e.target.value })} placeholder="Nome do curso, livro ou ideia" /></label><label className="wide-field">Tipo<select value={newLibrary.kind} onChange={e => setNewLibrary({ ...newLibrary, kind: e.target.value as LibraryItem['kind'] })}><option>Leitura</option><option>Curso</option><option>Anotação</option></select></label><label className="wide-field">Observações<textarea rows={3} value={newLibrary.note} onChange={e => setNewLibrary({ ...newLibrary, note: e.target.value })} placeholder="Onde parou? O que quer lembrar?" /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowLibraryForm(false)}>Cancelar</button><button className="primary-button" type="submit"><Plus size={17} /> Salvar item</button></div></form></section></div>}
    <footer className="footer-note"><span>Feito para a vida real</span><span>·</span><span>{syncCode ? 'Dados sincronizados com Supabase.' : 'Dados salvos neste dispositivo. Ative a sincronização para compartilhar.'}</span></footer>
  </div>
}

function TaskRow({ task, onToggle, onDelete, rank, showDate = false }: { task: Task; onToggle: () => void; onDelete?: () => void; rank?: number; showDate?: boolean }) {
  const late = !task.done && urgency(task) === 0
  const dueLabel = task.dueDate === todayISO() ? 'Hoje' : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(`${task.dueDate}T12:00:00`))
  return <article className={`task-row ${task.done ? 'task-complete' : ''}`}><button className="task-check" onClick={onToggle} aria-label={task.done ? 'Reabrir tarefa' : 'Concluir tarefa'}>{task.done ? <CheckCircle2 size={21} /> : <Circle size={21} />}</button><div className="task-main"><div className="task-title-line">{rank && !task.done && <span className="rank-chip">{rank}</span>}<b>{task.title}</b></div><div className="task-meta"><span>{task.category}</span><span className="meta-dot">·</span><span><Clock3 size={12} /> {task.duration} min</span>{showDate && <><span className="meta-dot">·</span><span className={late ? 'late-label' : ''}>{late ? 'Atrasada' : dueLabel} {task.dueTime ? `· ${task.dueTime}` : ''}</span></>}</div></div><span className={`priority-pill priority-${task.priority}`}>{task.priority === 'alta' ? 'Alta' : task.priority === 'media' ? 'Média' : 'Baixa'}</span>{onDelete && <button className="delete-button task-delete-button" onClick={onDelete} aria-label={`Excluir tarefa ${task.title}`} title="Excluir tarefa"><Trash2 size={16} /></button>}</article>
}
function PageIntro({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) {
  return <div className="page-intro"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="subheading">{text}</p></div>{action}</div>
}
function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><span><Sparkles size={22} /></span><b>{title}</b><p>{text}</p></div>
}
