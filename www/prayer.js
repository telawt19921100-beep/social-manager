// Prayer times, countdown, in-app sound alert, and native notifications.
// Times come from the Aladhan API (free, no key). Method 5 = Egyptian General Authority.

const NAMES = [
  ["Fajr", "الفجر"], ["Dhuhr", "الظهر"], ["Asr", "العصر"], ["Maghrib", "المغرب"], ["Isha", "العشاء"],
];
const CFG_KEY = "prayerCfg";
const DEFAULT_CFG = { city: "Cairo", country: "Egypt", method: 5, notify: true, sound: true, enabled: { Fajr: true, Dhuhr: true, Asr: true, Maghrib: true, Isha: true } };
// Native plugins are reached through Capacitor.registerPlugin; fall back to the Plugins map.
const C = window.Capacitor;
const plugin = (name) => {
  try { return C?.registerPlugin ? C.registerPlugin(name) : C?.Plugins?.[name]; } catch { return undefined; }
};
const Native = C ? {
  LocalNotifications: plugin("LocalNotifications"),
  Ringtone: plugin("Ringtone"),
} : null;

const $ = (id) => document.getElementById(id);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const cfg = () => ({ ...DEFAULT_CFG, ...load(CFG_KEY, {}) });

const pad = (n) => String(n).padStart(2, "0");
const dmy = (d) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const clean = (t) => t.split(" ")[0]; // "05:12 (EET)" -> "05:12"

// Fetch one day's timings (cached per day + city + method).
async function timingsFor(day, c) {
  const key = `times:${ymd(day)}:${c.city}:${c.country}:${c.method}`;
  const cached = load(key, null);
  if (cached) return cached;
  const url = `https://api.aladhan.com/v1/timingsByCity/${dmy(day)}?` + new URLSearchParams({
    city: c.city, country: c.country, method: c.method,
  });
  const res = await fetch(url);
  const json = await res.json();
  if (json.code !== 200) throw new Error(json.status || "تعذّر جلب المواقيت");
  const t = json.data.timings;
  const out = {};
  for (const [en] of NAMES) out[en] = clean(t[en]);
  save(key, out);
  return out;
}

// Build a list of upcoming prayers for the next 7 days.
async function upcoming(c) {
  const list = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const t = await timingsFor(day, c);
    for (const [en, ar] of NAMES) {
      const [h, m] = t[en].split(":").map(Number);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0);
      if (at > now) list.push({ en, ar, at, day: ymd(day) });
    }
  }
  return list;
}

// Hijri (Umm al-Qura) date from the browser's Intl support; falls back to Gregorian.
function hijriToday() {
  try {
    return new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  } catch {
    return new Date().toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" });
  }
}

function fmt(d) { return d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }); }

