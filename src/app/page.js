'use client';

import { useState, useEffect } from 'react';
import { auth, googleProvider } from './lib/firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import Journal from '../components/Journal';

export default function Home() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    try { await signInWithPopup(auth, googleProvider); }
    catch (error) { console.error("Error signing in:", error); }
  };

  const handleSignOut = async () => {
    try { await signOut(auth); }
    catch (error) { console.error("Error signing out:", error); }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading your space...</div>;
  }

  return (
    <main className="min-h-screen flex flex-col items-center p-4 md:p-8 bg-slate-50 text-slate-800 font-sans selection:bg-blue-100">
      <header className="w-full max-w-3xl flex justify-between items-center mb-8 pb-4 border-b border-slate-200">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">AI Daily Journal</h1>

        {user && (
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-slate-600 hidden md:block">
              {user.displayName}
            </span>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 text-sm bg-white border border-slate-200 hover:bg-slate-100 rounded-full transition-colors shadow-sm"
            >
              Sign Out
            </button>
          </div>
        )}
      </header>

      {user ? (
        <Journal user={user} />
      ) : (
        <div className="flex flex-col items-center gap-6 text-center max-w-md mt-20">
          <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mb-2">
            <span className="text-2xl">✨</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight">Reflect & Grow</h2>
          <p className="text-slate-500 text-lg leading-relaxed">
            Write down your thoughts and get personalized, AI-powered life advice based on your daily entries.
          </p>
          <button
            onClick={handleSignIn}
            className="mt-4 px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-medium transition-colors shadow-md hover:shadow-lg"
          >
            Continue with Google
          </button>
        </div>
      )}
    </main>
  );
}