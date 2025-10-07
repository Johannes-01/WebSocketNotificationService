'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';

export default function Home() {
  const router = useRouter();
  const { user, isLoading, signOut } = useAuth();

  useEffect(() => {
    // If not loading and no user, redirect to sign-in
    if (!isLoading && !user) {
      router.push('/signin?redirect=/');
    }
  }, [user, isLoading, router]);

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // If no user after loading, show nothing (redirect will happen)
  if (!user) {
    return null;
  }

  const handleSignOut = async () => {
    await signOut();
    router.push('/signin');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">WebSocket Notification Service</h1>
              <p className="text-sm text-gray-600 mt-1">
                Signed in as: <span className="font-medium">{user?.getUsername()}</span>
              </p>
            </div>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-sm font-medium"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Choose Your Testing Interface</h2>
          <p className="text-lg text-gray-600">
            Select the appropriate interface for your testing needs
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {/* Single Client Tester Card */}
          <Link href="/single-client" className="group">
            <div className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition-all duration-300 border-2 border-transparent hover:border-blue-500 h-full flex flex-col">
              <div className="text-5xl mb-4 text-center">🔌</div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3 text-center">
                Single Client Tester
              </h3>
              <p className="text-gray-600 mb-6 flex-1">
                Test with a single WebSocket connection. Ideal for basic testing, debugging individual connections, and learning the system.
              </p>
              <div className="space-y-2 mb-6">
                <div className="flex items-center text-sm text-gray-700">
                  <span className="text-green-500 mr-2">✓</span>
                  Simple, focused interface
                </div>
                <div className="flex items-center text-sm text-gray-700">
                  <span className="text-green-500 mr-2">✓</span>
                  P2P and A2P messaging
                </div>
                <div className="flex items-center text-sm text-gray-700">
                  <span className="text-green-500 mr-2">✓</span>
                  Detailed connection logs
                </div>
                <div className="flex items-center text-sm text-gray-700">
                  <span className="text-green-500 mr-2">✓</span>
                  Message payload inspection
                </div>
              </div>
              <div className="bg-blue-50 text-blue-700 py-3 px-4 rounded-lg text-center font-semibold group-hover:bg-blue-100 transition-colors">
                Launch Single Client →
              </div>
            </div>
          </Link>

          {/* Multi-Client Tester Card */}
          <Link href="/multi-client" className="group">
            <div className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition-all duration-300 border-2 border-transparent hover:border-purple-500 h-full flex flex-col">
              <div className="text-5xl mb-4 text-center">🔌🔌🔌</div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3 text-center">
                Multi-Client Tester
              </h3>
              <p className="text-gray-600 mb-6 flex-1">
                Manage multiple WebSocket connections simultaneously. Perfect for testing client-to-client messaging, load testing, and complex scenarios.
              </p>
              <div className="space-y-2 mb-6">
                <div className="flex items-center text-sm text-gray-700">
                  <span className="text-purple-500 mr-2">✓</span>
                  Multiple simultaneous connections
                </div>
                <div className="flex items-center text-sm text-gray-700">
                  <span className="text-purple-500 mr-2">✓</span>
                  Client-to-client messaging
                </div>
                <div className="flex items-center text-sm text-gray-700">
                  <span className="text-purple-500 mr-2">✓</span>
                  Independent client configuration
                </div>
                <div className="flex items-center text-sm text-gray-700">
                  <span className="text-purple-500 mr-2">✓</span>
                  Centralized connection monitoring
                </div>
              </div>
              <div className="bg-purple-50 text-purple-700 py-3 px-4 rounded-lg text-center font-semibold group-hover:bg-purple-100 transition-colors">
                Launch Multi-Client →
              </div>
            </div>
          </Link>
        </div>

        {/* Info Section */}
        <div className="mt-12 bg-white rounded-lg shadow-md p-6 max-w-3xl mx-auto">
          <h4 className="text-lg font-semibold text-gray-900 mb-3">Quick Guide</h4>
          <div className="space-y-3 text-sm text-gray-700">
            <div>
              <span className="font-medium">Single Client:</span> Use this when you want to focus on testing one connection at a time. Great for debugging specific issues or understanding message flows.
            </div>
            <div>
              <span className="font-medium">Multi-Client:</span> Use this when you need to simulate multiple users or test interactions between different clients. Each client can have different configurations and can send/receive messages independently.
            </div>
            <div>
              <span className="font-medium">P2P vs A2P:</span> P2P (Person-to-Person) sends messages via WebSocket with lower latency. A2P (Application-to-Person) sends via HTTP REST API and works even without an active WebSocket connection.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
