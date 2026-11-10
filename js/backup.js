// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Backup: looking after the only copy of your titles
//
// Everything is kept in this browser, and a browser can clear a site's
// storage (Safari does after a week away, unless the page is on the home
// screen). So the app:
//   - asks the browser to keep its storage (persist), once there are titles;
//   - remembers how many titles it last saw, outside the database, so a
//     database that comes back empty is known to have been cleared rather
//     than taken for a new start (missing);
//   - remembers when you last exported, shows it in Settings (status), and
//     says so at launch when it's been a while (nudge).
// All of it is kept in localStorage, on this device only.
// ============================================================================

const Backup = {
  COUNT_KEY: 'titles_count',
  EXPORT_KEY: 'last_export',
  NUDGE_KEY: 'backup_nudged',
  DAY_MS: 24 * 60 * 60 * 1000,
  // A backup older than this is worth a word, at most this often, once there
  // are enough titles to mind losing
  OVERDUE_DAYS: 30,
  NUDGE_EVERY_DAYS: 7,
  MIN_TITLES: 20,
  asked: false,

  read(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch (error) {
      return '';
    }
  },

  write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      // Not remembered (private browsing)
    }
  },

  // How many titles there are now, after loading and after every change
  noteCount(count) {
    this.write(this.COUNT_KEY, String(count));
    if (count && !this.asked) {
      this.asked = true;
      this.persist();
    }
  },

  // How many titles were here last time, if none loaded now; otherwise 0
  missing(loaded) {
    const before = parseInt(this.read(this.COUNT_KEY), 10);
    return !loaded && before > 0 ? before : 0;
  },

  // Asks the browser not to clear this site's storage; resolves to its answer
  async persist() {
    try {
      if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persist) return false;
      return await navigator.storage.persist();
    } catch (error) {
      return false;
    }
  },

  noteExport(now = Date.now()) {
    this.write(this.EXPORT_KEY, new Date(now).toISOString());
  },

  // Whole days since the last export, or null if there hasn't been one
  daysSinceExport(now = Date.now()) {
    const when = Date.parse(this.read(this.EXPORT_KEY));
    return isNaN(when) ? null : Math.max(0, Math.floor((now - when) / this.DAY_MS));
  },

  // For Settings: "Last backup: 12 days ago."
  status(now = Date.now()) {
    const days = this.daysSinceExport(now);
    if (days === null) return 'No backup exported from this device yet.';
    return `Last backup: ${days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}.`;
  },

  // What to say at launch about an overdue backup, or '' for nothing
  nudge(count, now = Date.now()) {
    if (count < this.MIN_TITLES) return '';
    const days = this.daysSinceExport(now);
    if (days !== null && days < this.OVERDUE_DAYS) return '';
    const nudged = Date.parse(this.read(this.NUDGE_KEY));
    if (!isNaN(nudged) && now - nudged < this.NUDGE_EVERY_DAYS * this.DAY_MS) return '';
    this.write(this.NUDGE_KEY, new Date(now).toISOString());
    return days === null
      ? `${count} titles and no backup yet. Settings → Export saves one.`
      : `Last backup ${days} days ago. Settings → Export saves a new one.`;
  }
};
