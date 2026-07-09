import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', displayName: '', password: '', publisherCode: '' });
  const [isStudent, setIsStudent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register({ ...form, publisherCode: isStudent ? form.publisherCode : '' });
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <div className="container">
        <form className="auth-card" onSubmit={onSubmit}>
          <div>
            <p className="eyebrow">Join the library</p>
            <h1 style={{ fontSize: 'var(--text-xl)' }} className="section-title">Create an account</h1>
          </div>
          {error && <p className="form-error">{error}</p>}
          <label className="field">
            <span className="label">Username</span>
            <input className="input" value={form.username} onChange={set('username')} required minLength={3} autoFocus />
          </label>
          <label className="field">
            <span className="label">Email</span>
            <input className="input" type="email" value={form.email} onChange={set('email')} required />
          </label>
          <label className="field">
            <span className="label">Display name (optional)</span>
            <input className="input" value={form.displayName} onChange={set('displayName')} />
          </label>
          <label className="field">
            <span className="label">Password (min. 8 characters)</span>
            <input className="input" type="password" value={form.password} onChange={set('password')} required minLength={8} />
          </label>

          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--space-2)' }}>
            <input type="checkbox" checked={isStudent} onChange={(e) => setIsStudent(e.target.checked)} />
            <span>I'm an ISC student - I want to publish games</span>
          </label>
          {isStudent && (
            <label className="field">
              <span className="label">Class code (ask your teacher or an admin)</span>
              <input className="input mono" value={form.publisherCode} onChange={set('publisherCode')} required />
            </label>
          )}

          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
          <p style={{ margin: 0 }}>
            Already registered? <Link to="/login">Sign in</Link>.
          </p>
        </form>
      </div>
    </section>
  );
}
