/* Standalone browser adapter. Load Supabase JS v2 before this file.
 * No credentials embedded; configure with a project's PUBLIC publishable/anon key.
 * Supabase SDK manages session persistence, refresh coordination and Auth errors.
 */
(function (root) {
  'use strict';
  function create({ url, publishableKey, storageKey = 'felt-cloud-auth' }) {
    if (!root.supabase?.createClient) throw Error('Load @supabase/supabase-js v2 first');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url || '')) throw Error('A dedicated Supabase HTTPS project URL is required');
    if (!publishableKey || publishableKey.startsWith('sb_secret_')) throw Error('Use only the public publishable/anon key, NEVER service_role');
    // Reject legacy service-role JWTs as an accidental-secret safeguard, not authorization.
    if (publishableKey.split('.').length === 3) {
      let claims;
      try { claims = JSON.parse(atob(publishableKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { throw Error('Malformed public key'); }
      if (claims.role !== 'anon') throw Error('Only the legacy anon public key may be used in a browser');
    }
    const db = root.supabase.createClient(url, publishableKey, {
      auth: { storageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
    });
    const groupKey = storageKey + ':group';
    let groupId = root.localStorage.getItem(groupKey);
    function selectGroup(id) {
      if (id !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw Error('Invalid group id');
      groupId = id;
      if (id) root.localStorage.setItem(groupKey, id); else root.localStorage.removeItem(groupKey);
    }
    async function checked(promise) {
      const { data, error } = await promise;
      if (error) throw Object.assign(Error(error.message || 'Cloud request failed'), { code: error.code });
      return data;
    }
    async function session() {
      const data = await checked(db.auth.getSession());
      return data.session;
    }
    // Only explicit onboarding submissions create a device identity. Never on reads.
    let anonymousPending = null;
    async function ensureDeviceSession() {
      if (anonymousPending) return anonymousPending;
      anonymousPending = (async () => {
        const existing = await session();
        if (existing) return existing; // Retain existing anonymous AND email sessions.
        try {
          const data = await checked(db.auth.signInAnonymously());
          if (!data?.session) throw Error('Device sign-in did not return a session. Please try again.');
          return data.session;
        } catch (error) {
          if (error.code === 'anonymous_provider_disabled' || /anonymous.*(disabled|not enabled|not allowed)/i.test(error.message)) {
            throw Error('Host must enable Anonymous Sign-Ins in Supabase Authentication settings. Nothing was added to the ledger.');
          }
          throw error;
        }
      })();
      try { return await anonymousPending; } finally { anonymousPending = null; }
    }
    async function api(path, payload) {
      path = path.replace(/^\/api\//, '');
      if (path === 'logout') { await checked(db.auth.signOut()); selectGroup(null); return { ok: true }; }
      if (['setup', 'join', 'import', 'claim', 'recover'].includes(path)) await ensureDeviceSession();
      if (!await session()) {
        if (path === 'state') return { me: null, group: null, players: [], sessions: [], auth_required: true };
        throw Error('Create or join a room on this device first.');
      }
      const data = path === 'state'
        ? await checked(db.rpc('felt_state', { p_group_id: groupId }))
        : await checked(db.rpc('felt_command', { p_action: path, p_payload: payload ?? {}, p_group_id: groupId }));
      if (data?.group_id) selectGroup(data.group_id);
      return data;
    }
    return Object.freeze({
      api, selectGroup, getSession: session,
      // Email code flow works across devices; project email template must include {{ .Token }}.
      sendEmailCode: email => checked(db.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })),
      verifyEmailCode: (email, token) => checked(db.auth.verifyOtp({ email, token, type: 'email' })),
      onAuthStateChange: callback => db.auth.onAuthStateChange(callback),
      importLedger: ledger => api('import', { ledger }),
      claimPlayer: token => api('claim', { token }),
      async downloadExport() {
        const data = await api('export');
        const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = href; a.download = 'felt-cloud-backup.json'; a.click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
        return data;
      }
    });
  }
  root.FeltCloud = Object.freeze({ create });
})(typeof window === 'undefined' ? globalThis : window);
