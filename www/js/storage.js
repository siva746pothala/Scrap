/**
 * ScrapStorage — Native-persistent key/value store
 * Uses @capacitor/preferences (Android SharedPreferences) when available,
 * falls back to localStorage for web/development.
 *
 * SharedPreferences survives:
 *   ✅ App updates
 *   ✅ WebView cache clears ("Clear Cache" in Android settings)
 *   ✅ Temporary data clears
 * NOT survived by:
 *   ❌ "Clear Data" / "Clear Storage" in Android settings (same as uninstall)
 *   ❌ App uninstall
 */
const ScrapStorage = {
  _prefs: null,

  async _getPrefs() {
    if (this._prefs) return this._prefs;
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) {
        this._prefs = window.Capacitor.Plugins.Preferences;
        return this._prefs;
      }
    } catch (e) {}
    return null;
  },

  async set(key, value) {
    const prefs = await this._getPrefs();
    const strValue = value === null || value === undefined ? '' : String(value);
    if (prefs) {
      await prefs.set({ key, value: strValue });
    }
    // Always mirror to localStorage as fallback
    localStorage.setItem(key, strValue);
  },

  async get(key) {
    const prefs = await this._getPrefs();
    if (prefs) {
      try {
        const result = await prefs.get({ key });
        if (result && result.value !== null && result.value !== undefined && result.value !== '') {
          return result.value;
        }
      } catch (e) {}
    }
    // Fallback to localStorage
    return localStorage.getItem(key);
  },

  async remove(key) {
    const prefs = await this._getPrefs();
    if (prefs) {
      await prefs.remove({ key });
    }
    localStorage.removeItem(key);
  }
};

window.ScrapStorage = ScrapStorage;
