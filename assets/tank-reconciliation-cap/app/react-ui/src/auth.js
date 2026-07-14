/**
 * Auth context — reads the logged-in user's roles from the CAP /me endpoint.
 * In development (dummy auth), everyone is treated as Admin.
 * In production (XSUAA), roles come from xs-security.json role collections.
 */

let _userCache = null;

export async function fetchCurrentUser() {
  if (_userCache) return _userCache;
  try {
    const res = await fetch('/reconciliation/$metadata', { headers: { Accept: 'application/json' } });

    // If 401, redirect to XSUAA login via CAP's built-in login endpoint
    if (res.status === 401) {
      window.location.href = '/login';
      return null;
    }

    // Try CAP's built-in user endpoint
    const meRes = await fetch('/user-api/currentUser', { headers: { Accept: 'application/json' } });
    if (meRes.ok) {
      const me = await meRes.json();
      _userCache = {
        id: me.email || me.name || 'user',
        roles: me['xs.system.attributes']?.['xs.rolecollections'] || [],
        isAdmin: (me['xs.system.attributes']?.['xs.rolecollections'] || []).includes('TankRecon_Admin'),
        isSupervisor:
          (me['xs.system.attributes']?.['xs.rolecollections'] || []).includes('TankRecon_Approver') ||
          (me['xs.system.attributes']?.['xs.rolecollections'] || []).includes('TankRecon_Admin'),
        raw: me
      };
      return _userCache;
    }
  } catch (_) { /* ignore */ }

  // Fallback — development mode: full access
  _userCache = { id: 'dev-user', roles: ['TankRecon_Admin'], isAdmin: true, isSupervisor: true };
  return _userCache;
}

export function clearUserCache() {
  _userCache = null;
}
