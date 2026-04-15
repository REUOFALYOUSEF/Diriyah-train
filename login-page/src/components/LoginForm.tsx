import React, { useState } from 'react';
import { loginWithEmail, registerWithEmail } from '../services/auth';

const LoginForm: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [mode, setMode] = useState<'login' | 'signup'>('login');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        try {
            if (mode === 'login') {
                await loginWithEmail(email, password);
                return;
            }

            await registerWithEmail(email, password);
        } catch (err) {
            setError(mode === 'login' ? 'Login failed. Please check your credentials.' : 'Sign up failed. Try another email.');
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <h3>{mode === 'login' ? 'Login' : 'Create Account'}</h3>
            <div>
                <label>Email:</label>
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                />
            </div>
            <div>
                <label>Password:</label>
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                />
            </div>
            {error && <p>{error}</p>}
            <button type="submit">{mode === 'login' ? 'Login' : 'Sign Up'}</button>
            <button
                type="button"
                onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
            >
                {mode === 'login' ? 'Create new account' : 'Already have an account? Login'}
            </button>
        </form>
    );
};

export default LoginForm;