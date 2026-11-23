import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import AuthLayout from '../components/AuthLayout.jsx';
import Icon from '../components/Icon.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [values, setValues] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const update = (e) => setValues({ ...values, [e.target.name]: e.target.value });

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await login(values);
      navigate(location.state?.from || '/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <AuthLayout title="Your appointments, notes and payments in one place." text="Patients book and pay. Doctors manage their schedule. Admins keep everything safe.">
      <form onSubmit={handleSubmit} noValidate={false}>
        <h1>Welcome back</h1>
        <p className="muted">Log in to manage your appointments.</p>
        <label className="field">Email address
          <input name="email" type="email" required autoComplete="email" value={values.email} onChange={update}
            aria-invalid={Boolean(error)} />
        </label>
        <div className="field">
          <div className="row between">
            <label htmlFor="password">Password</label>
            <Link to="/forgot-password" className="small">Forgot password?</Link>
          </div>
          <div className="password-field">
            <input id="password" name="password" type={showPassword ? 'text' : 'password'} required autoComplete="current-password"
              value={values.password} onChange={update} aria-invalid={Boolean(error)} aria-describedby={error ? 'login-error' : undefined} />
            <button type="button" className="show-password" onClick={() => setShowPassword(!showPassword)} aria-pressed={showPassword}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        {error && <p className="error" id="login-error" role="alert">{error}</p>}
        <button className="btn btn-block" disabled={saving}>{saving ? 'Logging in...' : 'Log in'}</button>
        <p className="small center">New to CareBook? <Link to="/register">Create an account</Link></p>
        <div className="auth-note">
          <Icon name="steth" size={20} />
          <div><strong>Are you a doctor?</strong> <Link to="/register?role=doctor">Register as a doctor</Link>. Your profile goes live once an admin checks your MDCN licence.</div>
        </div>
      </form>
    </AuthLayout>
  );
}
