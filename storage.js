(function attachTempoStore() {
  const STORAGE_KEY = 'tempo-timeclock-state-v1';
  const CLIENT_KEY = 'tempo-client-id-v1';

  function clientId() {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  }

  function withSyncMetadata(state) {
    state.sync = state.sync || {};
    state.sync.clientId = state.sync.clientId || clientId();
    state.sync.pendingMutations = Array.isArray(state.sync.pendingMutations) ? state.sync.pendingMutations : [];
    state.sync.conflicts = Array.isArray(state.sync.conflicts) ? state.sync.conflicts : [];
    state.sync.lastSyncedAt = state.sync.lastSyncedAt || null;
    state.sync.status = state.sync.status || 'offline';
    state.sync.statusDetail = state.sync.statusDetail || '';
    return state;
  }

  window.TempoStore = {
    load(fallback) {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return withSyncMetadata(saved ? JSON.parse(saved) : fallback);
      } catch (error) {
        return withSyncMetadata(fallback);
      }
    },
    save(state) {
      withSyncMetadata(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    },
    queueMutation(state, mutation) {
      withSyncMetadata(state);
      state.sync.pendingMutations.push({
        id: `mutation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        clientId: state.sync.clientId,
        createdAt: new Date().toISOString(),
        ...mutation,
      });
      state.sync.pendingMutations = state.sync.pendingMutations.slice(-100);
    },
    pendingCount(state) {
      return withSyncMetadata(state).sync.pendingMutations.length;
    },
  };
})();