function countdown(target) {
  const ms = target - new Date();
  if (ms <= 0) return "الآن";
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h} س ${m} د` : `${m} د`;
}

// Native notifications: schedule each enabled prayer for the next 7 days.
async function scheduleNative(list, c) {
  if (!Native?.LocalNotifications) return;
  const old = load("prayerNotifIds", []);
  if (old.length) await Native.LocalNotifications.cancel({ notifications: old.map((id) => ({ id })) });
  if (!c.notify) { save("prayerNotifIds", []); return; }
  const perm = await Native.LocalNotifications.requestPermissions();
  if (perm.display !== "granted") return;
  const items = list.filter((p) => c.enabled[p.en]).map((p, i) => ({
    id: Number(p.day) * 10 + NAMES.findIndex(([e]) => e === p.en),
    title: "إنجز",
    body: `حان وقت صلاة ${p.ar}`,
    schedule: { at: p.at },
    channelId: c.channelId || undefined,
    sound: c.sound ? null : undefined,
    allowWhileIdle: true,
  }));
  if (items.length) await Native.LocalNotifications.schedule({ notifications: items });
  save("prayerNotifIds", items.map((n) => n.id));
}

// Web/in-app fallback: a short tone when a prayer time arrives while the app is open.
let lastAlerted = load("prayerAlerted", "");
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.25, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.6);
    o.start(); o.stop(ctx.currentTime + 1.6);
  } catch {}
}
function checkDue(list) {
  const c = cfg();
  const now = new Date();
  for (const p of list) {
    if (!c.enabled[p.en]) continue;
    const key = `${p.day}-${p.en}`;
    if (p.at <= now && now - p.at < 120000 && lastAlerted !== key) {
      lastAlerted = key; save("prayerAlerted", key);
      if (c.sound) beep();
      if (c.notify && !Native?.LocalNotifications && "Notification" in window && Notification.permission === "granted") {
        new Notification("إنجز", { body: `حان وقت صلاة ${p.ar}` });
      }
    }
  }
}

function render(list, c) {
  const el = $("prayerList");
  el.textContent = "";
  const next = list[0];
  $("nextName").textContent = next ? next.ar : "—";
  $("nextTime").textContent = next ? fmt(next.at) : "";
  $("nextCountdown").textContent = next ? `بعد ${countdown(next.at)}` : "";
  for (const [en, ar] of NAMES) {
    const p = list.find((x) => x.en === en);
    const li = document.createElement("li");
    li.className = "prayer" + (next && next.en === en ? " next" : "");
    li.innerHTML = `<span>${ar}</span><strong>${p ? fmt(p.at) : "—"}</strong>`;
    el.append(li);
  }
  $("cityLabel").textContent = `${c.city}، ${c.country}`;
  $("hijriDate").textContent = hijriToday();
}

async function refresh() {
  const c = cfg();
  $("prayerStatus").textContent = "جارٍ التحميل...";
  try {
    const list = await upcoming(c);
    render(list, c);
    await scheduleNative(list, c);
    $("prayerStatus").textContent = "";
    window._prayerList = list;
  } catch (e) {
    $("prayerStatus").textContent = "تعذّر جلب المواقيت: " + e.message;
  }
}

function fillSettings() {
  const c = cfg();
  $("pCity").value = c.city;
  $("pCountry").value = c.country;
  $("pNotify").checked = c.notify;
  $("pSound").checked = c.sound;
  for (const [en] of NAMES) $(`pe_${en}`).checked = c.enabled[en];
}

$("pSave")?.addEventListener("click", async () => {
  const c = {
    city: $("pCity").value.trim() || "Cairo",
    country: $("pCountry").value.trim() || "Egypt",
    method: 5,
    notify: $("pNotify").checked,
    sound: $("pSound").checked,
    enabled: Object.fromEntries(NAMES.map(([en]) => [en, $(`pe_${en}`).checked])),
  };
  save(CFG_KEY, c);
  alert("تم حفظ إعدادات الصلاة.");
  await refresh();
});

$("pTest")?.addEventListener("click", () => { beep(); alert("تنبيه تجريبي"); });

// Pick a notification sound from the phone (Android only).
$("pRingtone")?.addEventListener("click", async () => {
  if (!Native?.Ringtone) { alert("اختيار النغمة متاح على أندرويد فقط."); return; }
  try {
    const { uri } = await Native.Ringtone.pick();
    const { channelId } = await Native.Ringtone.ensureChannel({ uri: uri || "" });
    save(CFG_KEY, { ...cfg(), channelId, ringtoneUri: uri || "" });
    $("pRingtoneStatus").textContent = uri ? "تم اختيار نغمة مخصصة" : "تم اختيار النغمة الافتراضية";
    await refresh();
  } catch (e) {
    alert("تعذّر اختيار النغمة: " + (e?.message || e));
  }
});

(async function init() {
  fillSettings();
  await refresh();
  // Re-check every 30 seconds for the in-app alert and the countdown.
  setInterval(() => {
    if (window._prayerList) { checkDue(window._prayerList); render(window._prayerList.filter((p) => p.at > new Date()), cfg()); }
  }, 30000);
})();
