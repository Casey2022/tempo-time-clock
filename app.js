const TIMEZONE = 'America/New_York';
let activeView = 'overview';
let calendarCursor = new Date();
calendarCursor.setDate(1);
let weekCursor = null; // Monday date key shown in Week view; null = current week
let toastTimer;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pad = (value) => String(value).padStart(2, '0');

function generateUuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return '00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0');
}

function getParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date).reduce((acc, item) => ({ ...acc, [item.type]: item.value }), {});
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute), second: Number(parts.second) };
}

function dateKeyFromDate(date = new Date()) {
  const p = getParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function keyFromParts(year, month, day) { return `${year}-${pad(month)}-${pad(day)}`; }

function dateFromKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function addDaysToKey(key, amount) {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + amount);
  return keyFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function mondayKey(date = new Date()) {
  const key = dateKeyFromDate(date);
  const weekday = dateFromKey(key).getUTCDay();
  return addDaysToKey(key, -(weekday === 0 ? 6 : weekday - 1));
}

function offsetMinutesAt(date) {
  const value = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, timeZoneName: 'longOffset' })
    .formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || 'GMT-05:00';
  const match = value.match(/GMT([+-])(\d{2})(?::?(\d{2}))?/);
  if (!match) return -300;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === '+' ? minutes : -minutes;
}

function zonedInputToISO(value) {
  if (!value) return null;
  const [datePart, timePart] = value.split('T');
  const naive = new Date(`${datePart}T${timePart}:00Z`);
  const offset = offsetMinutesAt(naive);
  return new Date(naive.getTime() - offset * 60000).toISOString();
}

function isoToInput(value) {
  if (!value) return '';
  const p = getParts(new Date(value));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

function isoToDateInput(value) {
  if (!value) return dateKeyFromDate();
  return dateKeyFromDate(new Date(value));
}

function formatDate(key, options = { month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: TIMEZONE }).format(dateFromKey(key));
}

function formatDateLong(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: TIMEZONE }).format(date);
}

function formatTime(value) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIMEZONE }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TIMEZONE }).format(new Date(value));
}

function formatHours(minutes) {
  const safe = Math.max(0, Math.round(minutes || 0));
  return `${Math.floor(safe / 60)}h ${pad(safe % 60)}m`;
}

function formatDecimalHours(minutes) { return (Math.max(0, minutes || 0) / 60).toFixed(2); }
function formatMoney(value) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0); }
function roundToQuarter(minutes) { return Math.round(Math.max(0, minutes) / 15) * 15; }

function minutesBetween(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 60000);
}

