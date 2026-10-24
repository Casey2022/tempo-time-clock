(function attachTempoCloud() {
  let workspaceId = null;
  let currentUser = null;
  let syncTimer = null;
  let refreshTimer = null;
  let syncing = null;
  let channel = null;
  // False until 0002_week_payments.sql has been run, so the rest of sync keeps working without it.
  let paymentsAvailable = true;

  const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const newId = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0')}`);
  const displayNameFor = (user) => user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Tempo user';
  const initialsFor = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'TU';
  const cents = (value) => Math.max(0, Math.round(Number(value || 0) * 100));
  const check = (result) => { if (result.error) throw result.error; return result.data; };
  const isMissingTable = (error) => error?.code === 'PGRST205' || error?.code === '42P01';

  function client() { return window.TempoSupabase?.getClient?.(); }

  // ---------------------------------------------------------------------------
  // State → database rows. The same builders produce the "last synced" snapshot,
  // so only rows that changed since the last pull/push are sent.
  // ---------------------------------------------------------------------------
  function rawMinutes(entry) {
    if (entry.mode === 'duration') return Number(entry.durationMinutes || 0) * 60;
    const start = entry.start ? new Date(entry.start).getTime() : 0;
    const end = entry.end ? new Date(entry.end).getTime() : Date.now();
    const breaks = (entry.breaks || []).filter((item) => !item.paid).reduce((total, item) => {
      if (item.start) return total + Math.max(0, ((item.end ? new Date(item.end).getTime() : Date.now()) - new Date(item.start).getTime()) / 60000);
      return total + Number(item.durationMinutes || 0);
    }, 0);
    return Math.max(0, (end - start) / 60000 - breaks);
  }

  function roundedMinutes(entry) { return Math.round(Math.max(0, rawMinutes(entry)) / 15) * 15; }

  function entryRate(entry, state) {
    if (entry.rateOverride !== null && entry.rateOverride !== undefined && entry.rateOverride !== '') return Number(entry.rateOverride);
    const job = state.jobs.find((item) => item.id === entry.jobId);
    const person = state.people.find((item) => item.id === entry.personId);
    return Number(job?.rates?.[entry.personId] ?? person?.defaultRate ?? 0);
  }

  function rowsFromState(state) {
    const jobs = {};
    const rates = {};
    const entries = {};
    const breaks = {};
    const shifts = {};
    const members = {};
    const payments = {};

    state.jobs.filter((job) => isUuid(job.id)).forEach((job) => {
      jobs[job.id] = { id: job.id, workspace_id: workspaceId, name: job.name, color: job.color || 'indigo', is_general: Boolean(job.general), deleted_at: job.deletedAt || null };
      Object.entries(job.rates || {}).forEach(([personId, rate]) => {
        if (!isUuid(personId)) return;
        rates[`${job.id}:${personId}`] = rate === null || rate === undefined || rate === ''
          ? null
          : { workspace_id: workspaceId, job_id: job.id, person_id: personId, rate_cents: cents(rate) };
      });
    });

    state.entries.filter((entry) => isUuid(entry.id) && isUuid(entry.jobId) && isUuid(entry.personId)).forEach((entry) => {
      const duration = entry.mode === 'duration';
      // Running clocks change every second, so their totals are only stored once stopped.
      const finished = duration || Boolean(entry.end);
      const rounded = finished ? roundedMinutes(entry) : 0;
      const rate = entryRate(entry, state);
      entries[entry.id] = {
        id: entry.id, workspace_id: workspaceId, person_id: entry.personId, job_id: entry.jobId, mode: entry.mode,
        entry_date: duration ? entry.date : null,
        start_at: duration ? null : entry.start,
        end_at: duration ? null : (entry.end || null),
        duration_minutes: duration ? Number(entry.durationMinutes || 0) * 60 : null,
        rounded_minutes: rounded,
        rate_override_cents: entry.rateOverride == null || entry.rateOverride === '' ? null : cents(entry.rateOverride),
        applied_rate_cents: cents(rate),
        gross_pay_cents: Math.round((rounded / 60) * cents(rate)),
        note: entry.note || null,
        deleted_at: entry.deletedAt || null,
      };
      (entry.breaks || []).forEach((item) => {
        if (!isUuid(item.id)) item.id = newId();
        if (!item.start && item.durationMinutes == null) return;
        breaks[item.id] = { id: item.id, time_entry_id: entry.id, start_at: item.start || null, end_at: item.start ? (item.end || null) : null, duration_minutes: item.start ? null : Number(item.durationMinutes || 0), paid: Boolean(item.paid) };
      });
    });

    state.shifts.filter((shift) => isUuid(shift.id) && isUuid(shift.jobId)).forEach((shift) => {
      shifts[shift.id] = { id: shift.id, workspace_id: workspaceId, person_id: isUuid(shift.personId) ? shift.personId : null, job_id: shift.jobId, start_at: shift.start, end_at: shift.end, note: shift.note || null, deleted_at: shift.deletedAt || null };
    });

    state.people.filter((person) => isUuid(person.id)).forEach((person) => {
      members[person.id] = { default_rate_cents: cents(person.defaultRate) };
    });

    (state.payments || []).filter((payment) => isUuid(payment.personId) && /^\d{4}-\d{2}-\d{2}$/.test(payment.weekStart || '')).forEach((payment) => {
      payments[`${payment.personId}:${payment.weekStart}`] = { workspace_id: workspaceId, person_id: payment.personId, week_start: payment.weekStart, amount_paid_cents: cents(payment.amountPaid) };
    });

    return { jobs, rates, entries, breaks, shifts, members, payments };
  }

  function snapshotOf(rows) {
    const snapshot = {};
    Object.entries(rows).forEach(([table, items]) => {
      snapshot[table] = {};
      Object.entries(items).forEach(([key, row]) => { snapshot[table][key] = JSON.stringify(row); });
    });
    return snapshot;
  }

  function changed(rows, snapshot, table) {
    const previous = snapshot?.[table] || {};
    return Object.entries(rows[table]).filter(([key, row]) => previous[key] !== JSON.stringify(row));
  }

  // ---------------------------------------------------------------------------
  // Database rows → app state
  // ---------------------------------------------------------------------------
  function mapBreak(row) {
    return { id: row.id, start: row.start_at, end: row.end_at, durationMinutes: row.duration_minutes == null ? null : Number(row.duration_minutes), paid: Boolean(row.paid) };
  }

  function mapEntry(row, breaks) {
    const duration = row.mode === 'duration';
    return {
      id: row.id,
      personId: row.person_id,
      jobId: row.job_id,
      mode: row.mode,
      date: row.entry_date,
      start: row.start_at,
      // The app treats duration entries as "finished" by giving them a midday end time.
      end: duration ? `${row.entry_date}T12:00:00.000Z` : row.end_at,
      durationMinutes: duration && row.duration_minutes != null ? Number(row.duration_minutes) / 60 : null,
      breaks: breaks.filter((item) => item.time_entry_id === row.id).map(mapBreak),
      note: row.note || '',
      rateOverride: row.rate_override_cents == null ? null : Number(row.rate_override_cents) / 100,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }

  const ROLE_LABELS = { owner: 'Owner / admin', member: 'Member', payer: 'Payer' };
  const ENTITY_LABELS = { time_entries: 'Time entry', planned_shifts: 'Planned shift', jobs: 'Job' };

  function auditDetail(item, jobNames) {
    const data = item.after_data || item.before_data || {};
    const label = ENTITY_LABELS[item.entity_type] || item.entity_type;
    if (item.entity_type === 'jobs') return `${label} · ${data.name || 'unnamed'}`;
    const jobName = jobNames.get(data.job_id);
    return jobName ? `${label} · ${jobName}` : label;
  }

  async function ensureWorkspace(supabaseClient, user) {
    const displayName = displayNameFor(user);
    // ignoreDuplicates: create the profile on first sign-in, never overwrite a name the person changed.
    check(await supabaseClient.from('profiles').upsert({ id: user.id, display_name: displayName, initials: initialsFor(displayName) }, { onConflict: 'id', ignoreDuplicates: true }));
    return check(await supabaseClient.rpc('bootstrap_workspace'));
  }

  async function pull() {
    const supabaseClient = client();
    const [membersResult, jobsResult, ratesResult, entriesResult, shiftsResult, auditResult] = await Promise.all([
      supabaseClient.from('workspace_members').select('workspace_id, user_id, role, default_rate_cents').eq('workspace_id', workspaceId),
      supabaseClient.from('jobs').select('*').eq('workspace_id', workspaceId).is('deleted_at', null).order('created_at'),
      supabaseClient.from('job_rates').select('*').eq('workspace_id', workspaceId),
      supabaseClient.from('time_entries').select('*').eq('workspace_id', workspaceId).order('start_at', { ascending: false, nullsFirst: false }),
      supabaseClient.from('planned_shifts').select('*').eq('workspace_id', workspaceId).is('deleted_at', null).order('start_at'),
      supabaseClient.from('audit_events').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(100),
    ]);
    const memberRows = check(membersResult) || [];
    const jobRows = check(jobsResult) || [];
    const rateRows = check(ratesResult) || [];
    const entryRows = check(entriesResult) || [];
    const shiftRows = check(shiftsResult) || [];
    const auditRows = check(auditResult) || [];

    const memberIds = memberRows.map((item) => item.user_id);
    const entryIds = entryRows.map((entry) => entry.id);
    const isOwner = memberRows.some((member) => member.user_id === currentUser.id && member.role === 'owner');
    const [profileRows, breakRows, inviteRows, paymentRows] = await Promise.all([
      memberIds.length ? supabaseClient.from('profiles').select('*').in('id', memberIds).then(check) : [],
      entryIds.length ? supabaseClient.from('breaks').select('*').in('time_entry_id', entryIds).then(check) : [],
      isOwner ? supabaseClient.from('workspace_invites').select('id, email, role, default_rate_cents, created_at').eq('workspace_id', workspaceId).is('accepted_at', null).order('created_at').then(check) : [],
      supabaseClient.from('week_payments').select('person_id, week_start, amount_paid_cents').eq('workspace_id', workspaceId).then((result) => {
        paymentsAvailable = !isMissingTable(result.error);
        return paymentsAvailable ? check(result) : [];
      }),
    ]);

    const profiles = new Map((profileRows || []).map((item) => [item.id, item]));
    const jobs = jobRows.map((job) => ({ id: job.id, name: job.name, color: job.color, general: job.is_general, createdBy: job.created_by, rates: {} }));
    const jobMap = new Map(jobs.map((job) => [job.id, job]));
    rateRows.forEach((rate) => { const job = jobMap.get(rate.job_id); if (job) job.rates[rate.person_id] = Number(rate.rate_cents) / 100; });
    const people = memberRows
      .sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0))
      .map((member) => {
        const profile = profiles.get(member.user_id) || { display_name: member.user_id === currentUser.id ? displayNameFor(currentUser) : 'Workspace member', initials: 'WM' };
        return { id: member.user_id, name: profile.display_name, initials: profile.initials, role: ROLE_LABELS[member.role] || 'Member', roleKey: member.role, venmo: profile.venmo_username || '', defaultRate: Number(member.default_rate_cents || 0) / 100, avatar: member.user_id === currentUser.id ? 'indigo' : 'orange' };
      });
    const entries = entryRows.map((entry) => mapEntry(entry, breakRows || []));
    const shifts = shiftRows.map((shift) => ({ id: shift.id, personId: shift.person_id || 'general', jobId: shift.job_id, start: shift.start_at, end: shift.end_at, note: shift.note || '', deletedAt: shift.deleted_at }));
    const jobNames = new Map(jobRows.map((job) => [job.id, job.name]));
    const audit = auditRows.map((item) => ({ id: item.id, action: item.action[0].toUpperCase() + item.action.slice(1), detail: auditDetail(item, jobNames), actorId: item.actor_id || currentUser.id, at: item.created_at }));
    const previous = window.TempoApp.getState();
    const payments = !paymentsAvailable ? (previous.payments || []) : (paymentRows || []).map((row) => ({ personId: row.person_id, weekStart: row.week_start, amountPaid: Number(row.amount_paid_cents || 0) / 100 }));
    const invites = (inviteRows || []).map((invite) => ({ id: invite.id, email: invite.email, role: ROLE_LABELS[invite.role] || 'Member', defaultRate: Number(invite.default_rate_cents || 0) / 100, createdAt: invite.created_at }));

    const nextState = { currentUserId: currentUser.id, workspaceId, people, removedPeople: [], jobs, entries, shifts, audit, invites, payments, sync: previous.sync || {} };
    nextState.sync.snapshot = snapshotOf(rowsFromState(nextState));
    // Payments kept locally while the table is missing stay "unsynced" so they upload once it exists.
    if (!paymentsAvailable) nextState.sync.snapshot.payments = {};
    nextState.sync.workspaceId = workspaceId;
    nextState.sync.pendingMutations = [];
    window.TempoApp.replaceState(nextState);
  }

  async function push() {
    const supabaseClient = client();
    const state = window.TempoApp.getState();
    // Never push another account's or another workspace's local data into this workspace.
    if (state.sync?.workspaceId !== workspaceId || !state.sync?.snapshot) return;
    const snapshot = state.sync.snapshot;
    const rows = rowsFromState(state);
    const isOwner = state.people.some((person) => person.id === currentUser.id && /owner/i.test(person.role || ''));
    const isEditor = !state.people.some((person) => person.id === currentUser.id && person.roleKey === 'payer');

    const jobs = changed(rows, snapshot, 'jobs');
    if (jobs.length) check(await supabaseClient.from('jobs').upsert(jobs.map(([, row]) => row)));

    const rates = changed(rows, snapshot, 'rates');
    const rateUpserts = rates.filter(([, row]) => row).map(([, row]) => row);
    if (rateUpserts.length) check(await supabaseClient.from('job_rates').upsert(rateUpserts));
    for (const [key] of rates.filter(([, row]) => !row)) {
      const [jobId, personId] = key.split(':');
      check(await supabaseClient.from('job_rates').delete().eq('job_id', jobId).eq('person_id', personId));
    }

    if (isOwner) {
      for (const person of (state.removedPeople || []).filter((item) => item.membershipRemoved && isUuid(item.id))) {
        check(await supabaseClient.from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', person.id));
        person.membershipRemoved = false;
      }
      for (const [personId, row] of changed(rows, snapshot, 'members')) {
        check(await supabaseClient.from('workspace_members').update(row).eq('workspace_id', workspaceId).eq('user_id', personId));
      }
    }

    // A payer changing a job rate recalculates entry totals locally; those aren't theirs to save.
    const entries = isEditor ? changed(rows, snapshot, 'entries') : [];
    if (entries.length) check(await supabaseClient.from('time_entries').upsert(entries.map(([, row]) => row)));
    const breaks = isEditor ? changed(rows, snapshot, 'breaks') : [];
    if (breaks.length) check(await supabaseClient.from('breaks').upsert(breaks.map(([, row]) => row)));
    const shifts = changed(rows, snapshot, 'shifts');
    if (shifts.length) check(await supabaseClient.from('planned_shifts').upsert(shifts.map(([, row]) => row)));
    const payments = paymentsAvailable ? changed(rows, snapshot, 'payments') : [];
    if (payments.length) {
      const result = await supabaseClient.from('week_payments').upsert(payments.map(([, row]) => row));
      if (isMissingTable(result.error)) paymentsAvailable = false;
      else check(result);
    }

    const latest = window.TempoApp.getState();
    latest.sync.snapshot = snapshotOf(rows);
    if (!isOwner) latest.sync.snapshot.members = snapshot.members;
    if (!paymentsAvailable) latest.sync.snapshot.payments = snapshot.payments;
    if (!isEditor) { latest.sync.snapshot.entries = snapshot.entries; latest.sync.snapshot.breaks = snapshot.breaks; }
    latest.sync.lastSyncedAt = new Date().toISOString();
    latest.sync.pendingMutations = [];
    window.TempoStore.save(latest);
  }

  function reportError(error, fallback) {
    const message = error?.message || fallback;
    window.TempoApp?.setSyncStatus?.('attention', message);
    console.error(`[Tempo] ${fallback}`, { message: error?.message, code: error?.code, details: error?.details, hint: error?.hint });
  }

  // Runs one sync job at a time; later requests wait for the current one.
  function exclusive(task) {
    const run = (syncing || Promise.resolve()).catch(() => {}).then(task);
    syncing = run.finally(() => { if (syncing === run) syncing = null; });
    return run;
  }

  function subscribe() {
    const supabaseClient = client();
    if (channel) supabaseClient.removeChannel(channel);
    channel = supabaseClient.channel(`workspace-${workspaceId}`);
    ['jobs', 'job_rates', 'time_entries', 'planned_shifts', 'workspace_members', 'week_payments'].forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `workspace_id=eq.${workspaceId}` }, scheduleRefresh);
    });
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'breaks' }, scheduleRefresh);
    channel.subscribe();
  }

  async function hydrate(session) {
    const supabaseClient = client();
    if (!supabaseClient || !session?.user) return;
    currentUser = session.user;
    window.TempoApp?.setSyncStatus?.('connecting');
    try {
      workspaceId = await ensureWorkspace(supabaseClient, currentUser);
      await exclusive(async () => { await push(); await pull(); });
      window.TempoApp?.setSyncStatus?.('connected');
      window.TempoApp?.showToast?.('Cloud workspace connected');
      subscribe();
    } catch (error) {
      reportError(error, 'Cloud workspace could not be loaded');
      window.TempoApp?.showToast?.('Cloud connection needs attention');
    }
  }

  async function syncNow() {
    if (!workspaceId || !currentUser || !client()) return;
    try {
      await exclusive(push);
      window.TempoApp?.setSyncStatus?.('connected');
    } catch (error) {
      reportError(error, 'Cloud sync failed');
    }
  }

  async function refresh() {
    if (!workspaceId || !currentUser || !client()) return;
    try {
      await exclusive(async () => { await push(); await pull(); });
      window.TempoApp?.setSyncStatus?.('connected');
    } catch (error) {
      reportError(error, 'Cloud refresh failed');
    }
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 350);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 800);
  }

  async function inviteMember(email, defaultRate, role = 'member') {
    const supabaseClient = client();
    if (!supabaseClient || !workspaceId) throw new Error('Connect to the cloud workspace before inviting someone.');
    const normalized = String(email || '').trim().toLowerCase();
    const result = await supabaseClient.from('workspace_invites').insert({ workspace_id: workspaceId, email: normalized, role, default_rate_cents: cents(defaultRate) });
    if (result.error?.code === '23505') throw new Error(`${normalized} already has a pending invite.`);
    check(result);
    // Emails them a one-time sign-in link. It creates their account if they don't have one yet.
    const { error: emailError } = await supabaseClient.auth.signInWithOtp({ email: normalized, options: { shouldCreateUser: true, emailRedirectTo: window.location.origin } });
    await refresh();
    return { emailSent: !emailError, emailError: emailError?.message };
  }

  async function updateProfile({ name, venmo }) {
    const supabaseClient = client();
    if (!supabaseClient || !currentUser) throw new Error('Connect to the cloud workspace first.');
    const fields = { updated_at: new Date().toISOString() };
    if (name !== undefined) { fields.display_name = name; fields.initials = initialsFor(name); }
    if (venmo !== undefined) fields.venmo_username = venmo || null;
    const result = await supabaseClient.from('profiles').update(fields).eq('id', currentUser.id);
    if (result.error?.code === 'PGRST204' || /venmo_username/.test(result.error?.message || '')) throw new Error('Run 0003_payer_role_and_venmo.sql in Supabase first.');
    check(result);
    await refresh();
  }

  async function cancelInvite(inviteId) {
    const supabaseClient = client();
    if (!supabaseClient || !workspaceId) throw new Error('Connect to the cloud workspace first.');
    check(await supabaseClient.from('workspace_invites').delete().eq('id', inviteId));
    await refresh();
  }

  function reset() {
    if (channel) client()?.removeChannel(channel);
    channel = null;
    workspaceId = null;
    currentUser = null;
  }

  window.addEventListener('online', () => scheduleRefresh());

  window.TempoCloud = { hydrate, scheduleSync, syncNow, refresh, inviteMember, cancelInvite, updateProfile, reset, isConnected: () => Boolean(workspaceId), paymentsAvailable: () => paymentsAvailable, getWorkspaceId: () => workspaceId };
})();
