import { useMemo, useState } from 'react'
import { Bot, ListTodo, Send, Sparkles, X } from 'lucide-react'
import './assistant.css'

type AssistantTask = {
  id: string
  title: string
  dueDate: string
  dueTime: string
  duration: number
  priority: 'alta' | 'media' | 'baixa'
  availability: 'qualquer' | 'manha' | 'tarde' | 'noite'
  done: boolean
  createdAt: number
  category: string
  completedAt?: string | null
  deletedAt?: string | null
}

type NewAssistantTask = Omit<AssistantTask, 'id' | 'createdAt' | 'done' | 'completedAt' | 'deletedAt'>
type PendingAction =
  | { kind: 'create'; task: NewAssistantTask }
  | { kind: 'update'; taskId: string; title: string; changes: Partial<AssistantTask>; summary: string }
  | { kind: 'delete'; taskId: string; title: string }

type Message = { role: 'assistant' | 'user'; text: string }

const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const datePt = (value: string) => value ? new Intl.DateTimeFormat('pt-BR').format(new Date(value + 'T12:00:00')) : 'Sem prazo'
const timePt = (value: string) => value || 'Sem horário'

const localDay = (offset = 0) => {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return localDate(date)
}
const isPending = (task: AssistantTask) => !task.done && !task.deletedAt
const taskPriority = (task: AssistantTask) => ({ alta: 0, media: 1, baixa: 2 })[task.priority]
const taskOrder = (a: AssistantTask, b: AssistantTask) =>
  a.dueDate.localeCompare(b.dueDate) || taskPriority(a) - taskPriority(b) || a.dueTime.localeCompare(b.dueTime)
const formatTask = (task: AssistantTask) =>
  '• ' + task.title + ' — ' + datePt(task.dueDate) + ' às ' + timePt(task.dueTime) + ' · ' + task.duration + ' min · prioridade ' + task.priority

