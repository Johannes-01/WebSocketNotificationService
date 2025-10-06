'use client';

import { useAuth } from '@/contexts/AuthContext';

export default function Home() {
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="bg-white shadow-xl rounded-lg p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold mb-4">Welcome to WebSocket Tester</h1>
        {user && (
          <div className="space-y-4">
            <p className="text-gray-600">
              Signed in as: <span className="font-medium">{user.getUsername()}</span>
            </p>
            <button
              onClick={handleSignOut}
              className="w-full bg-red-600 text-white py-2 px-4 rounded hover:bg-red-700 transition-colors"
            >
              Sign Out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
