import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { StatusPill } from '../components/GameCard.jsx';

const RUNNING = ['queued', 'cloning', 'building', 'packaging'];
const REPO_URL_RE = /^https:\/\/(github\.com|gitlab\.com|githepia\.hesge\.ch)\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/;
const EMPTY_FORM = {
  sourceType: 'repo',
  repoUrl: '',
  branch: '',
  slug: '',
  title: '',
  shortDescription: '',
  description: '',
  version: '1.0.0',
  authors: '',
  tags: '',
  controls: '',
  year: new Date().getFullYear(),
  engineName: 'fungraphics',
  engineVersion: '',
};

function buildFormData(data, files = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null) form.append(key, value);
  }
  if (files.package?.[0]) form.append('package', files.package[0]);
  if (files.cover?.[0]) form.append('cover', files.cover[0]);
  for (const file of files.screenshots ?? []) form.append('screenshots', file);
  return form;
}

function metadataFromGame(game) {
  return {
    sourceType: game.sourceType || 'repo',
    repoUrl: game.repoUrl || '',
    branch: game.branch || '',
    slug: game.slug,
    title: game.title || '',
    shortDescription: game.shortDescription || '',
    description: game.description || '',
    version: game.version || '1.0.0',
    authors: game.authors?.join(', ') || '',
    tags: game.tags?.join(', ') || '',
    controls: game.controls || '',
    year: game.year || '',
    engineName: game.engine?.name || 'fungraphics',
    engineVersion: game.engine?.version || '',
  };
}

function MetadataFields({ form, setForm, compact = false, disabled = false }) {
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));
  return (
    <div className="dashboard-form-grid">
      <label className="field">
        <span>Title</span>
        <input className="input" value={form.title} onChange={set('title')} maxLength={80} required disabled={disabled} />
      </label>
      <label className="field">
        <span>Version</span>
        <input className="input" value={form.version} onChange={set('version')} placeholder="1.0.0" disabled={disabled} />
      </label>
      <label className="field field-wide">
        <span>Short description</span>
        <input className="input" value={form.shortDescription} onChange={set('shortDescription')} maxLength={200} required disabled={disabled} />
      </label>
      <label className="field field-wide">
        <span>Description</span>
        <textarea className="input textarea" value={form.description} onChange={set('description')} rows={compact ? 4 : 6} disabled={disabled} />
      </label>
      <label className="field">
        <span>Authors</span>
        <input className="input" value={form.authors} onChange={set('authors')} placeholder="Alice, Bob" disabled={disabled} />
      </label>
      <label className="field">
        <span>Tags</span>
        <input className="input" value={form.tags} onChange={set('tags')} placeholder="puzzle, 2d, keyboard" disabled={disabled} />
      </label>
      <label className="field">
        <span>Controls</span>
        <input className="input" value={form.controls} onChange={set('controls')} maxLength={300} disabled={disabled} />
      </label>
      <label className="field">
        <span>Year</span>
        <input className="input" type="number" min="2000" max="2100" value={form.year} onChange={set('year')} disabled={disabled} />
      </label>
      <label className="field">
        <span>Engine</span>
        <input className="input" value={form.engineName} onChange={set('engineName')} disabled={disabled} />
      </label>
      <label className="field">
        <span>Engine version</span>
        <input className="input" value={form.engineVersion} onChange={set('engineVersion')} disabled={disabled} />
      </label>
    </div>
  );
}