function initialState() {
  const today = dateKeyFromDate();
  const yesterday = addDaysToKey(today, -1);
  const twoDaysAgo = addDaysToKey(today, -2);
  const tomorrow = addDaysToKey(today, 1);
  return {
    currentUserId: 'casey',
    people: [
      { id: 'casey', name: 'Casey Caudle', initials: 'CC', role: 'Owner / admin', defaultRate: 28, avatar: 'indigo' },
      { id: 'jordan', name: 'Jordan Lee', initials: 'JL', role: 'Member', defaultRate: 24, avatar: 'orange' },
    ],
    removedPeople: [],
    jobs: [
      { id: 'general-work', name: 'General work', color: 'indigo', general: true, rates: { casey: 28 } },
      { id: 'client', name: 'Client work', color: 'indigo', general: false, rates: { casey: 32, jordan: 30 } },
      { id: 'studio', name: 'Studio admin', color: 'orange', general: true, rates: { casey: 28 } },
      { id: 'planning', name: 'Planning & research', color: 'green', general: true, rates: { casey: 28, jordan: 24 } },
      { id: 'personal', name: 'Personal project', color: 'purple', general: true, rates: { casey: 28 } },
    ],
    entries: [
      { id: 'demo-entry-1', personId: 'casey', jobId: 'client', mode: 'range', start: `${yesterday}T13:00:00.000Z`, end: `${yesterday}T17:15:00.000Z`, durationMinutes: null, breaks: [{ id: 'b1', start: `${yesterday}T15:00:00.000Z`, end: `${yesterday}T15:30:00.000Z`, paid: false }], note: 'Client deliverables', rateOverride: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'demo-entry-2', personId: 'casey', jobId: 'planning', mode: 'range', start: `${twoDaysAgo}T14:00:00.000Z`, end: `${twoDaysAgo}T17:10:00.000Z`, durationMinutes: null, breaks: [], note: 'Weekly planning', rateOverride: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    shifts: [
      { id: 'demo-shift-1', personId: 'casey', jobId: 'client', start: `${tomorrow}T14:00:00.000Z`, end: `${tomorrow}T18:00:00.000Z`, note: 'Review and handoff' },
      { id: 'demo-shift-2', personId: 'general', jobId: 'studio', start: `${addDaysToKey(today, 3)}T15:00:00.000Z`, end: `${addDaysToKey(today, 3)}T17:00:00.000Z`, note: 'Weekly admin block' },
    ],
    audit: [
      { id: 'audit-1', action: 'Created', detail: 'Client work · 4h 15m entry', actorId: 'casey', at: new Date(Date.now() - 1000 * 60 * 36).toISOString() },
      { id: 'audit-2', action: 'Updated', detail: 'Planning & research · rate confirmed', actorId: 'casey', at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString() },
    ],
  };
}

function loadState() {
  const saved = TempoStore.load(initialState());
  saved.removedPeople = Array.isArray(saved.removedPeople) ? saved.removedPeople : [];
  saved.payments = Array.isArray(saved.payments) ? saved.payments : [];
  return saved;
}

let state = loadState();

function saveState() { TempoStore.save(state); }

function renderSyncStatus() {
  const status = state.sync?.status || 'offline';
  const copy = {
    offline: ['Offline ready', 'Saved on this device'],
    connecting: ['Connecting…', 'Loading shared workspace'],
    connected: ['Cloud connected', 'Saved to shared workspace'],
    attention: ['Sync needs attention', 'Saved locally until reconnected'],
  }[status] || ['Offline ready', 'Saved on this device'];
  const detail = status === 'attention' && state.sync?.statusDetail ? state.sync.statusDetail : '';
  $('#sync-title').textContent = copy[0];
  $('#sync-copy').textContent = detail ? `${copy[1]} · ${detail}` : copy[1];
  $('#sync-card').title = detail || copy[1];
  $('#connection-pill-label').textContent = copy[0];
  $('.connection-pill').classList.toggle('pill-connected', status === 'connected');
  $('.connection-pill').classList.toggle('pill-attention', status === 'attention');
  $('#sync-card').classList.toggle('sync-connected', status === 'connected');
  $('#sync-card').classList.toggle('sync-attention', status === 'attention');
  $('#sync-card').classList.toggle('sync-connecting', status === 'connecting');
}

function setSyncStatus(status, detail = '') {
  state.sync = state.sync || {};
  state.sync.status = status;
  state.sync.statusDetail = detail;
  saveState();
  renderSyncStatus();
}

function commit(message) {
  saveState();
  renderAll();
  window.TempoCloud?.scheduleSync?.();
  if (message) showToast(message);
}

function personById(id) { return state.people.find((person) => person.id === id); }
function jobById(id) { return state.jobs.find((job) => job.id === id); }
function removedPersonById(id) { return (state.removedPeople || []).find((person) => person.id === id); }
function personName(id) { return personById(id)?.name || removedPersonById(id)?.name || (id === 'general' ? 'General' : 'Removed member'); }
function jobName(id) { return jobById(id)?.name || 'Unassigned'; }
function activeEntries() { return state.entries.filter((entry) => !entry.deletedAt && !entry.end); }
function canManageMembers() { return /owner|admin/i.test(personById(state.currentUserId)?.role || '') || state.currentUserId === 'casey'; }
function generalWorkJob() { return state.jobs.find((job) => !job.deletedAt && String(job.name || '').trim().toLowerCase() === 'general work'); }

function ensureGeneralWorkJob() {
  const existing = generalWorkJob();
  if (existing) return existing;
  const person = personById(state.currentUserId);
  const job = { id: generateUuid(), name: 'General work', color: 'indigo', general: true, rates: { [state.currentUserId]: Number(person?.defaultRate || 0) } };
  state.jobs.unshift(job);
  return job;
}

function entryDateKey(entry) {
  return entry.mode === 'duration' ? entry.date : dateKeyFromDate(new Date(entry.start || new Date()));
}

function breakMinutes(breakItem) {
  if (breakItem.start && breakItem.end) return minutesBetween(breakItem.start, breakItem.end);
  if (breakItem.start && !breakItem.end) return minutesBetween(breakItem.start, new Date().toISOString());
  return Number(breakItem.durationMinutes || 0);
}

function rawEntryMinutes(entry) {
  if (entry.mode === 'duration') return Number(entry.durationMinutes || 0) * 60;
  const raw = minutesBetween(entry.start, entry.end || new Date().toISOString());
  const unpaidBreaks = (entry.breaks || []).filter((item) => !item.paid).reduce((total, item) => total + breakMinutes(item), 0);
  return Math.max(0, raw - unpaidBreaks);
}

function entryMinutes(entry) { return roundToQuarter(rawEntryMinutes(entry)); }

function entryRate(entry) {
  if (entry.rateOverride !== null && entry.rateOverride !== '' && entry.rateOverride !== undefined) return Number(entry.rateOverride);
  const job = jobById(entry.jobId);
  const person = personById(entry.personId);
  return Number(job?.rates?.[entry.personId] ?? person?.defaultRate ?? 0);
}

function entryPay(entry) { return (entryMinutes(entry) / 60) * entryRate(entry); }

function weekEntries(start = mondayKey()) {
  const days = new Set(Array.from({ length: 7 }, (_, index) => addDaysToKey(start, index)));
  return state.entries.filter((entry) => !entry.deletedAt && days.has(entryDateKey(entry)));
}

function weekLabel(start = mondayKey()) {
  const end = addDaysToKey(start, 6);
  return `${formatDate(start, { month: 'short', day: 'numeric' })} – ${formatDate(end, { month: 'short', day: 'numeric' })}`;
}

function viewedWeekStart() { return weekCursor || mondayKey(); }

function showWeek(startKey) {
  weekCursor = startKey === mondayKey() ? null : startKey;
  renderWeek();
}

const roundCents = (value) => Math.round((Number(value) || 0) * 100) / 100;

function paymentFor(personId, weekStart) {
  return (state.payments || []).find((payment) => payment.personId === personId && payment.weekStart === weekStart) || null;
}

function personWeekTotals(personId, weekStart) {
  const entries = weekEntries(weekStart).filter((entry) => entry.personId === personId);
  const earned = roundCents(entries.reduce((total, entry) => total + entryPay(entry), 0));
  const paid = roundCents(paymentFor(personId, weekStart)?.amountPaid || 0);
  return { minutes: entries.reduce((total, entry) => total + entryMinutes(entry), 0), earned, paid, balance: roundCents(earned - paid) };
}

function weekPaymentTotals(weekStart) {
  const ids = new Set([...state.people.map((person) => person.id), ...weekEntries(weekStart).map((entry) => entry.personId), ...(state.payments || []).filter((payment) => payment.weekStart === weekStart).map((payment) => payment.personId)]);
  return [...ids].map((id) => personWeekTotals(id, weekStart)).reduce((sum, item) => ({ earned: roundCents(sum.earned + item.earned), paid: roundCents(sum.paid + item.paid), balance: roundCents(sum.balance + item.balance) }), { earned: 0, paid: 0, balance: 0 });
}

function paymentStatus({ earned, paid, balance }) {
  if (earned <= 0 && paid <= 0) return { tone: 'none', label: 'Nothing earned' };
  if (balance < 0) return { tone: 'over', label: `Overpaid ${formatMoney(-balance)}` };
  if (balance === 0) return { tone: 'paid', label: 'Paid in full' };
  if (paid > 0) return { tone: 'partial', label: `${formatMoney(balance)} remaining` };
  return { tone: 'due', label: `${formatMoney(balance)} unpaid` };
}

// Sums what is still owed, week by week and person by person. An overpaid week
// doesn't cancel out another week's balance.
function unpaidSummary() {
  const weeks = new Set();
  state.entries.filter((entry) => !entry.deletedAt).forEach((entry) => weeks.add(mondayKey(dateFromKey(entryDateKey(entry)))));
  (state.payments || []).forEach((payment) => weeks.add(payment.weekStart));
  const owing = [];
  let total = 0;
  [...weeks].sort().forEach((weekStart) => {
    const ids = new Set([...weekEntries(weekStart).map((entry) => entry.personId), ...(state.payments || []).filter((payment) => payment.weekStart === weekStart).map((payment) => payment.personId)]);
    const balance = roundCents([...ids].reduce((sum, id) => sum + Math.max(0, personWeekTotals(id, weekStart).balance), 0));
    if (balance > 0) { owing.push(weekStart); total += balance; }
  });
  return { total: roundCents(total), weeks: owing };
}

function renderUnpaidCard() {
  const { total, weeks } = unpaidSummary();
  $('#unpaid-total').textContent = formatMoney(total);
  $('#unpaid-detail').textContent = weeks.length ? `${weeks.length} week${weeks.length === 1 ? '' : 's'} · oldest ${formatDate(weeks[0])}` : 'All caught up';
  $('#unpaid-icon').textContent = weeks.length ? '!' : '✓';
  $('#unpaid-icon').className = `metric-icon ${weeks.length ? 'orange-icon' : 'green-icon'}`;
  $('#unpaid-card').dataset.week = weeks[0] || '';
  $('#unpaid-card').setAttribute('aria-label', weeks.length ? `Unpaid balance ${formatMoney(total)}: open the week of ${formatDate(weeks[0])}` : 'Unpaid balance: all caught up');
}

function openOldestUnpaidWeek() {
  showWeek($('#unpaid-card').dataset.week || mondayKey());
  navigate('week');
}

function setWeekPayment(personId, weekStart, amount) {
  const value = roundCents(Math.max(0, amount));
  const existing = paymentFor(personId, weekStart);
  const previous = existing?.amountPaid || 0;
  if (existing) Object.assign(existing, { amountPaid: value, updatedAt: new Date().toISOString() });
  else state.payments.push({ personId, weekStart, amountPaid: value, updatedAt: new Date().toISOString() });
  recordAudit('Updated', `${personName(personId)} · week of ${formatDate(weekStart)} paid ${formatMoney(previous)} → ${formatMoney(value)}`);
  commit(value === 0 ? 'Payment cleared' : `Recorded ${formatMoney(value)} paid`);
}

function recordAudit(action, detail) {
  const at = new Date().toISOString();
  state.audit.unshift({ id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`, action, detail, actorId: state.currentUserId, at });
  state.audit = state.audit.slice(0, 50);
  TempoStore.queueMutation(state, { operation: action.toLowerCase(), entity: 'workspace-change', detail, actorId: state.currentUserId, at });
}

function renderAll() {
  renderSyncStatus();
  renderHeader();
  renderOverview();
  renderWeek();
  renderCalendar();
  renderJobs();
  renderActivity();
  populateSelects();
}

function getTimeGreeting() {
  const hour = getParts().hour;
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function renderHeader() {
  $('#today-eyebrow').textContent = formatDateLong();
  $('#page-title').textContent = activeView === 'overview' ? 'Overview' : activeView === 'week' ? 'Week view' : activeView[0].toUpperCase() + activeView.slice(1);
  const label = weekLabel();
  $$('.soft-badge').find((item) => item.closest('.featured-card'))?.replaceChildren(document.createTextNode(label));

  const currentUser = personById(state.currentUserId) || removedPersonById(state.currentUserId);
  if (currentUser) {
    const firstName = currentUser.name.split(/\s+/)[0] || currentUser.name;
    const greetingEl = document.querySelector('.welcome-row h1');
    if (greetingEl) {
      greetingEl.innerHTML = `Good ${getTimeGreeting()}, ${escapeHtml(firstName)} <span class="wave">✦</span>`;
    }
    const profileCopy = document.querySelector('.profile-card .profile-copy');
    if (profileCopy) {
      profileCopy.innerHTML = `<strong>${escapeHtml(currentUser.name)}</strong><span>${escapeHtml(currentUser.role || 'Member')}</span>`;
    }
    const sidebarAvatar = document.querySelector('.profile-card .avatar');
    if (sidebarAvatar) {
      sidebarAvatar.textContent = currentUser.initials || 'TU';
      sidebarAvatar.className = `avatar avatar-${currentUser.avatar || 'indigo'}`;
    }
    const topbarAvatar = $('#account-button');
    if (topbarAvatar) {
      topbarAvatar.textContent = currentUser.initials || 'TU';
      topbarAvatar.className = `avatar avatar-${currentUser.avatar || 'indigo'} avatar-button`;
    }
  }
}

function renderOverview() {
  const entries = weekEntries();
  const totalMinutes = entries.reduce((total, entry) => total + entryMinutes(entry), 0);
  const totalPay = entries.reduce((total, entry) => total + entryPay(entry), 0);
  const progress = Math.min(100, (totalMinutes / (40 * 60)) * 100);
  $('#week-hours').textContent = formatHours(totalMinutes);
  $('#week-pay').textContent = formatMoney(totalPay);
  $('#active-count').textContent = activeEntries().length;
  $('#active-description').textContent = activeEntries().length ? `${activeEntries().length} clock${activeEntries().length === 1 ? '' : 's'} running` : 'Nothing running';
  $('#week-progress').style.width = `${progress}%`;
  $('#week-target-label').textContent = `${Math.round(progress)}% of 40h target`;
  renderUnpaidCard();

  renderQuickClock();
  const activeContainer = $('#active-clocks');
  const quickJob = generalWorkJob();
  const active = activeEntries().filter((entry) => !(quickJob && entry.personId === state.currentUserId && entry.jobId === quickJob.id)).sort((a, b) => new Date(a.start) - new Date(b.start));
  activeContainer.innerHTML = active.length ? `<div class="active-clock-heading">Other active clocks</div>${active.map(renderActiveClock).join('')}` : '';
  activeContainer.classList.toggle('hidden', !active.length);

  const recent = state.entries.filter((entry) => !entry.deletedAt && entry.end).sort((a, b) => new Date(b.end || b.start) - new Date(a.end || a.start)).slice(0, 4);
  $('#recent-entries').innerHTML = recent.length ? recent.map(renderRecentEntry).join('') : '<div class="empty-state"><div><strong>No entries yet</strong>Your completed time will appear here.</div></div>';

  const shifts = state.shifts.filter((shift) => !shift.deletedAt && new Date(shift.end) >= new Date()).sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 4);
  $('#upcoming-shifts').innerHTML = shifts.length ? shifts.map(renderShift).join('') : '<div class="empty-state"><div><strong>No planned shifts</strong>Add a future shift to keep the week in view.</div></div>';
}

function quickClockEntry() {
  const job = generalWorkJob();
  if (!job) return null;
  return activeEntries().filter((entry) => entry.personId === state.currentUserId && entry.jobId === job.id).sort((a, b) => new Date(a.start) - new Date(b.start))[0] || null;
}

function renderQuickClock() {
  const container = $('#quick-clock');
  const stateLabel = $('#quick-clock-state');
  const entry = quickClockEntry();
  if (!entry) {
    stateLabel.textContent = 'Ready';
    container.innerHTML = '<div class="quick-clock-row"><div><div class="quick-clock-title">Clock in for general work</div><div class="quick-clock-help">Start time is recorded immediately. You can add details later.</div></div><button type="button" class="button primary-button quick-clock-button" id="quick-clock-in">Clock in</button></div>';
    return;
  }
  stateLabel.textContent = 'Running';
  container.innerHTML = `<div class="quick-clock-row running"><div><div class="quick-clock-title">General work in progress</div><div class="quick-clock-elapsed">${formatHours(rawEntryMinutes(entry))}</div><div class="quick-clock-help">Started ${formatTime(entry.start)}</div></div><button type="button" class="button danger-button quick-clock-button" id="quick-clock-out">Clock out</button></div>`;
}

function startGeneralClock() {
  const job = ensureGeneralWorkJob();
  const personId = state.currentUserId;
  state.entries.push({ id: generateUuid(), personId, jobId: job.id, mode: 'timer', breaks: [], note: '', rateOverride: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), start: new Date().toISOString(), end: null, durationMinutes: null });
  recordAudit('Started', `General work clock for ${personName(personId)}`);
  commit('Clock started');
}

function renderActiveClock(entry) {
  const onBreak = entry.breaks?.some((item) => item.start && !item.end);
  const elapsed = formatHours(rawEntryMinutes(entry));
  return `<div class="clock-row"><span class="clock-indicator"></span><div class="clock-details"><div class="clock-title">${escapeHtml(jobName(entry.jobId))}</div><div class="clock-meta">${escapeHtml(personName(entry.personId))} · ${onBreak ? 'On unpaid break' : 'Tracking now'}</div></div><div class="clock-time"><div class="clock-elapsed">${elapsed}</div><div class="clock-start">since ${formatTime(entry.start)}</div></div><div class="clock-actions"><button class="break-button" data-break-entry="${entry.id}">${onBreak ? 'End break' : 'Start break'}</button><button class="stop-button" data-stop-entry="${entry.id}" aria-label="Stop clock">■</button></div></div>`;
}

function renderRecentEntry(entry) {
  const date = entryDateKey(entry);
  return `<button type="button" class="entry-row entry-row-button" data-edit-entry="${entry.id}" aria-label="Edit ${escapeHtml(jobName(entry.jobId))} entry"><div class="date-chip"><strong>${dateFromKey(date).getUTCDate()}</strong>${new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: TIMEZONE }).format(dateFromKey(date))}</div><div class="entry-details"><div class="entry-title">${escapeHtml(jobName(entry.jobId))}</div><div class="entry-subtitle">${escapeHtml(personName(entry.personId))} · ${entry.mode === 'duration' ? 'Duration entry' : `${formatTime(entry.start)} – ${entry.end ? formatTime(entry.end) : 'active'}`}</div></div><div><div class="entry-total">${formatHours(entryMinutes(entry))}</div><div class="entry-pay">${formatMoney(entryPay(entry))}</div></div></button>`;
}

function renderShift(shift) {
  const date = entryDateKey({ mode: 'range', start: shift.start });
  const general = shift.personId === 'general';
  return `<div class="shift-row ${general ? 'general' : ''}"><span class="shift-bar"></span><div class="shift-details"><div class="shift-title">${escapeHtml(jobName(shift.jobId))}</div><div class="shift-subtitle">${general ? 'General' : escapeHtml(personName(shift.personId))}${shift.note ? ` · ${escapeHtml(shift.note)}` : ''}</div></div><div><div class="shift-date ${general ? 'general' : ''}">${formatDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}</div><div class="shift-time">${formatTime(shift.start)} – ${formatTime(shift.end)}</div></div><div class="row-actions"><button data-edit-shift="${shift.id}" aria-label="Edit planned shift">✎</button><button data-delete-shift="${shift.id}" aria-label="Delete planned shift">×</button></div></div>`;
}

function renderWeek() {
  const start = viewedWeekStart();
  const entries = weekEntries(start);
  const totalMinutes = entries.reduce((total, entry) => total + entryMinutes(entry), 0);
  const totalPay = entries.reduce((total, entry) => total + entryPay(entry), 0);
  const progress = Math.min(100, (totalMinutes / (40 * 60)) * 100);
  $('#week-view-hours').textContent = formatHours(totalMinutes);
  $('#week-view-pay').textContent = formatMoney(totalPay);
  $('#week-view-count').textContent = entries.length;
  $('#week-view-progress').style.width = `${progress}%`;
  const end = addDaysToKey(start, 6);
  const isCurrent = start === mondayKey();
  $('#week-view-eyebrow').textContent = `${formatDate(start, { weekday: 'long', month: 'long', day: 'numeric' })} – ${formatDate(end, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;
  $('#week-view-label').textContent = isCurrent ? `This week · ${weekLabel(start)}` : weekLabel(start);
  if (document.activeElement !== $('#week-view-picker')) $('#week-view-picker').value = start;
  // renderWeek runs every second while a clock is live; don't redraw under someone typing an amount.
  if (!document.activeElement?.matches?.('#week-payments [data-payment-person]')) renderWeekPayments(start);
  $('#week-this-button').disabled = isCurrent;
  $('#week-table').innerHTML = Array.from({ length: 7 }, (_, index) => {
    const day = addDaysToKey(start, index);
    const dayEntries = entries.filter((entry) => entryDateKey(entry) === day).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    const dayTotal = dayEntries.reduce((total, entry) => total + entryMinutes(entry), 0);
    return `<div class="day-group"><div class="day-header"><strong>${formatDate(day, { weekday: 'long', month: 'short', day: 'numeric' })}</strong><span>${dayTotal ? formatHours(dayTotal) : 'No time logged'}</span></div>${dayEntries.length ? dayEntries.map(renderTableEntry).join('') : '<div class="empty-day">No entries</div>'}</div>`;
  }).join('');
}

function renderWeekPayments(start) {
  const people = [...state.people];
  weekEntries(start).forEach((entry) => { if (!people.some((person) => person.id === entry.personId)) people.push({ id: entry.personId, name: personName(entry.personId), initials: '?', avatar: 'indigo' }); });
  const rows = people.map((person) => {
    const totals = personWeekTotals(person.id, start);
    const status = paymentStatus(totals);
    return `<div class="payment-row"><div class="avatar avatar-${person.avatar || 'indigo'}">${escapeHtml(person.initials || '?')}</div><div class="payment-person"><strong>${escapeHtml(person.name)}</strong><span>${formatDecimalHours(totals.minutes)}h · earned ${formatMoney(totals.earned)}</span></div><label class="field payment-input"><span>Paid</span><div class="input-prefix"><span>$</span><input type="number" min="0" step="0.01" inputmode="decimal" data-payment-person="${person.id}" value="${totals.paid ? totals.paid.toFixed(2) : ''}" placeholder="0.00" aria-label="Amount paid to ${escapeHtml(person.name)} for this week" /></div></label><button type="button" class="button secondary-button payment-full-button" data-pay-full="${person.id}" ${totals.earned <= 0 || totals.balance === 0 ? 'disabled' : ''}>Mark paid in full</button><div class="payment-balance ${status.tone}"><span>Balance</span><strong>${formatMoney(Math.max(0, totals.balance))}</strong><em>${escapeHtml(status.label)}</em></div></div>`;
  }).join('');
  const totals = weekPaymentTotals(start);
  const status = paymentStatus(totals);
  $('#week-payment-badge').textContent = status.label;
  $('#week-payment-badge').className = `soft-badge payment-badge ${status.tone}`;
  const footer = people.length > 1 ? `<div class="payment-totals"><span>Week total</span><span>Earned <strong>${formatMoney(totals.earned)}</strong></span><span>Paid <strong>${formatMoney(totals.paid)}</strong></span><span>Balance <strong>${formatMoney(Math.max(0, totals.balance))}</strong></span></div>` : '';
  $('#week-payments').innerHTML = rows + footer;
}

function renderTableEntry(entry) {
  const range = entry.mode === 'duration' ? 'Duration entry' : `${formatTime(entry.start)} – ${entry.end ? formatTime(entry.end) : 'Active'}`;
  const breakAction = entry.mode === 'duration' ? '' : `<button data-add-break-entry="${entry.id}">Break</button>`;
  return `<div class="table-entry"><span class="job-dot" style="background:${colorForJob(entry.jobId)}"></span><div><div class="entry-title">${escapeHtml(jobName(entry.jobId))}</div><div class="entry-subtitle">${escapeHtml(personName(entry.personId))}${entry.note ? ` · ${escapeHtml(entry.note)}` : ''}</div></div><div class="table-time">${range}</div><div class="table-hours">${formatHours(entryMinutes(entry))}</div><div class="table-pay-cell"><div class="table-pay">${formatMoney(entryPay(entry))}</div><div class="table-actions">${breakAction}<button data-edit-entry="${entry.id}">Edit</button><button data-delete-entry="${entry.id}">Delete</button></div></div></div>`;
}

function colorForJob(jobId) {
  const color = jobById(jobId)?.color || 'indigo';
  return { indigo: '#5046e5', orange: '#e68a3b', green: '#12926b', purple: '#8958db' }[color] || '#5046e5';
}

function renderCalendar() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  $('#calendar-month-label').textContent = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(calendarCursor);
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const prevDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let html = weekdays.map((day) => `<div class="calendar-weekday">${day}</div>`).join('') + '<div class="calendar-weekday calendar-week-heading">Week</div>';
  const mondayOffset = firstDay === 0 ? 6 : firstDay - 1;
  for (let index = 0; index < 42; index += 1) {
    const offset = index - mondayOffset + 1;
    let cellYear = year;
    let cellMonth = month + 1;
    let dayNumber = offset;
    let muted = false;
    if (offset <= 0) { const previous = new Date(Date.UTC(year, month, offset)); cellYear = previous.getUTCFullYear(); cellMonth = previous.getUTCMonth() + 1; dayNumber = previous.getUTCDate(); muted = true; }
    if (offset > daysInMonth) { const next = new Date(Date.UTC(year, month, offset)); cellYear = next.getUTCFullYear(); cellMonth = next.getUTCMonth() + 1; dayNumber = next.getUTCDate(); muted = true; }
    const key = keyFromParts(cellYear, cellMonth, dayNumber);
    const isToday = key === dateKeyFromDate();
    const entries = state.entries.filter((entry) => !entry.deletedAt && entryDateKey(entry) === key).slice(0, 3);
    const shifts = state.shifts.filter((shift) => !shift.deletedAt && entryDateKey({ mode: 'range', start: shift.start }) === key).slice(0, 2);
    const events = [...entries.map((entry) => `<button type="button" class="calendar-event" data-calendar-entry="${entry.id}" aria-label="Open ${escapeHtml(jobName(entry.jobId))} entry"><i class="calendar-event-dot"></i><span>${escapeHtml(jobName(entry.jobId))} · ${formatHours(entryMinutes(entry))}</span></button>`), ...shifts.map((shift) => `<button type="button" class="calendar-event planned" data-calendar-shift="${shift.id}" aria-label="Open planned ${escapeHtml(jobName(shift.jobId))} shift"><i class="calendar-event-dot"></i><span>${escapeHtml(jobName(shift.jobId))} · planned</span></button>`)].join('');
    html += `<div class="calendar-cell ${muted ? 'muted-day' : ''} ${isToday ? 'today' : ''}" data-calendar-date="${key}"><button type="button" class="calendar-date" data-calendar-day="${key}" aria-label="Add time for ${formatDate(key, { month: 'long', day: 'numeric', year: 'numeric' })}">${dayNumber}</button>${events}</div>`;
    if (index % 7 === 6) html += renderCalendarWeekTotal(addDaysToKey(key, -6));
  }
  $('#calendar-grid').innerHTML = html;
}

function renderCalendarWeekTotal(startKey) {
  const entries = weekEntries(startKey);
  const minutes = entries.reduce((total, entry) => total + entryMinutes(entry), 0);
  const pay = entries.reduce((total, entry) => total + entryPay(entry), 0);
  const current = startKey === mondayKey();
  const status = paymentStatus(weekPaymentTotals(startKey));
  const statusLine = status.tone === 'paid' ? '<em class="week-pay-status paid">✓ Paid</em>' : status.tone === 'partial' ? `<em class="week-pay-status partial">${escapeHtml(status.label.replace(' remaining', ' due'))}</em>` : status.tone === 'over' ? `<em class="week-pay-status over">${escapeHtml(status.label)}</em>` : '';
  return `<button type="button" class="calendar-week-total ${minutes ? '' : 'empty'} ${current ? 'current' : ''}" data-calendar-week="${startKey}" aria-label="Open week of ${formatDate(startKey, { month: 'long', day: 'numeric' })}: ${formatDecimalHours(minutes)} hours, ${formatMoney(pay)}${status.tone === 'none' ? '' : `, ${status.label}`}"><strong>${formatDecimalHours(minutes)}h</strong><span>${formatMoney(pay)}</span>${statusLine}</button>`;
}

function jobRateCount(job) { return Object.values(job.rates || {}).filter((rate) => rate !== null && rate !== undefined && rate !== '').length; }

function renderJobs() {
  const invites = state.invites || [];
  $('#member-count').textContent = `${state.people.length} member${state.people.length === 1 ? '' : 's'}`;
  $('#invite-member-button').classList.toggle('hidden', !canManageMembers());
  const peopleRows = state.people.map((person) => `<div class="person-row"><div class="avatar avatar-${person.avatar}">${person.initials}</div><div class="person-info"><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(person.role)}</span></div><div class="person-rate-control"><div class="person-rate">${formatMoney(person.defaultRate)}/h</div><div class="person-row-actions">${canManageMembers() ? `<button class="text-button" data-edit-person-rate="${person.id}">Edit</button>` : ''}${canManageMembers() && person.id !== state.currentUserId ? `<button class="text-button danger-text" data-remove-person="${person.id}">Remove</button>` : ''}</div></div></div>`).join('');
  const inviteRows = invites.map((invite) => `<div class="person-row invite-row"><div class="avatar avatar-pending">✉</div><div class="person-info"><strong>${escapeHtml(invite.email)}</strong><span>Invited · waiting for them to sign in</span></div><div class="person-rate-control"><div class="person-rate">${formatMoney(invite.defaultRate)}/h</div><div class="person-row-actions"><button class="text-button danger-text" data-cancel-invite="${invite.id}">Cancel</button></div></div></div>`).join('');
  $('#people-list').innerHTML = peopleRows + inviteRows;
  $('#jobs-list').innerHTML = state.jobs.filter((job) => !job.deletedAt).map((job) => {
    const count = jobRateCount(job);
    return `<div class="job-row"><span class="job-color ${job.color}"></span><button type="button" class="job-info job-edit-area" data-edit-job="${job.id}" aria-label="Edit ${escapeHtml(job.name)}"><strong>${escapeHtml(job.name)}</strong><span>${job.general ? 'General job' : 'Assigned job'} · ${count ? `${count} custom rate${count === 1 ? '' : 's'}` : 'default rates'}</span></button><div class="job-rate">${formatMoney(job.rates?.[state.currentUserId] ?? personById(state.currentUserId)?.defaultRate ?? 0)}/h</div><button type="button" class="text-button" data-edit-job="${job.id}">Edit</button></div>`;
  }).join('');
}

function openJobModal(jobId = null) {
  const job = jobId ? state.jobs.find((item) => item.id === jobId && !item.deletedAt) : null;
  if (jobId && !job) return;
  $('#job-form').reset();
  $('#job-modal-id').value = job?.id || '';
  $('#job-modal-title').textContent = job ? 'Edit job' : 'Add job';
  $('#job-modal-submit').textContent = job ? 'Save changes' : 'Add job';
  $('#job-modal-name').value = job?.name || '';
  $('#job-modal-color').value = job?.color || 'indigo';
  $('#job-modal-general').checked = job ? Boolean(job.general) : true;
  $('#job-modal-delete').classList.toggle('hidden', !job);
  $('#job-modal-rates').innerHTML = state.people.map((person) => {
    const rate = job?.rates?.[person.id];
    const value = rate === null || rate === undefined || rate === '' ? '' : Number(rate).toFixed(2);
    return `<label class="field job-rate-field"><span>${escapeHtml(person.name)}</span><div class="input-prefix"><span>$</span><input type="number" min="0" step="0.01" data-job-rate-person="${person.id}" value="${value}" placeholder="${Number(person.defaultRate || 0).toFixed(2)} default" /></div></label>`;
  }).join('');
  openModal('job-modal');
  setTimeout(() => $('#job-modal-name').focus(), 50);
}

function handleJobSubmit(event) {
  event.preventDefault();
  const name = $('#job-modal-name').value.trim();
  if (!name) { showToast('Give the job a name'); return; }
  const rates = {};
  for (const input of $$('[data-job-rate-person]')) {
    const raw = input.value.trim();
    if (raw === '') { rates[input.dataset.jobRatePerson] = null; continue; }
    const rate = Number(raw);
    if (!Number.isFinite(rate) || rate < 0) { showToast('Rates must be zero or more'); input.focus(); return; }
    rates[input.dataset.jobRatePerson] = Math.round(rate * 100) / 100;
  }
  const jobId = $('#job-modal-id').value;
  const fields = { name, color: $('#job-modal-color').value, general: $('#job-modal-general').checked };
  if (jobId) {
    const job = state.jobs.find((item) => item.id === jobId && !item.deletedAt);
    if (!job) return;
    Object.assign(job, fields, { rates: { ...(job.rates || {}), ...rates }, updatedAt: new Date().toISOString() });
    recordAudit('Updated', `${name} job and rates`);
    closeModal('job-modal'); commit('Job updated'); return;
  }
  state.jobs.push({ id: generateUuid(), ...fields, rates, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  recordAudit('Created', `${name} job`);
  closeModal('job-modal'); commit('Job added');
}

function openInviteModal() {
  if (!canManageMembers()) { showToast('Only the workspace owner can invite people'); return; }
  if (!window.TempoCloud?.isConnected?.()) { showToast('Connect to the cloud workspace before inviting someone'); return; }
  $('#invite-form').reset();
  $('#invite-rate').value = Number(personById(state.currentUserId)?.defaultRate || 0).toFixed(2);
  $('#invite-message').textContent = '';
  openModal('invite-modal');
  setTimeout(() => $('#invite-email').focus(), 50);
}

async function handleInviteSubmit(event) {
  event.preventDefault();
  const email = $('#invite-email').value.trim();
  const rate = Number($('#invite-rate').value || 0);
  if (!Number.isFinite(rate) || rate < 0) { showToast('Enter a valid hourly rate'); return; }
  const submit = $('#invite-submit');
  submit.disabled = true;
  $('#invite-message').textContent = 'Sending invite…';
  try {
    const result = await window.TempoCloud.inviteMember(email, rate);
    closeModal('invite-modal');
    showToast(result.emailSent ? `Invite emailed to ${email}` : `Invite saved. Ask ${email} to create an account with that email.`);
    if (!result.emailSent) console.warn('[Tempo] Invite email was not sent', result.emailError);
  } catch (error) {
    $('#invite-message').textContent = error?.message || 'The invite could not be sent.';
  } finally {
    submit.disabled = false;
  }
}

async function cancelInvite(inviteId) {
  const invite = (state.invites || []).find((item) => item.id === inviteId);
  if (!invite || !window.confirm(`Cancel the invite for ${invite.email}?`)) return;
  try {
    await window.TempoCloud.cancelInvite(inviteId);
    showToast('Invite cancelled');
  } catch (error) {
    showToast(error?.message || 'The invite could not be cancelled');
  }
}

function renderActivity() {
  $('#activity-list').innerHTML = state.audit.length ? state.audit.slice(0, 20).map((item) => `<div class="activity-row"><div class="activity-action">${escapeHtml(item.action)}<span>${escapeHtml(item.detail)}</span></div><div class="activity-person"><div class="avatar avatar-${personById(item.actorId)?.avatar || 'indigo'}">${personById(item.actorId)?.initials || '??'}</div>${escapeHtml(personName(item.actorId))}</div><div class="activity-time">${formatDateTime(item.at)}</div></div>`).join('') : '<div class="empty-state"><div><strong>No activity yet</strong>Changes will be recorded here.</div></div>';
}

function populateSelects() {
  const jobOptions = state.jobs.filter((job) => !job.deletedAt).map((job) => `<option value="${job.id}">${escapeHtml(job.name)}${job.general ? ' · General' : ''}</option>`).join('');
  const personOptions = state.people.map((person) => `<option value="${person.id}">${escapeHtml(person.name)}</option>`).join('');
  $('#entry-job').innerHTML = jobOptions; $('#shift-job').innerHTML = jobOptions;
  $('#entry-person').innerHTML = personOptions; $('#shift-person').innerHTML = `<option value="general">General</option>${personOptions}`;
  $('#entry-person').value = state.currentUserId; $('#shift-person').value = state.currentUserId;
}

function setEntryMode(mode) {
  $('#entry-mode').value = mode;
  $$('.entry-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.entryMode === mode));
  $$('[data-mode-fields]').forEach((field) => field.classList.toggle('hidden', field.dataset.modeFields !== mode));
  $('#entry-submit').textContent = mode === 'timer' ? 'Start clock' : 'Save entry';
}

function openEntryModal(mode = 'timer', entryId = null) {
  $('#entry-form').reset();
  const nowInput = isoToInput(new Date().toISOString());
  $('#entry-start').value = nowInput;
  $('#entry-end').value = nowInput;
  $('#entry-date').value = dateKeyFromDate();
  $('#entry-job').value = state.jobs[0]?.id || '';
  $('#entry-person').value = state.currentUserId;
  $('#entry-id').value = '';
  $('#entry-delete-button').classList.add('hidden');
  $('#entry-modal-title').textContent = 'Add time';
  setEntryMode(mode);
  if (entryId) {
    const entry = state.entries.find((item) => item.id === entryId && !item.deletedAt);
    if (!entry) return;
    const editMode = entry.mode === 'duration' ? 'duration' : 'range';
    $('#entry-id').value = entry.id;
    $('#entry-modal-title').textContent = 'Edit time';
    $('#entry-job').value = entry.jobId;
    $('#entry-person').value = entry.personId;
    $('#entry-rate').value = entry.rateOverride ?? '';
    $('#entry-note').value = entry.note || '';
    setEntryMode(editMode);
    if (editMode === 'duration') {
      $('#entry-date').value = entry.date || entryDateKey(entry);
      $('#entry-duration').value = Number(entry.durationMinutes || 0);
    } else {
      $('#entry-start').value = isoToInput(entry.start);
      $('#entry-end').value = isoToInput(entry.end);
      const dateValue = isoToDateInput(entry.start);
      $('#entry-date').value = dateValue;
    }
    $('#entry-submit').textContent = 'Save changes';
    $('#entry-delete-button').classList.remove('hidden');
  }
  openModal('entry-modal');
}

function openEntryModalForDate(dateKey) {
  openEntryModal('range');
  $('#entry-start').value = `${dateKey}T09:00`;
  $('#entry-end').value = `${dateKey}T13:00`;
}

function openShiftModal(shiftId = null) {
  $('#shift-form').reset();
  $('#shift-id').value = '';
  $('#shift-delete-button').classList.add('hidden');
  $('#shift-modal-title').textContent = 'Add planned shift';
  $('#shift-submit').textContent = 'Add shift';
  const tomorrow = addDaysToKey(dateKeyFromDate(), 1);
  $('#shift-start').value = `${tomorrow}T09:00`;
  $('#shift-end').value = `${tomorrow}T13:00`;
  $('#shift-job').value = state.jobs[0]?.id || '';
  $('#shift-person').value = state.currentUserId;
  if (shiftId) {
    const shift = state.shifts.find((item) => item.id === shiftId);
    if (!shift) return;
    $('#shift-id').value = shift.id;
    $('#shift-modal-title').textContent = 'Edit planned shift';
    $('#shift-submit').textContent = 'Save changes';
    $('#shift-job').value = shift.jobId;
    $('#shift-person').value = shift.personId;
    $('#shift-start').value = isoToInput(shift.start);
    $('#shift-end').value = isoToInput(shift.end);
    $('#shift-note').value = shift.note || '';
    $('#shift-delete-button').classList.remove('hidden');
  }
  openModal('shift-modal');
}

function openAccountModal() {
  const person = personById(state.currentUserId) || removedPersonById(state.currentUserId);
  if (person) {
    $('#account-modal-name').textContent = person.name;
    $('#account-modal-role').textContent = person.role || 'Member';
    $('#account-modal-rate').textContent = `${formatMoney(person.defaultRate)}/hour`;
    $('#account-modal-avatar').textContent = person.initials || 'TU';
    $('#account-modal-avatar').className = `avatar avatar-${person.avatar || 'indigo'}`;
  }
  openModal('account-modal');
}

function removePerson(personId) {
  if (!canManageMembers()) { showToast('Only the workspace owner can remove members'); return; }
  const person = personById(personId);
  if (!person || person.id === state.currentUserId) return;
  if (!window.confirm(`Remove ${person.name} from this workspace? Their existing hours will remain in the activity history, but they will no longer be able to sign in to this workspace.`)) return;
  state.people = state.people.filter((item) => item.id !== personId);
  state.removedPeople = state.removedPeople || [];
  state.removedPeople = [...state.removedPeople.filter((item) => item.id !== personId), { ...person, removedAt: new Date().toISOString(), membershipRemoved: true }];
  recordAudit('Deleted', `${person.name} removed from the workspace`);
  commit(`${person.name} removed from the workspace`);
}

function openPersonRateModal(personId) {
  const person = personById(personId);
  if (!person) return;
  $('#person-rate-id').value = person.id;
  $('#person-rate-name').textContent = person.name;
  $('#person-rate-value').value = Number(person.defaultRate || 0).toFixed(2);
  openModal('person-rate-modal');
}

function handlePersonRateSubmit(event) {
  event.preventDefault();
  const person = personById($('#person-rate-id').value);
  const rate = Number($('#person-rate-value').value);
  if (!person || !Number.isFinite(rate) || rate < 0) { showToast('Enter a valid non-negative hourly rate'); return; }
  const previousRate = Number(person.defaultRate || 0);
  person.defaultRate = Math.round(rate * 100) / 100;
  person.updatedAt = new Date().toISOString();
  recordAudit('Updated', `${person.name} default rate ${formatMoney(previousRate)} → ${formatMoney(person.defaultRate)}/h`);
  closeModal('person-rate-modal');
  commit(`${person.name}'s default rate updated`);
}

function openModal(id) { const modal = document.getElementById(id); modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); }
function closeModal(id) { const modal = document.getElementById(id); modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }

function openBreakModal(entryId) {
  const entry = state.entries.find((item) => item.id === entryId && !item.deletedAt && item.mode !== 'duration');
  if (!entry) return;
  $('#break-entry-id').value = entry.id;
  $('#break-date').value = isoToDateInput(entry.start);
  $('#break-start').value = entry.end ? isoToInput(entry.end).split('T')[1] : isoToInput(entry.start).split('T')[1];
  $('#break-end').value = entry.end ? isoToInput(entry.end).split('T')[1] : '';
  $('#break-paid').checked = false;
  $('#break-modal-title').textContent = `Add break · ${jobName(entry.jobId)}`;
  openModal('break-modal');
}

function handleBreakSubmit(event) {
  event.preventDefault();
  const entry = state.entries.find((item) => item.id === $('#break-entry-id').value && !item.deletedAt);
  const date = $('#break-date').value;
  const start = $('#break-start').value;
  const end = $('#break-end').value;
  if (!entry || entry.mode === 'duration' || !date || !start || !end) { showToast('Add a break date, start, and end'); return; }
  const startISO = zonedInputToISO(`${date}T${start}`);
  let endISO = zonedInputToISO(`${date}T${end}`);
  if (new Date(endISO) < new Date(startISO)) endISO = zonedInputToISO(`${addDaysToKey(date, 1)}T${end}`);
  if (!startISO || !endISO || new Date(endISO) <= new Date(startISO)) { showToast('Break end must be after break start'); return; }
  entry.breaks = entry.breaks || [];
  entry.breaks.push({ id: generateUuid(), start: startISO, end: endISO, paid: $('#break-paid').checked });
  entry.updatedAt = new Date().toISOString();
  recordAudit('Updated', `${jobName(entry.jobId)} ${$('#break-paid').checked ? 'paid' : 'unpaid'} break added`);
  closeModal('break-modal');
  commit('Break added');
}

function handleEntrySubmit(event) {
  event.preventDefault();
  const mode = $('#entry-mode').value;
  const editId = $('#entry-id').value;
  const personId = $('#entry-person').value;
  const jobId = $('#entry-job').value;
  const rateValue = $('#entry-rate').value.trim();
  const base = { id: generateUuid(), personId, jobId, mode, breaks: [], note: $('#entry-note').value.trim(), rateOverride: rateValue === '' ? null : Number(rateValue), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (editId) {
    const existing = state.entries.find((item) => item.id === editId && !item.deletedAt);
    if (!existing) return;
    if (mode === 'duration') {
      const date = $('#entry-date').value;
      const duration = Number($('#entry-duration').value);
      if (!date || !duration || duration <= 0) { showToast('Add a date and duration first'); return; }
      Object.assign(existing, { personId, jobId, mode, date, start: null, end: new Date(`${date}T12:00:00Z`).toISOString(), durationMinutes: duration, note: base.note, rateOverride: base.rateOverride, updatedAt: new Date().toISOString() });
    } else {
      const start = zonedInputToISO($('#entry-start').value);
      const end = zonedInputToISO($('#entry-end').value);
      if (!start || !end || new Date(end) <= new Date(start)) { showToast('End time must be after start time'); return; }
      Object.assign(existing, { personId, jobId, mode: 'range', start, end, durationMinutes: null, note: base.note, rateOverride: base.rateOverride, updatedAt: new Date().toISOString() });
    }
    recordAudit('Updated', `${jobName(existing.jobId)} · ${formatHours(entryMinutes(existing))} entry`);
    closeModal('entry-modal'); commit('Time entry updated'); return;
  }
  if (mode === 'timer') {
    state.entries.push({ ...base, start: new Date().toISOString(), end: null, durationMinutes: null });
    recordAudit('Started', `${jobName(jobId)} clock for ${personName(personId)}`);
    closeModal('entry-modal'); commit('Clock started'); return;
  }
  if (mode === 'range') {
    const start = zonedInputToISO($('#entry-start').value);
    const end = zonedInputToISO($('#entry-end').value);
    if (!start || !end || new Date(end) <= new Date(start)) { showToast('End time must be after start time'); return; }
    state.entries.push({ ...base, start, end, durationMinutes: null });
  } else {
    const date = $('#entry-date').value;
    const duration = Number($('#entry-duration').value);
    if (!date || !duration || duration <= 0) { showToast('Add a date and duration first'); return; }
    state.entries.push({ ...base, date, start: null, end: new Date(`${date}T12:00:00Z`).toISOString(), durationMinutes: duration });
  }
  const newEntry = state.entries[state.entries.length - 1];
  recordAudit('Created', `${jobName(newEntry.jobId)} · ${formatHours(entryMinutes(newEntry))} entry`);
  closeModal('entry-modal'); commit('Time entry saved');
}

function toggleBreak(entryId) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) return;
  const openBreak = entry.breaks?.find((item) => item.start && !item.end);
  if (openBreak) { openBreak.end = new Date().toISOString(); entry.breakStart = null; recordAudit('Updated', `${jobName(entry.jobId)} break ended`); commit('Clock resumed'); }
  else { entry.breaks = entry.breaks || []; entry.breaks.push({ id: generateUuid(), start: new Date().toISOString(), end: null, paid: false }); entry.breakStart = new Date().toISOString(); recordAudit('Updated', `${jobName(entry.jobId)} unpaid break started`); commit('Break started'); }
}

function stopClock(entryId) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) return;
  const openBreak = entry.breaks?.find((item) => item.start && !item.end);
  if (openBreak) openBreak.end = new Date().toISOString();
  entry.end = new Date().toISOString(); entry.updatedAt = new Date().toISOString();
  recordAudit('Stopped', `${jobName(entry.jobId)} · ${formatHours(entryMinutes(entry))} rounded`);
  commit(`Clock stopped · ${formatHours(entryMinutes(entry))}`);
}

function handleShiftSubmit(event) {
  event.preventDefault();
  const start = zonedInputToISO($('#shift-start').value); const end = zonedInputToISO($('#shift-end').value);
  if (!start || !end || new Date(end) <= new Date(start)) { showToast('Shift end must be after start time'); return; }
  const shiftId = $('#shift-id').value;
  const shiftData = { personId: $('#shift-person').value, jobId: $('#shift-job').value, start, end, note: $('#shift-note').value.trim() };
  if (shiftId) {
    const shift = state.shifts.find((item) => item.id === shiftId);
    if (!shift) return;
    Object.assign(shift, shiftData);
    recordAudit('Updated', `${jobName(shift.jobId)} planned shift · ${formatDateTime(start)}`);
    closeModal('shift-modal'); commit('Planned shift updated'); return;
  }
  state.shifts.push({ id: generateUuid(), ...shiftData, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  recordAudit('Planned', `${jobName(shiftData.jobId)} shift · ${formatDateTime(start)}`);
  closeModal('shift-modal'); commit('Planned shift added');
}

function deleteEntry(entryId) {
  const entry = state.entries.find((item) => item.id === entryId && !item.deletedAt);
  if (!entry) return;
  if (!window.confirm(`Delete the ${jobName(entry.jobId)} entry for ${formatHours(entryMinutes(entry))}?`)) return;
  entry.deletedAt = new Date().toISOString();
  entry.updatedAt = new Date().toISOString();
  recordAudit('Deleted', `${jobName(entry.jobId)} · ${formatHours(entryMinutes(entry))} entry`);
  closeModal('entry-modal');
  commit('Time entry deleted');
}

function deleteShift(shiftId) {
  const shift = state.shifts.find((item) => item.id === shiftId && !item.deletedAt);
  if (!shift) return;
  if (!window.confirm(`Delete the planned ${jobName(shift.jobId)} shift?`)) return;
  shift.deletedAt = new Date().toISOString();
  shift.updatedAt = new Date().toISOString();
  recordAudit('Deleted', `${jobName(shift.jobId)} planned shift`);
  closeModal('shift-modal');
  commit('Planned shift deleted');
}

function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2600); }

function navigate(view) {
  activeView = view;
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  $$('.view-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `view-${view}`));
  $('#sidebar').classList.remove('open');
  renderHeader();
}

function deleteJob(jobId) {
  const job = state.jobs.find((item) => item.id === jobId && !item.deletedAt);
  if (!job) return;
  if (!window.confirm(`Delete the ${job.name} job? Existing time entries will remain in your history.`)) return;
  job.deletedAt = new Date().toISOString();
  job.updatedAt = new Date().toISOString();
  recordAudit('Deleted', `${job.name} job label`);
  closeModal('job-modal');
  commit('Job deleted');
}

function exportCSV() {
  const rows = [['Date', 'Person', 'Job', 'Hours', 'Rounded minutes', 'Rate', 'Gross pay', 'Notes']];
  state.entries.filter((entry) => !entry.deletedAt && entry.end).forEach((entry) => rows.push([entryDateKey(entry), personName(entry.personId), jobName(entry.jobId), formatDecimalHours(entryMinutes(entry)), entryMinutes(entry), entryRate(entry).toFixed(2), entryPay(entry).toFixed(2), entry.note || '']));
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = `tempo-time-entries-${dateKeyFromDate()}.csv`; link.click(); URL.revokeObjectURL(link.href); showToast('CSV export ready');
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character])); }

