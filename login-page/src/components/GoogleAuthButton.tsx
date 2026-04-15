import React from 'react';
import { signInWithGoogle } from '../services/auth';

const GoogleAuthButton: React.FC = () => {
    const handleGoogleSignIn = async () => {
        try {
            await signInWithGoogle();
        } catch (error) {
            console.error("Google sign-in error:", error);
        }
    };

    return (
        <button onClick={handleGoogleSignIn}>
            Sign in with Google
        </button>
    );
};

export default GoogleAuthButton;