import React, { useState, useEffect } from 'react';
import LoginForm from './components/LoginForm';
import GoogleAuthButton from './components/GoogleAuthButton';
import { logout, onUserStateChange } from './services/auth';
import Booking from './components/Booking';
import { User } from 'firebase/auth';

const App: React.FC = () => {
    const [user, setUser] = useState<User | null>(null);
    const [currentView, setCurrentView] = useState<'dashboard' | 'booking'>('dashboard');

    useEffect(() => {
        const unsubscribe = onUserStateChange((currentUser) => {
            setUser(currentUser);
        });
        return () => unsubscribe();
    }, []);

    return (
        <div>
            <h1>Login Page</h1>
            {user ? (
                <div>
                    {currentView === 'dashboard' && (
                        <>
                            <h2>Welcome, {user.displayName || user.email}</h2>
                            <button onClick={() => setCurrentView('booking')}>Go to Booking</button>
                            <button onClick={async () => {
                                await logout();
                                window.location.href = '../page.html';
                            }}>Logout</button>
                        </>
                    )}
                    {currentView === 'booking' && (
                        <>
                            <button onClick={() => setCurrentView('dashboard')}>Back to Dashboard</button>
                            <Booking />
                        </>
                    )}
                </div>
            ) : (
                <div>
                    <LoginForm />
                    <GoogleAuthButton />
                </div>
            )}
        </div>
    );
};

export default App;