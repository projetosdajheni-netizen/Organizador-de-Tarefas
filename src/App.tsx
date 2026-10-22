import { useEffect, useMemo, useState } from 'react'
import { loadRemote, saveRemote, type FocusSession, type SyncData } from './supabaseSync'
import {
  AlarmClock, BookOpen, CalendarDays, Check, CheckCircle2, ChevronRight,
  Circle, Clock3, Coffee, Flame, Leaf, ListTodo, Pause, Play, Plus,
  RotateCcw, Sparkles, Target, TimerReset, Trash2, Waves, X
} from 'lucide-react'

type Tab = 'Hoje' | 'Tarefas' | 'Hábitos' | 'Foco' | 'Biblioteca'
type Task = {
  id: string; title: string; dueDate: string; dueTime: string; duration: number
  priority: 'alta' | 'media' | 'baixa'; availability: 'qualquer' | 'manha' | 'tarde' | 'noite'
  done: boolean; createdAt: number; category: string; completedAt?: string | null
}
type Habit = { id: string; title: string; note: string; completed: string[]; periodicity?: 'daily' | 'weekly' | 'weekdays' | 'custom' }
type LibraryItem = { id: string; title: string; kind: 'Leitura' | 'Curso' | 'Anotação'; note: string; done: boolean }
type Persisted = { tasks: Task[]; habits: Habit[]; library: LibraryItem[]; activeTab: Tab; focusMinutes: number; focusSessions?: FocusSession[] }

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dateLabel = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
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
  try { return JSON.parse(localStorage.getItem('meu-ritmo-v1') || '{}') as Partial<Persisted> } catch { return {} }
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
  const [tab, setTab] = useState<Tab>(saved.activeTab || 'Hoje')
  const [tasks, setTasks] = useState<Task[]>(saved.tasks || starterTasks)
  const [habits, setHabits] = useState<Habit[]>(saved.habits || starterHabits)
  const [library, setLibrary] = useState<LibraryItem[]>(saved.library || starterLibrary)
  const [focusMinutes, setFocusMinutes] = useState(saved.focusMinutes || 25)
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>(saved.focusSessions || [])
  const [syncCode, setSyncCode] = useState(() => localStorage.getItem('meu-ritmo-sync-code') || '')
  const [syncReady, setSyncReady] = useState(false)
  const [syncStatus, setSyncStatus] = useState('Somente neste dispositivo')
  const [historyPeriod, setHistoryPeriod] = useState<'week' | 'month'>('week')
  const [secondsLeft, setSecondsLeft] = useState((saved.focusMinutes || 25) * 60)
  const [running, setRunning] = useState(false)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [showLibraryForm, setShowLibraryForm] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', dueDate: todayISO(), dueTime: '18:00', duration: '25', priority: 'media' as Task['priority'], availability: 'qualquer' as Task['availability'], category: 'Pessoal' })
  const [newLibrary, setNewLibrary] = useState({ title: '', kind: 'Leitura' as LibraryItem['kind'], note: '' })
  const [note, setNote] = useState('')

  useEffect(() => {
    localStorage.setItem('meu-ritmo-v1', JSON.stringify({ tasks, habits, library, activeTab: tab, focusMinutes, focusSessions }))
  }, [tasks, habits, library, tab, focusMinutes, focusSessions])
  useEffect(() => {
    if (!syncCode) { setSyncReady(false); setSyncStatus('Somente neste dispositivo'); return }
    let cancelled = false
    setSyncReady(false)
    setSyncStatus('Conectando à nuvem…')
    loadRemote(syncCode).then(async remote => {
      if (cancelled) return
      const localData = { tasks, habits, library, focusSessions } as SyncData
      const remoteHasData = remote.tasks.length + remote.habits.length + remote.library.length + remote.focusSessions.length > 0
      if (!remoteHasData) {
        await saveRemote(syncCode, localData)
      } else {
        const mergedTasks = [...remote.tasks]
        for (const item of tasks) if (!mergedTasks.some(x => x.id === item.id)) mergedTasks.push(item)
        const mergedHabits = [...remote.habits].map(h => {
          const local = habits.find(x => x.id === h.id)
          return local ? { ...h, completed: [...new Set([...h.completed, ...local.completed])] } : h
        })
        for (const item of habits) if (!mergedHabits.some(x => x.id === item.id)) mergedHabits.push(item)
        const mergedLibrary = [...remote.library]
        for (const item of library) if (!mergedLibrary.some(x => x.id === item.id)) mergedLibrary.push(item)
        const mergedFocus = [...remote.focusSessions]
        for (const item of focusSessions) if (!mergedFocus.some(x => x.id === item.id)) mergedFocus.push(item)
        setTasks(mergedTasks as Task[])
        setHabits(mergedHabits as Habit[])
        setLibrary(mergedLibrary as LibraryItem[])
        setFocusSessions(mergedFocus)
        await saveRemote(syncCode, { tasks: mergedTasks, habits: mergedHabits, library: mergedLibrary, focusSessions: mergedFocus } as SyncData)
      }
      if (!cancelled) { setSyncReady(true); setSyncStatus('Sincronizado com a nuvem') }
    }).catch(() => {
      if (!cancelled) setSyncStatus('Falha ao conectar — dados locais preservados')
    })
    return () => { cancelled = true }
  // Initial local state is intentionally captured for safe first-time migration.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncCode])

  useEffect(() => {
    if (!syncCode || !syncReady) return
    const timer = window.setTimeout(() => {
      saveRemote(syncCode, { tasks, habits, library, focusSessions } as SyncData)
        .then(() => setSyncStatus('Sincronizado com a nuvem'))
        .catch(() => setSyncStatus('Sem conexão — alterações locais preservadas'))
    }, 700)
    return () => window.clearTimeout(timer)
  }, [syncCode, syncReady, tasks, habits, library, focusSessions])

  useEffect(() => {
    if (!syncCode || !syncReady) return
    const timer = window.setInterval(() => {
      loadRemote(syncCode).then(remote => {
        setTasks(current => {
          const merged = [...remote.tasks] as Task[]
          for (const item of current) if (!merged.some(x => x.id === item.id)) merged.push(item)
          return merged
        })
        setHabits(current => {
          const merged = [...remote.habits].map(h => {
            const local = current.find(x => x.id === h.id)
            return local ? { ...h, completed: [...new Set([...h.completed, ...local.completed])] } : h
          }) as Habit[]
          for (const item of current) if (!merged.some(x => x.id === item.id)) merged.push(item)
          return merged
        })
        setLibrary(current => {
          const merged = [...remote.library] as LibraryItem[]
          for (const item of current) if (!merged.some(x => x.id === item.id)) merged.push(item)
          return merged
        })
        setFocusSessions(current => {
          const merged = [...remote.focusSessions]
          for (const item of current) if (!merged.some(x => x.id === item.id)) merged.push(item)
          return merged
        })
        setSyncStatus('Sincronizado com a nuvem')
      }).catch(() => setSyncStatus('Sem conexão — tentando novamente'))
    }, 8000)
    return () => window.clearInterval(timer)
  }, [syncCode, syncReady])

  function connectDevices() {
    const code = window.prompt('Crie um código de sincronização com pelo menos 12 caracteres. Use exatamente o mesmo código no celular e no computador. Quem tiver esse código poderá acessar os dados sincronizados.')
    if (!code) return
    if (code.trim().length < 12) { window.alert('O código precisa ter pelo menos 12 caracteres.'); return }
    localStorage.setItem('meu-ritmo-sync-code', code.trim())
    setSyncCode(code.trim())
  }

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setSecondsLeft(s => {
      if (s <= 1) { window.clearInterval(timer); setRunning(false); setFocusSessions(prev => [...prev, { id: `focus-${Date.now()}`, started_at: new Date(Date.now() - focusMinutes * 60000).toISOString(), ended_at: new Date().toISOString(), duration_minutes: focusMinutes, completed: true }]); return 0 }
      return s - 1
    }), 1000)
    return () => window.clearInterval(timer)
  }, [running, focusMinutes])
  useEffect(() => { if (!running) setSecondsLeft(focusMinutes * 60) }, [focusMinutes, running])

  const orderedTasks = useMemo(() => sortTasks(tasks.filter(t => !t.done)), [tasks])
  const todayTasks = orderedTasks.filter(t => t.dueDate === todayISO() || urgency(t) < 3)
  const completedToday = tasks.filter(t => t.done).length
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
  const greeting = new Date().getHours() < 12 ? 'Bom dia' : new Date().getHours() < 18 ? 'Boa tarde' : 'Boa noite'

  function toggleTask(taskId: string) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, done: !t.done, completedAt: !t.done ? new Date().toISOString() : null } : t))
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
    { name: 'Hoje', icon: CalendarDays }, { name: 'Tarefas', icon: ListTodo },
    { name: 'Hábitos', icon: Leaf }, { name: 'Foco', icon: TimerReset }, { name: 'Biblioteca', icon: BookOpen },
  ]

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#inicio" onClick={e => { e.preventDefault(); setTab('Hoje') }} aria-label="Meu Ritmo, início">
        <span className="brand-mark"><Waves size={20} /></span><span>meu <b>ritmo</b></span>
      </a>
      <div className="topbar-right"><span className="soft-status"><span className="status-dot" /> {syncStatus}</span><button className="secondary-button" onClick={connectDevices}>{syncCode ? 'Configurar sincronização' : 'Sincronizar dispositivos'}</button><button className="avatar" aria-label="Perfil">J</button></div>
    </header>
    <main className="main-content">
      {tab === 'Hoje' && <section className="today-view">
        <div className="welcome-row">
          <div><p className="eyebrow">{dateLabel}</p><h1>{greeting}, Jhenifer <span className="wave">✳</span></h1><p className="subheading">Um passo de cada vez. O suficiente também conta.</p></div>
          <div className="daily-stamp"><Sparkles size={19} /><span>Seu dia<br /><b>com leveza</b></span></div>
        </div>
        <section className="hero-card">
          <div className="hero-copy"><span className="hero-kicker"><Leaf size={14} /> UM DIA POSSÍVEL</span><h2>Você não precisa<br />dar conta de tudo.</h2><p>Escolha o que cabe no dia de hoje. O resto pode esperar.</p><button className="hero-button" onClick={() => setTab('Tarefas')}>Organizar meu dia <ChevronRight size={16} /></button></div>
          <div className="hero-art" aria-hidden="true"><div className="sun" /><div className="hill hill-back" /><div className="hill hill-front" /><div className="art-leaf"><Leaf size={38} /></div></div>
        </section>
        <div className="section-heading"><div><p className="eyebrow">SEM PRESSA, MAS COM INTENÇÃO</p><h2>Seu panorama de hoje</h2></div><button className="text-button" onClick={() => setTab('Tarefas')}>Ver tarefas <ChevronRight size={15} /></button></div>
        <div className="stat-grid">
          <article className="stat-card stat-green"><span className="stat-icon"><CheckCircle2 size={19} /></span><span className="stat-label">Tarefas concluídas</span><strong>{completedToday}<small> no total</small></strong><div className="progress-track"><span style={{ width: tasks.length ? `${Math.min(100, completedToday / tasks.length * 100)}%` : '0%' }} /></div></article>
          <article className="stat-card stat-sand"><span className="stat-icon"><Leaf size={19} /></span><span className="stat-label">Hábitos de hoje</span><strong>{doneHabits}<small> de {habits.length}</small></strong><div className="progress-track"><span style={{ width: habits.length ? `${doneHabits / habits.length * 100}%` : '0%' }} /></div></article>
          <article className="stat-card stat-blue"><span className="stat-icon"><Clock3 size={19} /></span><span className="stat-label">Próximo passo</span><strong className="next-step">{todayTasks[0] ? todayTasks[0].title : 'Pausa merecida'}</strong><span className="tiny-note">{todayTasks[0] ? `${todayTasks[0].duration} min · ${todayTasks[0].category}` : 'Você pode respirar.'}</span></article>
        </div>
        <div className="section-heading task-section-heading"><div><p className="eyebrow">PEQUENAS AÇÕES, GRANDES CAMINHOS</p><h2>O que vem primeiro</h2></div><button className="round-add" onClick={() => setShowTaskForm(true)} aria-label="Adicionar tarefa"><Plus size={19} /></button></div>
        <div className="task-list">
          {todayTasks.length ? todayTasks.slice(0, 4).map((task, i) => <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task.id)} rank={i + 1} />) : <EmptyState title="Seu dia está aberto" text="Adicione uma tarefa quando quiser dar forma ao seu tempo." />}
        </div>
        <button className="gentle-prompt" onClick={() => setTab('Foco')}><span className="prompt-icon"><Coffee size={20} /></span><span><b>Um intervalo também é produtividade</b><small>Faça uma pausa curta ou comece um ciclo de foco.</small></span><ChevronRight size={18} /></button>
      </section>}

      {tab === 'Tarefas' && <section className="page-view">
        <PageIntro eyebrow="UM PASSO DE CADA VEZ" title="Tarefas" text="Organize o que precisa ser feito sem transformar tudo em urgência." action={<button className="primary-button" onClick={() => setShowTaskForm(true)}><Plus size={17} /> Nova tarefa</button>} />
        <div className="filter-summary"><span><Sparkles size={16} /> Sugestão organizada por prazo, disponibilidade e prioridade</span><span>{orderedTasks.length} pendente{orderedTasks.length === 1 ? '' : 's'}</span></div>
        <div className="task-list full-task-list">{orderedTasks.map((task, i) => <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task.id)} rank={i + 1} showDate />)}</div>
        <h3 className="minor-heading">Concluídas</h3>
        <div className="task-list">{tasks.filter(t => t.done).map(task => <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task.id)} />)}</div>
        {!tasks.length && <EmptyState title="Comece pelo que importa" text="Crie sua primeira tarefa e organize o restante aos poucos." />}
      </section>}

      {tab === 'Hábitos' && <section className="page-view">
        <PageIntro eyebrow="CONSTÂNCIA SEM PERFECCIONISMO" title="Hábitos" text="Pequenas práticas que ajudam a cuidar de você. Marque o que conseguiu fazer hoje." />
        <div className="habit-summary"><div className="habit-sun"><Flame size={24} /></div><div><strong>{doneHabits} de {habits.length} hábitos</strong><p>O progresso não precisa ser perfeito para ser real.</p></div><span className="habit-percent">{habits.length ? Math.round(doneHabits / habits.length * 100) : 0}%</span></div>
        <div className="habit-list">{habits.map(h => { const done = h.completed.includes(todayKey); return <button className={`habit-card ${done ? 'habit-done' : ''}`} key={h.id} onClick={() => toggleHabit(h.id)}><span className="habit-check">{done ? <Check size={19} /> : <Circle size={20} />}</span><span className="habit-copy"><b>{h.title}</b><small>{h.note}</small></span><span className="habit-streak">{h.completed.length} dia{h.completed.length === 1 ? '' : 's'}</span></button> })}</div>
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

    {showTaskForm && <div className="modal-backdrop" onClick={() => setShowTaskForm(false)}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="task-modal-title" onClick={e => e.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">NOVO PASSO</p><h2 id="task-modal-title">Adicionar tarefa</h2></div><button className="icon-button" onClick={() => setShowTaskForm(false)} aria-label="Fechar"><X size={20} /></button></div><form onSubmit={addTask} className="form-grid"><label className="wide-field">O que precisa ser feito?<input autoFocus required value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })} placeholder="Ex.: revisar uma aula de AWS" /></label><label>Prazo<input type="date" value={newTask.dueDate} onChange={e => setNewTask({ ...newTask, dueDate: e.target.value })} /></label><label>Horário<input type="time" value={newTask.dueTime} onChange={e => setNewTask({ ...newTask, dueTime: e.target.value })} /></label><label>Duração (min)<input type="number" min="5" step="5" value={newTask.duration} onChange={e => setNewTask({ ...newTask, duration: e.target.value })} /></label><label>Categoria<select value={newTask.category} onChange={e => setNewTask({ ...newTask, category: e.target.value })}><option>Pessoal</option><option>Estudos</option><option>Trabalho</option><option>Bem-estar</option><option>Família</option><option>Leitura</option></select></label><label>Prioridade<select value={newTask.priority} onChange={e => setNewTask({ ...newTask, priority: e.target.value as Task['priority'] })}><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option></select></label><label>Disponibilidade<select value={newTask.availability} onChange={e => setNewTask({ ...newTask, availability: e.target.value as Task['availability'] })}><option value="qualquer">Qualquer horário</option><option value="manha">Manhã</option><option value="tarde">Tarde</option><option value="noite">Noite</option></select></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowTaskForm(false)}>Cancelar</button><button className="primary-button" type="submit"><Plus size={17} /> Salvar tarefa</button></div></form></section></div>}
    {showLibraryForm && <div className="modal-backdrop" onClick={() => setShowLibraryForm(false)}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="library-modal-title" onClick={e => e.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">GUARDE PARA DEPOIS</p><h2 id="library-modal-title">Novo item</h2></div><button className="icon-button" onClick={() => setShowLibraryForm(false)} aria-label="Fechar"><X size={20} /></button></div><form onSubmit={addLibraryItem} className="form-grid"><label className="wide-field">Título<input autoFocus required value={newLibrary.title} onChange={e => setNewLibrary({ ...newLibrary, title: e.target.value })} placeholder="Nome do curso, livro ou ideia" /></label><label className="wide-field">Tipo<select value={newLibrary.kind} onChange={e => setNewLibrary({ ...newLibrary, kind: e.target.value as LibraryItem['kind'] })}><option>Leitura</option><option>Curso</option><option>Anotação</option></select></label><label className="wide-field">Observações<textarea rows={3} value={newLibrary.note} onChange={e => setNewLibrary({ ...newLibrary, note: e.target.value })} placeholder="Onde parou? O que quer lembrar?" /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowLibraryForm(false)}>Cancelar</button><button className="primary-button" type="submit"><Plus size={17} /> Salvar item</button></div></form></section></div>}
    <footer className="footer-note"><span>Feito para a vida real</span><span>·</span><span>{syncCode ? 'Dados sincronizados com Supabase.' : 'Dados salvos neste dispositivo. Ative a sincronização para compartilhar.'}</span></footer>
  </div>
}

function TaskRow({ task, onToggle, rank, showDate = false }: { task: Task; onToggle: () => void; rank?: number; showDate?: boolean }) {
  const late = !task.done && urgency(task) === 0
  const dueLabel = task.dueDate === todayISO() ? 'Hoje' : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(`${task.dueDate}T12:00:00`))
  return <article className={`task-row ${task.done ? 'task-complete' : ''}`}><button className="task-check" onClick={onToggle} aria-label={task.done ? 'Reabrir tarefa' : 'Concluir tarefa'}>{task.done ? <CheckCircle2 size={21} /> : <Circle size={21} />}</button><div className="task-main"><div className="task-title-line">{rank && !task.done && <span className="rank-chip">{rank}</span>}<b>{task.title}</b></div><div className="task-meta"><span>{task.category}</span><span className="meta-dot">·</span><span><Clock3 size={12} /> {task.duration} min</span>{showDate && <><span className="meta-dot">·</span><span className={late ? 'late-label' : ''}>{late ? 'Atrasada' : dueLabel} {task.dueTime ? `· ${task.dueTime}` : ''}</span></>}</div></div><span className={`priority-pill priority-${task.priority}`}>{task.priority === 'alta' ? 'Alta' : task.priority === 'media' ? 'Média' : 'Baixa'}</span></article>
}
function PageIntro({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) {
  return <div className="page-intro"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="subheading">{text}</p></div>{action}</div>
}
function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><span><Sparkles size={22} /></span><b>{title}</b><p>{text}</p></div>
}
