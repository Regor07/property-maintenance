/* =========================
   CLOUD SYNC (Supabase)
   -------------------------
   Whole-app sync: one JSON row per user in table `app_data`,
   with a version number for conflict detection.

   Local state kept in localStorage:
     K.syncVersion  version of the cloud row this device last saw
     K.syncDirty    "1" while this device has unsynced changes
     K.syncUser     which account those two belong to
========================= */

(function () {
    'use strict';

    const URL_ = window.SUPABASE_URL || '';
    const KEY_ = window.SUPABASE_KEY || '';
    const TABLE = 'app_data';

    const VER_KEY = K + '.syncVersion';
    const DIRTY_KEY = K + '.syncDirty';
    const USER_KEY = K + '.syncUser';
    const EMAIL_KEY = K + '.syncEmail';

    const configured = !!(URL_ && KEY_);
    const libLoaded = !!(
        window.supabase && typeof window.supabase.createClient === 'function'
    );

    let client = null;
    let session = null;
    let status = !configured
        ? 'unconfigured'
        : (!libLoaded ? 'unavailable' : 'signedout');
    let message = '';
    let lastSynced = null;
    let busy = false;
    let working = false;          // sign-in in progress
    let changeSeq = 0;
    let pushTimer = null;
    let retryTimer = null;
    let listenersAttached = false;

    /* ---------- small helpers ---------- */

    const getVersion = () => {
        const v = Number(localStorage.getItem(VER_KEY));
        return v > 0 ? v : null;
    };
    const setVersion = v => localStorage.setItem(VER_KEY, String(v));
    const isDirty = () => localStorage.getItem(DIRTY_KEY) === '1';
    const setDirty = d => {
        if (d) localStorage.setItem(DIRTY_KEY, '1');
        else localStorage.setItem(DIRTY_KEY, '0');
    };

    const hasData = () =>
        (db.tasks && db.tasks.length) || (db.todos && db.todos.length);

    function isNetworkError(e) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return true;
        }
        return /fetch|network|timeout|offline|load failed/i.test(
            String((e && e.message) || e)
        );
    }

    function setStatus(s, msg = '') {
        status = s;
        message = msg;
        paint();
    }

    function paint() {

        const badge = document.getElementById('syncBadge');

        if (badge) {
            const time = lastSynced
                ? lastSynced.toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit'
                })
                : '';

            const text = {
                synced: time ? `☁ Synced ${time}` : '☁ Synced',
                saving: '☁ Saving…',
                offline: '⚠ Offline – saved on this device',
                error: '⚠ Sync problem – see Settings tab'
            }[status] || '';

            badge.textContent = text;
        }

        if (typeof renderBackup === 'function') {
            // Don't wipe the sign-in fields while someone is typing.
            const typing =
                status === 'signedout' &&
                document.activeElement &&
                document.activeElement.id &&
                document.activeElement.id.startsWith('sync');

            if (!typing) renderBackup();
        }
    }

    function backupLocal(suffix) {
        try {
            localStorage.setItem(
                K + '.backup-' + suffix,
                JSON.stringify(db)
            );
        } catch (e) { /* storage full: nothing more we can do */ }
    }

    /* ---------- talking to Supabase ---------- */

    async function fetchRemote(full) {

        const { data, error } = await client
            .from(TABLE)
            .select(full ? 'data,version,updated_at' : 'version,updated_at')
            .eq('user_id', session.user.id)
            .maybeSingle();

        if (error) throw error;

        return data;   // null when this user has no row yet
    }

    /* Returns 'ok' or 'conflict'. Throws on network/server errors. */
    async function push() {

        const seq = changeSeq;
        const payload = JSON.parse(JSON.stringify(db));
        const ver = getVersion();
        const uid = session.user.id;

        let newVer;

        if (ver === null) {

            const { error } = await client
                .from(TABLE)
                .insert({ user_id: uid, data: payload, version: 1 })
                .select('version');

            if (error) {
                if (error.code === '23505') return 'conflict';
                throw error;
            }

            newVer = 1;

        } else {

            const { data, error } = await client
                .from(TABLE)
                .update({
                    data: payload,
                    version: ver + 1,
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', uid)
                .eq('version', ver)
                .select('version');

            if (error) throw error;
            if (!data || !data.length) return 'conflict';

            newVer = ver + 1;
        }

        setVersion(newVer);
        localStorage.setItem(USER_KEY, uid);

        // Edits made while the request was in flight stay dirty.
        if (seq === changeSeq) setDirty(false);

        return 'ok';
    }

    async function loadRemote() {

        const remote = await fetchRemote(true);

        if (!remote) return;

        if (
            !remote.data ||
            typeof remote.data !== 'object' ||
            !Array.isArray(remote.data.tasks)
        ) {
            throw new Error('The cloud data looks damaged, so it was not loaded.');
        }

        if (hasData()) backupLocal('before-cloud-load');

        db = remote.data;

        prepareDB();      // upgrades / tops up; does not mark dirty

        setVersion(remote.version);
        localStorage.setItem(USER_KEY, session.user.id);
        setDirty(false);

        render();
    }

    function when(iso) {
        return iso ? new Date(iso).toLocaleString() : 'an unknown time';
    }

    /* One pass of "compare this device with the cloud and fix it".
       Returns 'done' or 'retry'. */
    async function reconcile() {

        const remote = await fetchRemote(false);
        const localVer = getVersion();
        const dirty = isDirty();

        // Cloud has nothing for this user yet.
        if (!remote) {

            if (localVer !== null) {
                // The cloud row vanished: start fresh from this device.
                localStorage.removeItem(VER_KEY);
            }

            if (hasData()) {
                return (await push()) === 'ok' ? 'done' : 'retry';
            }

            return 'done';
        }

        // This device has never synced with this cloud row.
        if (localVer === null) {

            if (!hasData()) {
                await loadRemote();
                return 'done';
            }

            const useCloud = confirm(
                `Your cloud account already has data (saved ${when(remote.updated_at)}), ` +
                `and this device also has data.\n\n` +
                `OK = use the CLOUD data (this device's data is kept as a safety copy)\n` +
                `Cancel = keep THIS device's data (the cloud data is overwritten)`
            );

            if (useCloud) {
                await loadRemote();
                return 'done';
            }

            await keepLocalOverCloud(remote.version);
            return 'retry';
        }

        // Cloud is ahead of this device.
        if (remote.version > localVer) {

            if (!dirty) {
                await loadRemote();
                return 'done';
            }

            const useCloud = confirm(
                `Another device changed your data, and this device also has unsynced changes.\n\n` +
                `OK = load the CLOUD version (this device's changes are kept as a safety copy)\n` +
                `Cancel = keep THIS device's version (the cloud version is overwritten)`
            );

            if (useCloud) {
                await loadRemote();
                return 'done';
            }

            await keepLocalOverCloud(remote.version);
            return 'retry';
        }

        // Same version: push if we have changes.
        if (dirty) {
            return (await push()) === 'ok' ? 'done' : 'retry';
        }

        return 'done';
    }

    /* The person chose this device over the cloud: keep a copy of the
       cloud data locally, adopt its version, and push over it. */
    async function keepLocalOverCloud(remoteVersion) {

        const remote = await fetchRemote(true);

        if (remote && remote.data) {
            try {
                localStorage.setItem(
                    K + '.backup-cloud-overwritten',
                    JSON.stringify(remote.data)
                );
            } catch (e) { /* ignore */ }
        }

        setVersion(remoteVersion);
        setDirty(true);
        changeSeq++;
    }

    async function syncNow() {

        if (!client || !session || busy) return;

        busy = true;
        clearTimeout(pushTimer);
        clearTimeout(retryTimer);

        try {

            // Only show "Saving…" when there is something to upload;
            // a routine check for changes shouldn't flash it.
            if (isDirty()) setStatus('saving');

            for (let i = 0; i < 4; i++) {
                if ((await reconcile()) === 'done') break;
            }

            lastSynced = new Date();
            setStatus('synced');

        } catch (e) {

            if (isNetworkError(e)) {
                setStatus('offline');
            } else {
                setStatus('error', (e && e.message) || String(e));
            }

            retryTimer = setTimeout(syncNow, 30000);

        } finally {
            busy = false;
        }
    }

    function schedulePush() {

        if (!client || !session) return;

        clearTimeout(pushTimer);
        pushTimer = setTimeout(syncNow, 1500);
    }

    /* ---------- account ---------- */

    async function onSignedIn() {

        // A different account than this device last synced with:
        // treat local data as never synced.
        const stored = localStorage.getItem(USER_KEY);

        if (stored && stored !== session.user.id) {
            localStorage.removeItem(VER_KEY);
            setDirty(false);
        }

        attachListeners();
        await syncNow();
    }

    function attachListeners() {

        if (listenersAttached) return;

        listenersAttached = true;

        window.addEventListener('online', syncNow);
        window.addEventListener('focus', syncNow);

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                syncNow();
            } else if (isDirty()) {
                syncNow();   // best effort before the page is hidden
            }
        });

        setInterval(() => {
            if (document.visibilityState !== 'hidden') syncNow();
        }, 120000);
    }

    async function signIn() {

        if (!client || working) return;

        const email = (document.getElementById('syncEmail') || {}).value || '';
        const password = (document.getElementById('syncPassword') || {}).value || '';

        if (!email || !password) {
            setStatus('signedout', 'Enter your email and password.');
            return;
        }

        working = true;

        // Remember the address (never the password) so a typo or a
        // failed attempt doesn't make you retype it.
        localStorage.setItem(EMAIL_KEY, email);

        setStatus('signedout', 'Signing in…');

        try {

            const { data, error } = await client.auth.signInWithPassword({
                email,
                password
            });

            if (error) {
                setStatus('signedout', error.message || 'Could not sign in.');
                return;
            }

            session = data.session;
            message = '';

            await onSignedIn();

        } catch (e) {

            setStatus(
                'signedout',
                isNetworkError(e)
                    ? 'No connection. Try again when you are online.'
                    : (e.message || 'Could not sign in.')
            );

        } finally {
            working = false;
        }
    }

    async function signOut() {

        if (!client) return;

        clearTimeout(pushTimer);
        clearTimeout(retryTimer);

        try { await client.auth.signOut(); } catch (e) { /* ignore */ }

        session = null;

        // Local data stays on this device.
        setStatus('signedout');
    }

    /* ---------- UI ---------- */

    function cardHTML() {

        let body;

        if (status === 'unconfigured') {

            body = `
              <p class="muted">
                Cloud sync is not set up. To keep your phone and computer
                in sync, add your Supabase URL and key to
                <code>config.js</code> (see the README), then reload.
              </p>`;

        } else if (status === 'unavailable') {

            body = `
              <p class="muted">
                The sync library could not be loaded (are you offline?).
                The app still works on this device. Reload when you are
                back online.
              </p>`;

        } else if (!session) {

            body = `
              <form onsubmit="cloudSync.signIn(); return false;">
                <p class="muted">
                  Sign in to sync this device with your other devices.
                </p>
                <div class="sync-fields">
                  <input id="syncEmail" type="email" autocomplete="username"
                         placeholder="Email" autocapitalize="none"
                         value="${esc(localStorage.getItem(EMAIL_KEY) || '')}">
                  <input id="syncPassword" type="password"
                         autocomplete="current-password" placeholder="Password">
                  <button class="primary" type="submit">Sign in</button>
                </div>
                ${message ? `<p class="sync-msg">${esc(message)}</p>` : ''}
              </form>`;

        } else {

            const state = {
                synced: lastSynced
                    ? `Synced at ${esc(lastSynced.toLocaleTimeString())}`
                    : 'Synced',
                saving: 'Saving…',
                offline: 'Offline. Changes are saved on this device and ' +
                         'will sync automatically when you reconnect.',
                error: 'Problem: ' + esc(message)
            }[status] || '';

            body = `
              <p class="meta">Signed in as ${esc(session.user.email || '')}</p>
              <p class="sync-status sync-${esc(status)}">${state}</p>
              <div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 0">
                <button class="small" type="button"
                        onclick="cloudSync.syncNow()">Sync now</button>
                <button class="small" type="button"
                        onclick="cloudSync.signOut()">Sign out</button>
              </div>`;
        }

        return `
          <div class="card">
            <h2>Cloud sync</h2>
            ${body}
          </div>`;
    }

    /* ---------- start-up ---------- */

    async function init() {

        if (!configured || !libLoaded) {
            paint();
            return;
        }

        client = window.supabase.createClient(URL_, KEY_, {
            auth: { persistSession: true, autoRefreshToken: true }
        });

        client.auth.onAuthStateChange((event, s) => {
            // Deferred: calling Supabase from inside this callback can deadlock.
            setTimeout(() => {
                const had = session;
                session = s;
                if (s && !had) onSignedIn();
                if (!s && had) setStatus('signedout');
            }, 0);
        });

        try {

            const { data } = await client.auth.getSession();
            session = data && data.session;

        } catch (e) {
            session = null;
        }

        if (session) {
            await onSignedIn();
        } else {
            setStatus('signedout');
        }
    }

    window.cloudSync = {

        markDirty() {
            changeSeq++;
            setDirty(true);
            if (client && session) {
                setStatus('saving');
                schedulePush();
            }
        },

        cardHTML,
        signIn,
        signOut,
        syncNow,

        // for tests
        _test: {
            ready: null,
            getVersion,
            isDirty,
            status: () => status,
            message: () => message
        }
    };

    window.cloudSync._test.ready = init();

})();