function bindEvents() {
  $$('.nav-item').forEach((item) => item.addEventListener('click', () => navigate(item.dataset.view)));
  $$('[data-view-link]').forEach((item) => item.addEventListener('click', () => navigate(item.dataset.viewLink)));
  $('#add-entry-button').addEventListener('click', () => openEntryModal('timer'));
  $('#quick-clock').addEventListener('click', (event) => { if (event.target.closest('#quick-clock-in')) startGeneralClock(); if (event.target.closest('#quick-clock-out')) { const entry = quickClockEntry(); if (entry) stopClock(entry.id); } });
  $('#week-add-button').addEventListener('click', () => openEntryModal('range'));
  $('#add-shift-button').addEventListener('click', openShiftModal);
  $('#add-job-button').addEventListener('click', () => openJobModal());
  $('#job-form').addEventListener('submit', handleJobSubmit);
  $('#job-modal-delete').addEventListener('click', () => { const id = $('#job-modal-id').value; if (id) deleteJob(id); });
  $('#invite-member-button').addEventListener('click', openInviteModal);
  $('#invite-form').addEventListener('submit', handleInviteSubmit);
  $('#sync-card').addEventListener('click', () => { if (state.sync?.status === 'attention') window.TempoCloud?.refresh?.(); });
  $('#recent-entries').addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-entry]'); if (edit) openEntryModal('range', edit.dataset.editEntry); });
  $('#unpaid-card').addEventListener('click', openOldestUnpaidWeek);
  $('#unpaid-card').addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openOldestUnpaidWeek(); } });
  $('#week-payments').addEventListener('change', (event) => {
    const input = event.target.closest('[data-payment-person]');
    if (!input) return;
    const amount = input.value.trim() === '' ? 0 : Number(input.value);
    if (!Number.isFinite(amount) || amount < 0) { showToast('Enter a paid amount of zero or more'); input.value = ''; return; }
    input.blur();
    setWeekPayment(input.dataset.paymentPerson, viewedWeekStart(), amount);
  });
  $('#week-payments').addEventListener('keydown', (event) => { if (event.key === 'Enter' && event.target.matches('[data-payment-person]')) event.target.blur(); });
  $('#week-payments').addEventListener('click', (event) => {
    const button = event.target.closest('[data-pay-full]');
    if (button) setWeekPayment(button.dataset.payFull, viewedWeekStart(), personWeekTotals(button.dataset.payFull, viewedWeekStart()).earned);
  });
  $('#week-prev').addEventListener('click', () => showWeek(addDaysToKey(viewedWeekStart(), -7)));
  $('#week-next').addEventListener('click', () => showWeek(addDaysToKey(viewedWeekStart(), 7)));
  $('#week-this-button').addEventListener('click', () => showWeek(mondayKey()));
  $('#week-view-picker').addEventListener('change', (event) => { if (event.target.value) showWeek(mondayKey(dateFromKey(event.target.value))); });
  $('#export-button').addEventListener('click', exportCSV);
  $('#mobile-menu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#account-button').addEventListener('click', openAccountModal);
  $('#profile-menu-button').addEventListener('click', openAccountModal);
  $('#account-jobs-button').addEventListener('click', () => { closeModal('account-modal'); navigate('jobs'); });
  $('#account-signout').addEventListener('click', async () => { closeModal('account-modal'); window.TempoCloud?.reset?.(); await window.TempoAuth?.signOut?.(); });
  $$('.close-modal').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.close)));
  $$('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModal(backdrop.id); }));
  $$('.entry-tab').forEach((tab) => tab.addEventListener('click', () => setEntryMode(tab.dataset.entryMode)));
  $('#entry-form').addEventListener('submit', handleEntrySubmit);
  $('#entry-delete-button').addEventListener('click', () => { const id = $('#entry-id').value; if (id) deleteEntry(id); });
  $('#shift-form').addEventListener('submit', handleShiftSubmit);
  $('#shift-delete-button').addEventListener('click', () => { const id = $('#shift-id').value; if (id) deleteShift(id); });
  $('#person-rate-form').addEventListener('submit', handlePersonRateSubmit);
  $('#people-list').addEventListener('click', (event) => { const button = event.target.closest('[data-edit-person-rate]'); const remove = event.target.closest('[data-remove-person]'); const cancel = event.target.closest('[data-cancel-invite]'); if (button) openPersonRateModal(button.dataset.editPersonRate); if (remove) removePerson(remove.dataset.removePerson); if (cancel) cancelInvite(cancel.dataset.cancelInvite); });
  $('#jobs-list').addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-job]'); if (edit) openJobModal(edit.dataset.editJob); });
  $('#break-form').addEventListener('submit', handleBreakSubmit);
  $('#active-clocks').addEventListener('click', (event) => { const stop = event.target.closest('[data-stop-entry]'); const toggle = event.target.closest('[data-break-entry]'); if (stop) stopClock(stop.dataset.stopEntry); if (toggle) toggleBreak(toggle.dataset.breakEntry); });
  $('#week-table').addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-entry]'); const remove = event.target.closest('[data-delete-entry]'); const addBreak = event.target.closest('[data-add-break-entry]'); if (edit) openEntryModal('range', edit.dataset.editEntry); if (remove) deleteEntry(remove.dataset.deleteEntry); if (addBreak) openBreakModal(addBreak.dataset.addBreakEntry); });
  $('#upcoming-shifts').addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-shift]'); const remove = event.target.closest('[data-delete-shift]'); if (edit) openShiftModal(edit.dataset.editShift); if (remove) deleteShift(remove.dataset.deleteShift); });
  $('#calendar-grid').addEventListener('click', (event) => { const entry = event.target.closest('[data-calendar-entry]'); const shift = event.target.closest('[data-calendar-shift]'); const day = event.target.closest('[data-calendar-day]'); const week = event.target.closest('[data-calendar-week]'); if (week) { showWeek(week.dataset.calendarWeek); navigate('week'); } else if (entry) openEntryModal('range', entry.dataset.calendarEntry); else if (shift) openShiftModal(shift.dataset.calendarShift); else if (day) openEntryModalForDate(day.dataset.calendarDay); });
  $('#calendar-prev').addEventListener('click', () => { calendarCursor.setMonth(calendarCursor.getMonth() - 1); renderCalendar(); });
  $('#calendar-next').addEventListener('click', () => { calendarCursor.setMonth(calendarCursor.getMonth() + 1); renderCalendar(); });
  $('#calendar-today-button').addEventListener('click', () => { calendarCursor = new Date(); calendarCursor.setDate(1); renderCalendar(); });
}

bindEvents();
renderAll();
setInterval(() => { renderOverview(); if (activeView === 'week') renderWeek(); }, 1000);

window.TempoApp = {
  getState: () => state,
  replaceState: (nextState) => { state = { ...nextState, removedPeople: nextState.removedPeople || state.removedPeople || [], invites: nextState.invites || [], payments: nextState.payments || [] }; TempoStore.save(state); renderAll(); },
  setLocalDemoMode: () => { renderAll(); },
  setSyncStatus,
  showToast,
};

window.TempoAuth?.start({ onAuthenticated: (session) => window.TempoCloud?.hydrate?.(session) });

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js?v=13').catch(() => {}));
