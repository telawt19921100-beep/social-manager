import { listComments, replyToComment, publishPost } from "./graph.js";

const $ = (id) => document.getElementById(id);
const DAILY_AUTO_LIMIT = 20;
const DISCLOSURE = "\n\n(رد تلقائي من إدارة الصفحة)";

const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const today = () => new Date().toISOString().slice(0, 10);
const settings = () => store.get("settings", { pageId: "", token: "", footer: true });
const autoState = () => store.get("auto", { on: false, sent: [], counts: {} });
const handled = () => new Set(store.get("handled", []));
const markHandled = (id) => { const h = [...handled(), id]; store.set("handled", h.slice(-500)); };

function draftFor(item) { return `شكرًا ${item.from || ""} على تعليقك!`; }

// Tabs
document.querySelectorAll("nav button").forEach((b) => b.onclick = () => {
  document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("active", x === b));
  document.querySelectorAll("main > section").forEach((s) => s.hidden = s.id !== b.dataset.tab);
});

// Core: fetch, auto-send within cap, then show what remains for manual review.
async function refresh() {
  const s = settings();
  if (!s.pageId || !s.token) { $("manualList").textContent = "أضف معرف الصفحة والتوكن في الإعدادات أولًا."; return; }
  let items;
  try { items = await listComments(s.pageId, s.token); }
  catch (e) { $("manualList").textContent = "خطأ في الاتصال: " + e.message; return; }

  const done = handled();
  let pending = items.filter((i) => !done.has(i.id));

  const auto = autoState();
  if (auto.on) {
    const used = auto.counts[today()] || 0;
    const room = Math.max(0, DAILY_AUTO_LIMIT - used);
    const batch = pending.slice(0, room);
    for (const item of batch) {
      const text = draftFor(item) + (s.footer ? DISCLOSURE : "");
      try {
        await replyToComment(item.id, s.token, text);
        markHandled(item.id);
        auto.counts[today()] = (auto.counts[today()] || 0) + 1;
        auto.sent = [{ time: new Date().toLocaleString("ar"), to: item.from || "", text }, ...auto.sent].slice(0, 50);
        store.set("auto", auto);
      } catch (e) { /* leave it in the manual queue */ }
    }
    const nowDone = handled();
    pending = pending.filter((i) => !nowDone.has(i.id));
  }

  renderManual(pending);
  renderAuto();
}

function renderManual(pending) {
  const list = $("manualList");
  list.textContent = "";
  $("bulkBar").hidden = !pending.length;
  if (!pending.length) { list.textContent = "لا توجد تعليقات تنتظر ردك."; return; }
  const rows = [];
  for (const item of pending) {
    const li = document.createElement("li");
    const pick = document.createElement("input");
    pick.type = "checkbox";
    pick.style.width = "auto";
    const txt = document.createElement("p");
    txt.textContent = `${item.from || "مستخدم"}: ${item.text || ""}`;
    const draft = document.createElement("textarea");
    draft.rows = 2;
    draft.value = draftFor(item);
    const send = document.createElement("button");
    send.textContent = "إرسال";
    send.onclick = async () => {
      if (!confirm("إرسال هذا الرد الآن؟")) return;
      try { await replyToComment(item.id, settings().token, draft.value); markHandled(item.id); li.remove(); }
      catch (e) { alert("فشل الإرسال: " + e.message); }
    };
    const ignore = document.createElement("button");
    ignore.textContent = "تجاهل";
    ignore.className = "secondary";
    ignore.onclick = () => { markHandled(item.id); li.remove(); };
    li.append(pick, txt, draft, send, ignore);
    list.append(li);
    rows.push({ item, li, pick, draft });
  }
  window._rows = rows;
}

// Shared box: copy its text into every selected draft. Each draft stays editable.
$("applyShared").onclick = () => {
  const text = $("sharedText").value;
  if (!text.trim()) return;
  for (const r of window._rows || []) if (r.pick.checked) r.draft.value = text;
};

// Pool: several different replies, one per line. Each selected comment gets its own line, in order.
$("distributePool").onclick = () => {
  const pool = $("replyPool").value.split("\n").map((t) => t.trim()).filter(Boolean);
  const selected = (window._rows || []).filter((r) => r.pick.checked);
  if (!selected.length) { alert("حدّد تعليقًا واحدًا على الأقل."); return; }
  if (pool.length < selected.length) { alert(`عندك ${selected.length} تعليقات محددة و${pool.length} ردود فقط. أضف ردودًا أكثر، لأن تكرار الرد نفسه ممنوع.`); return; }
  selected.forEach((r, i) => { r.draft.value = pool[i]; });
};

