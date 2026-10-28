/**
 * ProfilesPanel — the "Profiles" settings section (Item 14).
 *
 * A profile is a NAMED snapshot of the entire settings object, persisted by the main
 * process in `profiles.json`. This panel lets the user:
 *   • name + "Save current as profile" (snapshots the live settings under that name);
 *   • see the list of profiles, with the active one badged;
 *   • Load a profile (replaces the live settings → re-applies live, theme included,
 *     via the existing `settings:changed` broadcast);
 *   • Rename a profile in place;
 *   • Delete a profile.
 *
 * The snapshot bytes never reach the renderer — the panel works entirely off the
 * `ProfileSummary[]` list + name strings, calling the `profiles*` IPC. Loading a
 * profile flows through the same store broadcast every setting uses, so charts, theme,
 * and every control update with no reload.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ProfileSummary } from '../../../shared/types';
import { api } from '../../api';
import { ensureSettingsPanelStyles } from './settingsPanelStyles';

ensureSettingsPanelStyles();

export function ProfilesPanel() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [newName, setNewName] = useState('');
  const [status, setStatus] = useState('');
  // The profile name currently being renamed (null = none), + its edit buffer.
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const refresh = useCallback(() => {
    void api.profilesList().then(setProfiles).catch(() => { /* keep current list */ });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const existing = (name: string) => profiles.some((p) => p.name.toLowerCase() === name.trim().toLowerCase());

  const save = () => {
    const n = newName.trim();
    if (!n) { setStatus('Type a profile name first.'); return; }
    const overwrite = existing(n);
    void api.profilesSave(n).then((list) => {
      setProfiles(list);
      setNewName('');
      setStatus(overwrite ? `Updated profile “${n}” with the current settings.` : `Saved current settings as “${n}”.`);
    });
  };

  const load = (name: string) => {
    void api.profilesLoad(name).then(() => {
      refresh();
      setStatus(`Loaded “${name}”. Settings applied live.`);
    });
  };

  const del = (name: string) => {
    void api.profilesDelete(name).then((list) => {
      setProfiles(list);
      if (editing === name) { setEditing(null); setEditName(''); }
      setStatus(`Deleted “${name}”.`);
    });
  };

  const startRename = (name: string) => { setEditing(name); setEditName(name); setStatus(''); };
  const cancelRename = () => { setEditing(null); setEditName(''); };
  const commitRename = (oldName: string) => {
    const n = editName.trim();
    if (!n) { setStatus('A profile name can’t be blank.'); return; }
    if (n === oldName) { cancelRename(); return; }
    if (existing(n)) { setStatus(`A profile named “${n}” already exists.`); return; }
    void api.profilesRename(oldName, n).then((list) => {
      setProfiles(list);
      cancelRename();
      setStatus(`Renamed “${oldName}” to “${n}”.`);
    });
  };

  return (
    <div className="sp-profiles">
      <p className="muted sp-profiles-intro">
        A profile is a named snapshot of <b>all</b> your settings (theme, chart, colours,
        sounds, alerts — everything). Save the current setup, then switch between profiles
        anytime; loading one applies instantly.
      </p>

      {/* Save current as a new (or same-named) profile. */}
      <div className="sp-profiles-save">
        <input
          type="text"
          className="sp-text"
          placeholder="Profile name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          spellCheck={false}
          aria-label="New profile name"
        />
        <button className="sp-btn" onClick={save} disabled={!newName.trim()}>
          {existing(newName) ? 'Update profile' : 'Save current as profile'}
        </button>
      </div>

      {/* The profile list. */}
      {profiles.length === 0 ? (
        <div className="sp-empty muted">No saved profiles yet. Save your current settings above to create one.</div>
      ) : (
        <ul className="sp-profiles-list">
          {profiles.map((p) => (
            <li key={p.name} className={`sp-profile ${p.active ? 'active' : ''}`}>
              {editing === p.name ? (
                <div className="sp-profile-rename">
                  <input
                    type="text"
                    className="sp-text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(p.name);
                      else if (e.key === 'Escape') cancelRename();
                    }}
                    autoFocus
                    spellCheck={false}
                    aria-label={`Rename ${p.name}`}
                  />
                  <button className="sp-btn" onClick={() => commitRename(p.name)}>Save</button>
                  <button className="sp-btn ghost" onClick={cancelRename}>Cancel</button>
                </div>
              ) : (
                <>
                  <div className="sp-profile-name">
                    <span>{p.name}</span>
                    {p.active && <span className="sp-badge">active</span>}
                  </div>
                  <div className="sp-profile-actions">
                    <button className="sp-btn" onClick={() => load(p.name)} disabled={p.active} title={p.active ? 'This profile is already loaded' : 'Load this profile'}>Load</button>
                    <button className="sp-btn ghost" onClick={() => startRename(p.name)}>Rename</button>
                    <button className="sp-btn danger" onClick={() => del(p.name)}>Delete</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {status && <div className="sp-adv-status muted tiny" role="status">{status}</div>}
    </div>
  );
}