function findTask(query: string, tasks: AssistantTask[]) {
  const needle = normalize(query.replace(/^["']|["']$/g, '').trim())
  const active = tasks.filter(task => !task.deletedAt)
  const matches = active.filter(task => normalize(task.title) === needle)
  if (matches.length) return { task: matches[0], ambiguous: false }
  const partial = active.filter(task => normalize(task.title).includes(needle) || needle.includes(normalize(task.title)))
  return { task: partial.length === 1 ? partial[0] : undefined, ambiguous: partial.length > 1 }
}

function parseCreate(text: string): NewAssistantTask | null {
  if (!/(adicionar|adiciona|criar|crie|cadastrar|cadastre|incluir|inclua)/i.test(text) || !/tarefa/i.test(text)) return null
  let title = text
    .replace(/^.*?\b(tarefa)\b\s*/i, '')
    .replace(/^[:\-]\s*/, '')
    .replace(/\b(para|de)\s+(?=(estudar|ler|fazer|revisar|organizar|preparar|ligar|enviar|buscar|comprar|resolver)\b)/i, '')
  const now = new Date()
  let dueDate = localDate(now)
  if (/\bamanha\b/i.test(normalize(title))) {
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    dueDate = localDate(tomorrow)
  }
  title = title.replace(/\bamanh[aã]\b/gi, '').replace(/\bhoje\b/gi, '')
  // Accepts explicit clock formats: "às 14h", "14h30", "14:30" and "9h".
  // Do not use a trailing word boundary after the accented "às".
  const timeMatch = title.match(/(?:^|\s)(?:(?:às|as)\s*)?(\d{1,2})(?:\s*h\s*(\d{2})?|:(\d{2}))(?!\d)/i)
  let dueTime = '18:00'
  if (timeMatch) {
    const hour = Number(timeMatch[1])
    const minute = Number(timeMatch[2] || timeMatch[3] || 0)
    if (hour > 23 || minute > 59) return null
    dueTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    title = title.replace(timeMatch[0], ' ')
  }
  const durationMatch = title.match(/\b(?:por|duracao|duração)\s*(\d{1,3})\s*(?:min|minutos)?\b/i)
  const duration = durationMatch ? Math.max(5, Number(durationMatch[1])) : 25
  if (durationMatch) title = title.replace(durationMatch[0], '')
  let priority: NewAssistantTask['priority'] = 'media'
  if (/\bprioridade\s+alta\b/i.test(title) || /\burgente\b/i.test(title)) priority = 'alta'
  if (/\bprioridade\s+baixa\b/i.test(title)) priority = 'baixa'
  title = title.replace(/\bprioridade\s+(alta|media|m[eé]dia|baixa)\b/gi, '').replace(/\burgente\b/gi, '')
  title = title.replace(/\s+/g, ' ').replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, '').trim()
  if (!title || title.length < 2) return null
  const category = /aws|reprograma|estud|curso|aula|programa|python|cloud|tecnologia/i.test(title)
    ? 'Estudos'
    : /trabalho|reuniao|cliente|relatorio|mirage/i.test(title) ? 'Trabalho'
    : /mercado|limpeza|casa|familia|filha/i.test(title) ? 'Família' : 'Pessoal'
  const availability: NewAssistantTask['availability'] = dueTime < '12:00' ? 'manha' : dueTime < '18:00' ? 'tarde' : 'noite'
  return { title, dueDate, dueTime, duration, priority, availability, category }
}

export function TaskAssistant({
  tasks, onCreate, onUpdate, onDelete,
}: {
  tasks: AssistantTask[]
  onCreate: (task: NewAssistantTask) => void
  onUpdate: (taskId: string, changes: Partial<AssistantTask>) => void
  onDelete: (taskId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: 'Olá! Sou o assistente do Meu Ritmo. Posso consultar, criar, editar e excluir tarefas. Toda alteração fica aguardando sua confirmação.' },
  ])
  const activeTasks = useMemo(() => tasks.filter(task => !task.deletedAt), [tasks])

  function reply(text: string) {
    setMessages(current => [...current, { role: 'assistant', text }])
  }

  function handleSend() {
    const command = input.trim()
    if (!command || busy) return
    setInput('')
    setMessages(current => [...current, { role: 'user', text: command }])
    const normalized = normalize(command)

    if (pending) {
      if (normalized === 'confirmo') {
        setBusy(true)
        if (pending.kind === 'create') onCreate(pending.task)
        if (pending.kind === 'update') onUpdate(pending.taskId, pending.changes)
        if (pending.kind === 'delete') onDelete(pending.taskId)
        const doneMessage = pending.kind === 'create'
          ? `Tarefa “${pending.task.title}” adicionada ao aplicativo. A sincronização com sua conta será feita pelo Meu Ritmo.`
          : pending.kind === 'update'
            ? `Tarefa “${pending.title}” atualizada no aplicativo. A sincronização com sua conta será feita pelo Meu Ritmo.`
            : `Tarefa “${pending.title}” marcada para exclusão no aplicativo. A sincronização com sua conta será feita pelo Meu Ritmo.`
        setPending(null)
        reply(doneMessage)
        setBusy(false)
        return
      }
      if (['cancelar', 'cancela', 'desistir'].includes(normalized)) {
        setPending(null)
        reply('Tudo bem. A alteração foi cancelada e nada foi modificado.')
        return
      }
      reply('Há uma alteração aguardando. Digite “confirmo” para executá-la ou “cancelar” para desistir.')
      return
    }

    if (/\b(confirmo|cancelar)\b/.test(normalized)) {
      reply('Não há nenhuma alteração aguardando confirmação.')
      return
    }

    if (/(listar|liste|mostra|mostrar|quais|consultar|consulta|ver|veja).*(tarefas|pendencias|pendentes|concluidas)|^(tarefas|minhas tarefas)$/i.test(normalized)) {
      const selected = activeTasks.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.dueTime.localeCompare(b.dueTime))
      if (!selected.length) { reply('Você não tem tarefas cadastradas no momento.'); return }
      const lines = selected.slice(0, 12).map(task => `• ${task.done ? '✓' : '○'} ${task.title} — ${datePt(task.dueDate)} às ${timePt(task.dueTime)}`)
      reply(`Encontrei ${selected.length} tarefa(s):\n${lines.join('\n')}${selected.length > 12 ? '\nMostrei as 12 primeiras.' : ''}`)
      return
    }


    // Consultas flexíveis: reconhece diferentes formas de perguntar sem exigir uma frase exata.
    const pendingTasks = activeTasks.filter(isPending)
    const today = localDay()
    const tomorrow = localDay(1)
    const now = new Date()
    const currentClock = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
    const overdue = pendingTasks.filter(task => task.dueDate < today || (task.dueDate === today && task.dueTime < currentClock))
    const todayTasks = pendingTasks.filter(task => task.dueDate === today).sort(taskOrder)
    const tomorrowTasks = pendingTasks.filter(task => task.dueDate === tomorrow).sort(taskOrder)

    if (/(atrasad|vencid|passou do prazo|prazo expir)/i.test(normalized)) {
      reply(overdue.length
        ? 'Encontrei ' + overdue.length + ' tarefa(s) atrasada(s):\n' + overdue.map(formatTask).join('\n') + '\n\nPosso ajudar a escolher o que priorizar, sem remarcar nada automaticamente.'
        : 'Não encontrei tarefas atrasadas entre as tarefas ativas.')
      return
    }

    if (/(amanha|dia seguinte)/i.test(normalized) && /(tenho|fazer|tarefas|pendencias|pendentes|programad|agendad|preciso|mostra|quais|o que)/i.test(normalized)) {
      reply(tomorrowTasks.length
        ? 'Para amanhã, encontrei ' + tomorrowTasks.length + ' tarefa(s):\n' + tomorrowTasks.map(formatTask).join('\n')
        : 'Você não tem tarefas pendentes para amanhã.')
      return
    }

    if (/(hoje|para hoje|neste dia)/i.test(normalized) && /(tenho|fazer|tarefas|pendencias|pendentes|programad|agendad|preciso|mostra|quais|o que|importante|priorid)/i.test(normalized)) {
      reply(todayTasks.length
        ? 'Para hoje, estas são suas ' + todayTasks.length + ' tarefa(s) pendentes, em ordem de prazo e prioridade:\n' + todayTasks.map(formatTask).join('\n')
        : 'Você não tem tarefas pendentes para hoje.')
      return
    }

    if (/(quanto tempo|tempo total|soma.*minutos|minutos.*tarefas)/i.test(normalized)) {
      const total = todayTasks.reduce((sum, task) => sum + task.duration, 0)
      reply(todayTasks.length
        ? 'Suas ' + todayTasks.length + ' tarefa(s) pendentes de hoje somam ' + total + ' minutos (' + Math.floor(total / 60) + 'h ' + total % 60 + 'min).'
        : 'Você não tem tarefas pendentes para hoje, então não há tempo de tarefas a somar.')
      return
    }

    if (/(pouco tempo|tempo livre|consigo fazer|cabe no meu tempo|em \d+\s*(?:min|minutos)|meia hora|30 minutos)/i.test(normalized)) {
      const durationMatch = normalized.match(/(\d{1,3})\s*(?:min|minutos)/)
      const available = durationMatch ? Number(durationMatch[1]) : 30
      const fitting = pendingTasks.filter(task => task.duration <= available).sort((a, b) => taskPriority(a) - taskPriority(b) || a.duration - b.duration || taskOrder(a, b))
      reply(fitting.length
        ? 'Com ' + available + ' minutos, estas tarefas cabem no tempo disponível:\n' + fitting.slice(0, 8).map(formatTask).join('\n') + '\n\nA sugestão é escolher apenas uma. Não alterei sua agenda.'
        : 'Não encontrei tarefa pendente com duração de até ' + available + ' minutos. Você pode aumentar o tempo disponível ou dividir uma atividade manualmente.')
      return
    }

    if (/(deixar para depois|adiar|postergar|o que pode esperar|o que posso deixar|menos urgente)/i.test(normalized)) {
      const candidates = [...pendingTasks].sort((a, b) =>
        taskPriority(b) - taskPriority(a) || b.dueDate.localeCompare(a.dueDate) || b.dueTime.localeCompare(a.dueTime))
      reply(candidates.length
        ? 'Estas são candidatas a esperar, considerando prioridade mais baixa e prazos mais distantes:\n' + candidates.slice(0, 5).map(formatTask).join('\n') + '\n\nÉ apenas uma sugestão: não mudei nenhum prazo.'
        : 'Não há tarefas pendentes para avaliar neste momento.')
      return
    }

    if (/(organize|organizar|organiza|priorize|priorizar|mais importante|por onde comec|o que faco primeiro|sem sobrecarregar)/i.test(normalized)) {
      const candidates = [...pendingTasks].sort((a, b) => {
        const aLate = a.dueDate < today || (a.dueDate === today && a.dueTime < currentClock)
        const bLate = b.dueDate < today || (b.dueDate === today && b.dueTime < currentClock)
        return Number(bLate) - Number(aLate) || taskPriority(a) - taskPriority(b) || taskOrder(a, b)
      })
      reply(candidates.length
        ? 'Para evitar sobrecarga, sugiro começar por até três tarefas:\n' + candidates.slice(0, 3).map((task, index) => (index + 1) + '. ' + formatTask(task)).join('\n') + '\n\nO restante pode continuar na lista. Esta é uma recomendação; não reorganizei nem alterei seus prazos.'
        : 'Não há tarefas pendentes para organizar.')
      return
    }

    if (/(prioridade alta|urgente|mais prioritarias)/i.test(normalized)) {
      const candidates = pendingTasks.filter(task => task.priority === 'alta').sort(taskOrder)
      reply(candidates.length
        ? 'Tarefas pendentes com prioridade alta:\n' + candidates.map(formatTask).join('\n')
        : 'Não encontrei tarefas pendentes com prioridade alta.')
      return
    }

    const create = parseCreate(command)
    if (create) {
      setPending({ kind: 'create', task: create })
      reply(`Prévia do cadastro:\n• Tarefa: ${create.title}\n• Prazo: ${datePt(create.dueDate)}\n• Horário: ${create.dueTime}\n• Duração: ${create.duration} min\n• Prioridade: ${create.priority}\n• Categoria: ${create.category}\n\nSe estiver correto, digite “confirmo”.`)
      return
    }

    const deleteMatch = command.match(/(?:excluir|exclua|apagar|apague|remover|remova)\s+(?:a\s+)?tarefa\s+(.+)/i)
    if (deleteMatch) {
      const found = findTask(deleteMatch[1], activeTasks)
      if (found.ambiguous) { reply('Encontrei mais de uma tarefa com esse nome. Escreva o título completo para eu identificar a correta.'); return }
      if (!found.task) { reply('Não encontrei uma tarefa com esse nome. Você pode pedir “listar tarefas” para consultar os títulos.'); return }
      setPending({ kind: 'delete', taskId: found.task.id, title: found.task.title })
      reply(`Você está prestes a excluir “${found.task.title}”. A tarefa será marcada como excluída no histórico. Digite “confirmo” para prosseguir ou “cancelar” para desistir.`)
      return
    }

    const renameMatch = command.match(/(?:editar|edite|alterar|altere|renomear|renomeie)\s+(?:a\s+)?tarefa\s+(.+?)\s+(?:para|com o titulo|com título)\s+(.+)/i)
    if (renameMatch) {
      const found = findTask(renameMatch[1], activeTasks)
      if (found.ambiguous) { reply('Encontrei mais de uma tarefa com esse nome. Informe o título completo.'); return }
      if (!found.task) { reply('Não encontrei essa tarefa. Peça “listar tarefas” para consultar os títulos.'); return }
      const newTitle = renameMatch[2].trim().replace(/[.!?]+$/, '')
      setPending({ kind: 'update', taskId: found.task.id, title: found.task.title, changes: { title: newTitle }, summary: `Título: ${newTitle}` })
      reply(`Prévia da edição:\n• Antes: ${found.task.title}\n• Depois: ${newTitle}\n\nDigite “confirmo” para aplicar ou “cancelar” para desistir.`)
      return
    }

    const completeMatch = command.match(/(?:concluir|conclua|finalizar|finalize|marcar como conclu[ií]da)\s+(?:a\s+)?tarefa\s+(.+)/i)
    if (completeMatch) {
      const found = findTask(completeMatch[1], activeTasks)
      if (found.ambiguous) { reply('Encontrei mais de uma tarefa com esse nome. Informe o título completo.'); return }
      if (!found.task) { reply('Não encontrei essa tarefa. Peça “listar tarefas” para consultar os títulos.'); return }
      setPending({ kind: 'update', taskId: found.task.id, title: found.task.title, changes: { done: true, completedAt: new Date().toISOString() }, summary: 'Marcar como concluída' })
      reply(`Prévia: marcar “${found.task.title}” como concluída. Digite “confirmo” para aplicar ou “cancelar” para desistir.`)
      return
    }

    reply('Ainda não consegui identificar o que você quer fazer. Você pode perguntar de outras maneiras, por exemplo: “o que tenho para amanhã?”, “quais tarefas estão atrasadas?”, “tenho 30 minutos, o que cabe nesse tempo?”, “o que posso deixar para depois?” ou “organize minhas prioridades”. Também posso criar, editar, concluir e excluir tarefas, sempre pedindo confirmação antes de alterar algo.')
  }

  return <div className="assistant-widget">
    {open && <section className="assistant-panel" aria-label="Assistente Meu Ritmo">
      <header className="assistant-header"><span className="assistant-avatar"><Bot size={19} /></span><div><b>Assistente Meu Ritmo</b><small>Comandos gratuitos · sem API externa</small></div><button type="button" className="assistant-close" onClick={() => setOpen(false)} aria-label="Fechar assistente"><X size={18} /></button></header>
      <div className="assistant-messages" aria-live="polite">{messages.map((message, index) => <div key={index} className={`assistant-message ${message.role}`}><span>{message.text}</span></div>)}
        {pending && <div className="assistant-confirm"><b><Sparkles size={14} /> Confirmação necessária</b><small>Digite “confirmo” para executar ou “cancelar” para manter os dados inalterados.</small></div>}
      </div>
      <form className="assistant-input-row" onSubmit={event => { event.preventDefault(); handleSend() }}><input value={input} onChange={event => setInput(event.target.value)} placeholder="Ex.: listar tarefas" aria-label="Escreva um comando" /><button type="submit" disabled={!input.trim() || busy} aria-label="Enviar comando"><Send size={17} /></button></form>
      <p className="assistant-hint"><ListTodo size={13} /> Você tem {activeTasks.length} tarefa(s) ativa(s).</p>
    </section>}
    <button type="button" className="assistant-launcher" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label={open ? 'Fechar assistente' : 'Abrir assistente'}><Bot size={20} /><span>Assistente</span></button>
  </div>
}