$("sendSelected").onclick = async () => {
  const selected = (window._rows || []).filter((r) => r.pick.checked);
  if (!selected.length) { alert("حدّد تعليقًا واحدًا على الأقل."); return; }
  const texts = selected.map((r) => r.draft.value.trim());
  // Identical replies to many people look like spam to Meta; require personal wording.
  const dupes = texts.some((t, i) => texts.indexOf(t) !== i);
  if (dupes) { alert("بعض المسودات متطابقة. عدّل كل رد ليناسب صاحب التعليق قبل الإرسال."); return; }
  if (!confirm(`إرسال ${selected.length} رد(ود) بعد مراجعتها؟`)) return;
  let ok = 0;
  for (const r of selected) {
    try { await replyToComment(r.item.id, settings().token, r.draft.value); markHandled(r.item.id); r.li.remove(); ok++; }
    catch (e) { r.li.style.color = "red"; }
  }
  alert(`تم إرسال ${ok} من ${selected.length}.`);
};

function renderAuto() {
  const auto = autoState();
  $("autoToggle").textContent = auto.on ? "إيقاف الرد التلقائي" : "تفعيل الرد التلقائي";
  $("autoStatus").textContent = auto.on ? "مفعّل" : "متوقف";
  $("autoCount").textContent = `أُرسل اليوم: ${auto.counts[today()] || 0} من ${DAILY_AUTO_LIMIT}`;
  const log = $("autoLog");
  log.textContent = "";
  if (!auto.sent.length) log.textContent = "لا توجد ردود تلقائية بعد.";
  for (const r of auto.sent) {
    const li = document.createElement("li");
    li.textContent = `${r.time} — ${r.to}: ${r.text}`;
    log.append(li);
  }
}

$("autoToggle").onclick = () => {
  const auto = autoState();
  if (!auto.on) {
    if (!confirm("الرد التلقائي يرسل الردود دون مراجعة، بحد أقصى 20 في اليوم. هل تؤكد التفعيل؟")) return;
    auto.on = true;
  } else {
    auto.on = false;
  }
  store.set("auto", auto);
  renderAuto();
  refresh();
};

$("publish").onclick = async () => {
  const text = $("postText").value.trim();
  if (!text) return;
  if (!confirm("نشر هذا المنشور على الصفحة؟")) return;
  try { await publishPost(settings().pageId, settings().token, text); alert("تم النشر."); $("postText").value = ""; }
  catch (e) { alert("فشل النشر: " + e.message); }
};

$("saveSettings").onclick = () => {
  store.set("settings", {
    pageId: $("pageId").value.trim(),
    token: $("token").value.trim(),
    footer: $("footer").checked,
  });
  alert("تم الحفظ.");
  refresh();
};

// Facebook login. AUTH_URL is the deployed worker's /login endpoint.
const AUTH_URL = "https://injaz-auth.telawt19921100.workers.dev/login";
const Native = window.Capacitor ? {
  Browser: (() => { try { return window.Capacitor.registerPlugin("Browser"); } catch { return undefined; } })(),
  App: (() => { try { return window.Capacitor.registerPlugin("App"); } catch { return undefined; } })(),
} : null;

function saveFromPages(pages) {
  if (!pages.length) return;
  let chosen = pages[0];
  if (pages.length > 1) {
    const list = pages.map((p, i) => `${i + 1}) ${p.name}`).join("\n");
    const n = parseInt(prompt(`اختر الصفحة:\n${list}`, "1"), 10);
    chosen = pages[(n || 1) - 1] || pages[0];
  }
  store.set("settings", { ...settings(), pageId: chosen.id, token: chosen.token });
  $("pageId").value = chosen.id;
  $("token").value = chosen.token;
  alert(`تم ربط الصفحة: ${chosen.name}`);
  refresh();
}

$("fbLogin").onclick = async () => {
  if (Native?.Browser) await Native.Browser.open({ url: AUTH_URL });
  else window.location.href = AUTH_URL;
};

// The worker redirects to injaz://auth?pages=<base64 json>.
if (Native?.App) {
  Native.App.addListener("appUrlOpen", (event) => {
    try {
      const u = new URL(event.url);
      const raw = u.searchParams.get("pages");
      if (!raw) return;
      const pages = JSON.parse(decodeURIComponent(escape(atob(raw))));
      if (Native.Browser) Native.Browser.close();
      saveFromPages(pages);
    } catch (e) { alert("تعذّر قراءة بيانات الدخول: " + e.message); }
  });
}

(function init() {
  const s = settings();
  $("pageId").value = s.pageId;
  $("token").value = s.token;
  $("footer").checked = s.footer !== false;
  renderAuto();
  refresh();
})();
