import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const hash = async (value: string) => {
  const bytes = new TextEncoder().encode(value.normalize("NFKC").trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const authorization = req.headers.get("Authorization") || "";
    const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!accessToken) return json({ error: "Entre na sua conta para continuar." }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !serviceKey || !publishableKey) return json({ error: "Configuração interna ausente." }, 500);

    const authClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
    if (authError || !authData.user) return json({ error: "Sessão inválida. Entre novamente." }, 401);
    const userId = authData.user.id;
    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json();

    if (body.action === "claim") {
      const syncCode = typeof body.syncCode === "string" ? body.syncCode.trim() : "";
      if (syncCode.length < 12 || syncCode.length > 200) return json({ error: "Não foi possível identificar o histórico antigo." }, 400);
      const tokenHash = await hash(syncCode);
      const { data: legacySpace, error } = await db.from("sync_spaces").select("id,owner_id").eq("token_hash", tokenHash).maybeSingle();
      if (error) throw error;
      if (!legacySpace) return json({ error: "O código antigo não corresponde a um histórico sincronizado. Seus dados locais continuam preservados." }, 404);
      if (legacySpace.owner_id && legacySpace.owner_id !== userId) return json({ error: "Esse histórico já está vinculado a outra conta." }, 409);

      const { data: claimResult, error: claimError } = await db.rpc("claim_meu_ritmo_legacy_space", {
        p_space_id: legacySpace.id,
        p_user_id: userId,
      });
      if (claimError) {
        const message = claimError.message || "";
        if (message.includes("owned_by_another_user") || message.includes("rows_owned_by_another_user")) {
          return json({ error: "Esse histórico ou parte dele já está vinculado a outra conta. Nenhum registro foi transferido." }, 409);
        }
        throw claimError;
      }
      return json(claimResult);
    }

    let { data: space, error: spaceError } = await db.from("sync_spaces").select("id").eq("owner_id", userId).maybeSingle();
    if (spaceError) throw spaceError;
    if (!space) {
      const { data: created, error: createError } = await db.from("sync_spaces").insert({ token_hash: await hash("meu-ritmo-account:" + userId), owner_id: userId }).select("id").single();
      if (createError) throw createError;
      space = created;
    }
    const spaceId = space.id;

    if (body.action === "load") {
      const [tasks, habits, completions, focus, library] = await Promise.all([
        db.from("tasks").select("*").eq("owner_id", userId),
        db.from("habits").select("*").eq("owner_id", userId),
        db.from("habit_completions").select("habit_id,completed_on").eq("owner_id", userId),
        db.from("focus_sessions").select("*").eq("owner_id", userId).order("started_at", { ascending: false }).limit(1000),
        db.from("library_items").select("*").eq("owner_id", userId),
      ]);
      for (const result of [tasks, habits, completions, focus, library]) if (result.error) throw result.error;
      return json({
        tasks: tasks.data.map((t) => ({ id: t.id, title: t.title, dueDate: t.due_date ?? "", dueTime: t.due_time?.slice(0, 5) ?? "", duration: t.duration, priority: t.priority, availability: t.availability, done: t.done, createdAt: Number(t.created_at), category: t.category, completedAt: t.completed_at, deletedAt: t.deleted_at ?? null })),
        habits: habits.data.map((h) => ({ id: h.id, title: h.title, note: h.note, periodicity: h.periodicity, completed: completions.data.filter((c) => c.habit_id === h.id).map((c) => c.completed_on) })),
        library: library.data.map((l) => ({ id: l.id, title: l.title, kind: l.kind, note: l.note, done: l.done })),
        focusSessions: focus.data,
        updatedAt: new Date().toISOString(),
      });
    }

    if (body.action !== "save" || !body.data || typeof body.data !== "object") return json({ error: "Ação inválida." }, 400);
    const data = body.data;
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const habits = Array.isArray(data.habits) ? data.habits : [];
    const library = Array.isArray(data.library) ? data.library : [];
    const focusSessions = Array.isArray(data.focusSessions) ? data.focusSessions : [];
    const taskRows = tasks.filter((t) => t && typeof t.id === "string" && typeof t.title === "string").map((t) => ({
      owner_id: userId, space_id: spaceId, id: t.id, title: t.title, due_date: t.dueDate || null, due_time: t.dueTime || null,
      duration: Math.max(1, Number(t.duration) || 25), priority: ["alta", "media", "baixa"].includes(t.priority) ? t.priority : "media",
      availability: ["qualquer", "manha", "tarde", "noite"].includes(t.availability) ? t.availability : "qualquer",
      done: Boolean(t.done), created_at: Number(t.createdAt) || Date.now(), category: String(t.category || "Pessoal"),
      completed_at: t.done ? (t.completedAt || null) : null, deleted_at: t.deletedAt || null, updated_at: new Date().toISOString(),
    }));
    const habitRows = habits.filter((h) => h && typeof h.id === "string" && typeof h.title === "string").map((h) => ({
      owner_id: userId, space_id: spaceId, id: h.id, title: h.title, note: String(h.note || ""),
      periodicity: ["daily", "weekly", "weekdays", "custom"].includes(h.periodicity) ? h.periodicity : "daily", updated_at: new Date().toISOString(),
    }));
    const libraryRows = library.filter((l) => l && typeof l.id === "string" && typeof l.title === "string").map((l) => ({
      owner_id: userId, space_id: spaceId, id: l.id, title: l.title, kind: ["Leitura", "Curso", "Anotação"].includes(l.kind) ? l.kind : "Anotação",
      note: String(l.note || ""), done: Boolean(l.done), updated_at: new Date().toISOString(),
    }));
    if (taskRows.length) { const r = await db.from("tasks").upsert(taskRows, { onConflict: "space_id,id" }); if (r.error) throw r.error; }
    if (habitRows.length) { const r = await db.from("habits").upsert(habitRows, { onConflict: "space_id,id" }); if (r.error) throw r.error; }
    if (libraryRows.length) { const r = await db.from("library_items").upsert(libraryRows, { onConflict: "space_id,id" }); if (r.error) throw r.error; }
    const completionRows = habits.flatMap((h) => Array.isArray(h.completed) ? h.completed.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).map((date) => ({ owner_id: userId, space_id: spaceId, habit_id: h.id, completed_on: date })) : []);
    if (completionRows.length) { const r = await db.from("habit_completions").upsert(completionRows, { onConflict: "space_id,habit_id,completed_on", ignoreDuplicates: true }); if (r.error) throw r.error; }
    const focusRows = focusSessions.filter((s) => s && typeof s.id === "string" && s.started_at).map((s) => ({ id: s.id, owner_id: userId, space_id: spaceId, started_at: s.started_at, ended_at: s.ended_at || null, duration_minutes: Math.max(1, Number(s.duration_minutes) || 25), completed: Boolean(s.completed) }));
    if (focusRows.length) { const r = await db.from("focus_sessions").upsert(focusRows, { onConflict: "id", ignoreDuplicates: true }); if (r.error) throw r.error; }
    return json({ ok: true, saved: { tasks: taskRows.length, habits: habitRows.length, library: libraryRows.length, habitCompletions: completionRows.length, focusSessions: focusRows.length } });
  } catch (error) {
    console.error("meu-ritmo-sync error", error);
    return json({ error: "Não foi possível sincronizar. Confira sua sessão e tente novamente." }, 500);
  }
});
