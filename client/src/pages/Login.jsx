import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username, password);
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
            <p className="eyebrow">Welcome back</p>
            <h1 style={{ fontSize: 'var(--text-xl)' }} className="section-title">Sign in</h1>
          </div>
          {error && <p className="form-error">{error}</p>}
          <label className="field">
            <span className="label">Username or email</span>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </label>
          <label className="field">
            <span className="label">Password</span>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p style={{ margin: 0 }}>
            No account yet? <Link to="/register">Create one</Link> - it only takes a minute.
          </p>
        </form>
      </div>
    </section>
  );
}
