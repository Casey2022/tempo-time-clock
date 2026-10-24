(function attachTempoAuth() {
  let started = false;
  let onAuthenticated = async () => {};
  let recoveryMode = false;
  let authenticatedUserId = null;

  const isLocal = () => ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const $ = (selector) => document.querySelector(selector);

  function showGate(message = '') {
    const gate = $('#auth-gate');
    gate.classList.remove('hidden');
    gate.setAttribute('aria-hidden', 'false');
    $('#auth-message').textContent = message;
  }

  function hideGate() {
    const gate = $('#auth-gate');
    gate.classList.add('hidden');
    gate.setAttribute('aria-hidden', 'true');
  }

  function setMessage(message, error = false) {
    const element = $('#auth-message');
    element.textContent = message;
    element.classList.toggle('error', error);
  }

  function setBusy(busy) {
    $('#auth-submit').disabled = busy;
    $('#auth-reset').disabled = busy;
    $('#auth-signup').disabled = busy;
    $('#auth-google').disabled = busy;
    $('#auth-passkey').disabled = busy;
  }

  function setRecoveryMode(enabled) {
    recoveryMode = enabled;
    $('#auth-title').textContent = enabled ? 'Set a new password' : 'Sign in to Tempo';
    $('#auth-description').textContent = enabled ? 'Choose a new password for your Tempo account.' : 'Your hours are protected and available offline after you sign in.';
    $('#auth-email-field').classList.toggle('hidden', enabled);
    $('#auth-email').required = !enabled;
    $('#auth-password-label').textContent = enabled ? 'New password' : 'Password';
    $('#auth-password').autocomplete = enabled ? 'new-password' : 'current-password';
    $('#auth-confirm-password-field').classList.toggle('hidden', !enabled);
    $('#auth-confirm-password').required = enabled;
    $('#auth-submit').textContent = enabled ? 'Save new password' : 'Sign in';
    $('#auth-reset').classList.toggle('hidden', enabled);
    $('#auth-signup').classList.toggle('hidden', enabled);
    $('#auth-google').classList.toggle('hidden', enabled);
    $('#auth-passkey').classList.toggle('hidden', enabled);
  }

  async function finishSession(session) {
    if (!session?.user) return;
    if (recoveryMode) return showGate('Choose a new password to finish recovering your account.');
    if (authenticatedUserId === session.user.id) return hideGate();
    authenticatedUserId = session.user.id;
    hideGate();
    await onAuthenticated(session);
  }

  async function signIn(event) {
    event.preventDefault();
    const client = window.TempoSupabase?.getClient();
    if (!client) return setMessage('The secure connection is not available yet.', true);
    setBusy(true);
    setMessage('Signing in…');
    const { data, error } = await client.auth.signInWithPassword({ email: $('#auth-email').value.trim(), password: $('#auth-password').value });
    setBusy(false);
    if (error) {
      const message = /invalid login credentials/i.test(error.message)
        ? 'Email or password did not match. Check the exact email on the account, or use “Forgot password?” to reset it.'
        : error.message;
      return setMessage(message, true);
    }
    await finishSession(data.session);
  }

  async function updatePassword(event) {
    event.preventDefault();
    const client = window.TempoSupabase?.getClient();
    const password = $('#auth-password').value;
    const confirmation = $('#auth-confirm-password').value;
    if (!client) return setMessage('The secure connection is not available yet.', true);
    if (password.length < 8) return setMessage('Use at least 8 characters for the new password.', true);
    if (password !== confirmation) return setMessage('The two new passwords do not match.', true);
    setBusy(true);
    setMessage('Saving your new password…');
    const { data, error } = await client.auth.updateUser({ password });
    setBusy(false);
    if (error) return setMessage(error.message, true);
    recoveryMode = false;
    $('#auth-form').reset();
    setRecoveryMode(false);
    setMessage('Password updated.');
    await finishSession(data.user ? { user: data.user } : null);
  }

  async function resetPassword() {
    const client = window.TempoSupabase?.getClient();
    const email = $('#auth-email').value.trim();
    if (!client) return setMessage('The secure connection is not available yet.', true);
    if (!email) return setMessage('Enter your email first, then choose “Forgot password?”.', true);
    setBusy(true);
    setMessage('Sending a password reset email…');
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setBusy(false);
    if (error) return setMessage(error.message, true);
    setMessage('If that email has a Tempo account, a password reset link is on the way.');
  }

  async function signUp() {
    const client = window.TempoSupabase?.getClient();
    if (!client) return setMessage('The secure connection is not available yet.', true);
    setBusy(true);
    setMessage('Creating your account…');
    const { data, error } = await client.auth.signUp({
      email: $('#auth-email').value.trim(),
      password: $('#auth-password').value,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) return setMessage(error.message, true);
    if (data.session) return finishSession(data.session);
    setMessage('Check your email to confirm the account, then sign in.');
  }

  async function signInWithGoogle() {
    const client = window.TempoSupabase?.getClient();
    if (!client) return setMessage('The secure connection is not available yet.', true);
    setBusy(true);
    const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (error) { setBusy(false); setMessage(error.message, true); }
  }

  async function signInWithPasskey() {
    const client = window.TempoSupabase?.getClient();
    if (!client?.auth?.signInWithPasskey) return setMessage('Passkeys will be enabled after the production domain is configured.', true);
    setBusy(true);
    const { data, error } = await client.auth.signInWithPasskey();
    setBusy(false);
    if (error) return setMessage(error.message, true);
    await finishSession(data?.session);
  }

  function enableLocalDemo() {
    hideGate();
    window.TempoApp?.setLocalDemoMode?.();
  }

  async function start(options = {}) {
    if (started) return;
    started = true;
    onAuthenticated = options.onAuthenticated || onAuthenticated;
    $('#auth-form').addEventListener('submit', (event) => recoveryMode ? updatePassword(event) : signIn(event));
    $('#auth-reset').addEventListener('click', resetPassword);
    $('#auth-signup').addEventListener('click', signUp);
    $('#auth-google').addEventListener('click', signInWithGoogle);
    $('#auth-passkey').addEventListener('click', signInWithPasskey);
    $('#auth-demo').addEventListener('click', enableLocalDemo);
    $('#auth-demo').classList.toggle('hidden', !isLocal());
    if (window.location.hash.includes('type=recovery')) setRecoveryMode(true);

    const client = window.TempoSupabase?.getClient();
    if (!client) {
      if (isLocal()) return enableLocalDemo();
      showGate('Unable to load the secure connection. Refresh to try again.');
      return;
    }

    client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true);
        showGate('Choose a new password to finish recovering your account.');
        return;
      }
      if (event === 'SIGNED_OUT') {
        authenticatedUserId = null;
        recoveryMode = false;
        window.TempoApp?.setSyncStatus?.('offline');
        setRecoveryMode(false);
        showGate();
        return;
      }
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') finishSession(session);
    });
    const { data } = await client.auth.getSession();
    if (data.session) return finishSession(data.session);
    if (!recoveryMode) setRecoveryMode(false);
    showGate(recoveryMode ? 'Choose a new password to finish recovering your account.' : '');
  }

  window.TempoAuth = { start, signOut: async () => window.TempoSupabase?.getClient()?.auth.signOut() };
})();