export default function Dashboard() {
  const [games, setGames] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [repoLookupError, setRepoLookupError] = useState('');
  const [packageSelected, setPackageSelected] = useState(false);
  const [openLog, setOpenLog] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const timer = useRef(null);
  const inspectTimer = useRef(null);
  const lastInspected = useRef('');
  const createFiles = useRef(null);
  const editFiles = useRef(null);
  const hasSource = form.sourceType === 'repo' ? !!form.repoUrl.trim() : packageSelected;

  const refresh = useCallback(() => {
    api.get('/games/mine').then((data) => {
      setGames(data);
      clearTimeout(timer.current);
      if (data.some((g) => RUNNING.includes(g.buildStatus))) {
        timer.current = setTimeout(refresh, 3000);
      }
    }).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      clearTimeout(timer.current);
      clearTimeout(inspectTimer.current);
    };
  }, [refresh]);

  useEffect(() => {
    clearTimeout(inspectTimer.current);
    if (form.sourceType !== 'repo' || !form.repoUrl.trim()) {
      setRepoLookupError('');
      return;
    }

    const repoUrl = form.repoUrl.trim();
    const branch = form.branch.trim();
    if (!REPO_URL_RE.test(repoUrl)) {
      setRepoLookupError('');
      return;
    }

    const key = `${repoUrl}#${branch}`;
    if (lastInspected.current === key) return;

    inspectTimer.current = setTimeout(() => {
      lastInspected.current = key;
      inspectRepo(repoUrl, branch);
    }, 700);

    return () => clearTimeout(inspectTimer.current);
  }, [form.sourceType, form.repoUrl, form.branch]);

  function updateForm(key, value) {
    if (key === 'repoUrl' || key === 'branch') setRepoLookupError('');
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function inspectRepo(repoUrl = form.repoUrl, branch = form.branch) {
    setInspecting(true);
    setRepoLookupError('');
    try {
      const metadata = await api.post('/games/inspect-repo', { repoUrl, branch });
      setForm((prev) => {
        if (prev.repoUrl.trim() !== repoUrl.trim() || prev.branch.trim() !== branch.trim()) return prev;
        return {
          ...prev,
          ...metadata,
          engineName: metadata.engineName || prev.engineName,
          engineVersion: metadata.engineVersion || '',
        };
      });
    } catch (err) {
      setRepoLookupError("Aucun repo n'a été trouvé avec cette URL.");
      lastInspected.current = '';
    } finally {
      setInspecting(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!hasSource) return;
    setBusy(true);
    setError('');
    try {
      const files = createFiles.current?.elements;
      await api.postForm('/games', buildFormData(form, {
        package: files?.package?.files,
        cover: files?.cover?.files,
        screenshots: files?.screenshots?.files,
      }));
      setForm(EMPTY_FORM);
      setPackageSelected(false);
      lastInspected.current = '';
      createFiles.current?.reset();
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const files = editFiles.current?.elements;
      await api.patchForm(`/games/${editing}`, buildFormData(editForm, {
        package: files?.package?.files,
        cover: files?.cover?.files,
        screenshots: files?.screenshots?.files,
      }));
      setEditing(null);
      setEditForm(null);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function rebuild(slug) {
    try {
      await api.post(`/games/${slug}/rebuild`);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(slug) {
    if (!confirm(`Delete "${slug}" and its package? This cannot be undone.`)) return;
    try {
      await api.delete(`/games/${slug}`);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(game) {
    setOpenLog(null);
    setEditing(editing === game.slug ? null : game.slug);
    setEditForm(metadataFromGame(game));
  }

  return (
    <section className="section">
      <div className="container">
        <p className="eyebrow">Publisher dashboard</p>
        <h1 className="section-title" style={{ fontSize: 'var(--text-xl)' }}>My games</h1>

        <form ref={createFiles} onSubmit={submit} className="dashboard-publish">
          <div className="segmented">
            <button type="button" className={form.sourceType === 'repo' ? 'active' : ''} onClick={() => {
              updateForm('sourceType', 'repo');
              setPackageSelected(false);
            }}>
              Git repository
            </button>
            <button type="button" className={form.sourceType === 'executable' ? 'active' : ''} onClick={() => updateForm('sourceType', 'executable')}>
              Executable
            </button>
          </div>

          {form.sourceType === 'repo' ? (
            <div className="repo-source-fields">
              <div className="store-toolbar" style={{ marginBottom: 0 }}>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: '18rem', maxWidth: 'none' }}
                  placeholder="https://github.com/you/your-game"
                  value={form.repoUrl}
                  onChange={(e) => updateForm('repoUrl', e.target.value)}
                  aria-describedby={repoLookupError ? 'repo-lookup-error' : undefined}
                  required
                />
                <input
                  className="input"
                  style={{ maxWidth: '10rem' }}
                  placeholder="branch (optional)"
                  value={form.branch}
                  onChange={(e) => updateForm('branch', e.target.value)}
                />
                {inspecting && <span className="status-pill status-running">reading repo</span>}
              </div>
              {repoLookupError && <p id="repo-lookup-error" className="field-hint field-hint-error">{repoLookupError}</p>}
            </div>
          ) : (
            <label className="field">
              <span>Executable or packaged game</span>
              <input
                className="input"
                type="file"
                name="package"
                accept=".zip,.jar,.exe,application/zip,application/java-archive"
                onChange={(e) => setPackageSelected(e.target.files.length > 0)}
                required
              />
            </label>
          )}

          <div className={`dashboard-details${hasSource ? ' open' : ''}`} aria-hidden={!hasSource}>
            <div className="dashboard-details-inner">
              <label className="field">
                <span>Slug</span>
                <input className="input" value={form.slug} onChange={(e) => updateForm('slug', e.target.value)} placeholder="generated from title when empty" disabled={!hasSource} />
              </label>

              <MetadataFields form={form} setForm={setForm} disabled={!hasSource} />

              <div className="dashboard-form-grid">
                <label className="field">
                  <span>Cover</span>
                  <input className="input" type="file" name="cover" accept="image/png,image/jpeg,image/gif,image/webp" disabled={!hasSource} />
                </label>
                <label className="field">
                  <span>Screenshots</span>
                  <input className="input" type="file" name="screenshots" accept="image/png,image/jpeg,image/gif,image/webp" multiple disabled={!hasSource} />
                </label>
              </div>

              <div className="row-actions">
                <button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit game'}</button>
                <Link className="btn btn-secondary" to="/docs/manifest">Manifest reference</Link>
              </div>
            </div>
          </div>
        </form>

        {error && <p className="form-error">{error}</p>}
        {!games && <p>Loading…</p>}
        {games?.length === 0 && <p>No games yet - submit your game above.</p>}

        {games?.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Game</th><th>Source</th><th>Build</th><th>Store</th><th>Downloads</th><th>Version</th><th></th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <Fragment key={g.slug}>
                  <tr>
                    <td>
                      <strong>{g.title}</strong>
                      <br />
                      <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--isc-muted)' }}>
                        {g.slug}{g.commit ? ` @ ${g.commit}` : ''}
                      </span>
                    </td>
                    <td>{g.sourceType === 'executable' ? 'upload' : 'repo'}</td>
                    <td><StatusPill status={g.buildStatus} /></td>
                    <td>{g.published ? 'published' : 'awaiting approval'}</td>
                    <td>{g.downloads}</td>
                    <td className="mono">{g.version}</td>
                    <td>
                      <div className="row-actions">
                        <Link className="btn btn-secondary btn-sm" to={`/game/${g.slug}`}>View</Link>
                        <button className="btn btn-secondary btn-sm" onClick={() => startEdit(g)}>Edit</button>
                        {g.sourceType === 'repo' && (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => rebuild(g.slug)}
                            disabled={RUNNING.includes(g.buildStatus)}
                          >
                            Rebuild
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => setOpenLog(openLog === g.slug ? null : g.slug)}>
                          {openLog === g.slug ? 'Hide log' : 'Log'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => remove(g.slug)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                  {editing === g.slug && editForm && (
                    <tr>
                      <td colSpan={7}>
                        <form ref={editFiles} onSubmit={saveEdit} className="dashboard-edit">
                          {g.sourceType === 'repo' && (
                            <div className="store-toolbar" style={{ marginBottom: 0 }}>
                              <input className="input" style={{ flex: 1, maxWidth: 'none' }} value={editForm.repoUrl} onChange={(e) => setEditForm((prev) => ({ ...prev, repoUrl: e.target.value }))} />
                              <input className="input" style={{ maxWidth: '10rem' }} value={editForm.branch} onChange={(e) => setEditForm((prev) => ({ ...prev, branch: e.target.value }))} placeholder="branch (optional)" />
                            </div>
                          )}
                          <MetadataFields form={editForm} setForm={setEditForm} compact />
                          <div className="dashboard-form-grid">
                            <label className="field">
                              <span>New cover</span>
                              <input className="input" type="file" name="cover" accept="image/png,image/jpeg,image/gif,image/webp" />
                            </label>
                            <label className="field">
                              <span>Add screenshots</span>
                              <input className="input" type="file" name="screenshots" accept="image/png,image/jpeg,image/gif,image/webp" multiple />
                            </label>
                            <label className="field">
                              <span>Replace package</span>
                              <input className="input" type="file" name="package" accept=".zip,.jar,.exe,application/zip,application/java-archive" />
                            </label>
                          </div>
                          <div className="row-actions">
                            <button className="btn btn-primary btn-sm" disabled={busy}>Save</button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                  {openLog === g.slug && (
                    <tr>
                      <td colSpan={7}><pre className="build-log">{g.buildLog || 'No log yet.'}</pre></td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
