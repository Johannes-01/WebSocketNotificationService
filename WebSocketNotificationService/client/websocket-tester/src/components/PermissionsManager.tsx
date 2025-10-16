'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { 
  permissionsService, 
  Permission,
  GrantPermissionRequest 
} from '@/services/permissions';

export default function PermissionsManager() {
  const router = useRouter();
  const { user, getIdToken, signOut } = useAuth();
  
  // State for permissions list
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextStartKey, setNextStartKey] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  
  // State for user selection
  const [selectedUserId, setSelectedUserId] = useState('');
  const [pageLimit, setPageLimit] = useState(20);
  
  // State for grant permission modal
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [grantUserId, setGrantUserId] = useState('');
  const [grantChatId, setGrantChatId] = useState('');
  const [grantRole, setGrantRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [grantLoading, setGrantLoading] = useState(false);
  
  // State for revoke confirmation
  const [revokeConfirm, setRevokeConfirm] = useState<Permission | null>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);

  // Load permissions on mount or when selectedUserId changes
  useEffect(() => {
    if (selectedUserId) {
      loadPermissions(selectedUserId, undefined, true);
    }
  }, [selectedUserId]);

  const loadPermissions = async (
    userId: string, 
    startKey?: string, 
    reset = false
  ) => {
    if (!userId.trim()) {
      setError('User ID is required');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const token = await getIdToken();
      if (!token) {
        setError('Failed to get authentication token');
        return;
      }

      const response = await permissionsService.listPermissions(
        userId,
        token,
        startKey,
        pageLimit
      );

      if (reset) {
        setPermissions(response.permissions);
      } else {
        setPermissions(prev => [...prev, ...response.permissions]);
      }
      
      setNextStartKey(response.nextStartKey);
      setHasMore(!!response.nextStartKey);
      
      console.log(`Loaded ${response.permissions.length} permissions for ${userId}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      console.error('Failed to load permissions:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = () => {
    if (nextStartKey && selectedUserId) {
      loadPermissions(selectedUserId, nextStartKey, false);
    }
  };

  const handleGrantPermission = async () => {
    if (!grantUserId.trim() || !grantChatId.trim()) {
      alert('User ID and Chat ID are required');
      return;
    }

    try {
      setGrantLoading(true);
      
      const token = await getIdToken();
      if (!token) {
        alert('Failed to get authentication token');
        return;
      }

      const request: GrantPermissionRequest = {
        targetUserId: grantUserId,
        chatId: grantChatId,
        role: grantRole,
      };

      await permissionsService.grantPermission(request, token);
      
      // Reset form
      setGrantUserId('');
      setGrantChatId('');
      setGrantRole('member');
      setShowGrantModal(false);
      
      // Reload permissions if we're viewing the same user
      if (selectedUserId === grantUserId) {
        await loadPermissions(selectedUserId, undefined, true);
      }
      
      alert('Permission granted successfully!');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      alert(`Failed to grant permission: ${errorMessage}`);
      console.error('Grant permission error:', err);
    } finally {
      setGrantLoading(false);
    }
  };

  const handleRevokePermission = async (permission: Permission) => {
    try {
      setRevokeLoading(true);
      
      const token = await getIdToken();
      if (!token) {
        alert('Failed to get authentication token');
        return;
      }

      await permissionsService.revokePermission(
        {
          userId: permission.userId,
          chatId: permission.chatId,
        },
        token
      );
      
      // Remove from list
      setPermissions(prev => 
        prev.filter(p => !(p.userId === permission.userId && p.chatId === permission.chatId))
      );
      
      setRevokeConfirm(null);
      alert('Permission revoked successfully!');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      alert(`Failed to revoke permission: ${errorMessage}`);
      console.error('Revoke permission error:', err);
    } finally {
      setRevokeLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/signin');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b p-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/')}
              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
              title="Back to home"
            >
              ← Home
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Permissions Manager</h1>
              <p className="text-sm text-gray-600">
                Signed in as: <span className="font-medium">{user?.getUsername()}</span>
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowGrantModal(true)}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-sm font-medium"
            >
              ➕ Grant Permission
            </button>
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
      <div className="max-w-7xl mx-auto p-6">
        {/* User Selection */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-900">Select User</h2>
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                User ID
              </label>
              <input
                type="text"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                placeholder="e.g., user-123"
                className="w-full px-4 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div className="w-32">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Page Size
              </label>
              <select
                value={pageLimit}
                onChange={(e) => setPageLimit(parseInt(e.target.value))}
                className="w-full px-4 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
            <button
              onClick={() => selectedUserId && loadPermissions(selectedUserId, undefined, true)}
              disabled={loading || !selectedUserId.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {loading ? '⏳ Loading...' : '🔍 Load Permissions'}
            </button>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2">
              <span className="text-red-600 font-semibold">❌ Error:</span>
              <span className="text-red-700">{error}</span>
            </div>
          </div>
        )}

        {/* Permissions List */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="p-4 border-b bg-gray-50">
            <h2 className="text-lg font-semibold text-gray-900">
              Permissions {selectedUserId && `for ${selectedUserId}`}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {permissions.length} permission(s) loaded
              {hasMore && ' (more available)'}
            </p>
          </div>

          {permissions.length === 0 && !loading ? (
            <div className="p-12 text-center text-gray-500">
              <div className="text-6xl mb-4">🔐</div>
              <p className="text-lg font-semibold mb-2">No Permissions Found</p>
              <p className="text-sm">
                {selectedUserId 
                  ? `User "${selectedUserId}" has no chat permissions yet.`
                  : 'Select a user to view their permissions.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Chat ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Role
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Granted At
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Granted By
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {permissions.map((permission) => (
                    <tr 
                      key={`${permission.userId}-${permission.chatId}`}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {permission.chatId}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          permission.role === 'admin' 
                            ? 'bg-purple-100 text-purple-800'
                            : permission.role === 'member'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {permission.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(permission.grantedAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {permission.grantedBy}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => setRevokeConfirm(permission)}
                          className="text-red-600 hover:text-red-900 font-medium"
                        >
                          🗑️ Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Load More Button */}
          {hasMore && (
            <div className="p-4 border-t bg-gray-50 text-center">
              <button
                onClick={handleLoadMore}
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {loading ? '⏳ Loading...' : '📄 Load More'}
              </button>
            </div>
          )}

          {/* Loading Indicator */}
          {loading && permissions.length === 0 && (
            <div className="p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600">Loading permissions...</p>
            </div>
          )}
        </div>
      </div>

      {/* Grant Permission Modal */}
      {showGrantModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">
                Grant Permission
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    User ID <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={grantUserId}
                    onChange={(e) => setGrantUserId(e.target.value)}
                    placeholder="e.g., user-456"
                    className="w-full px-4 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Chat ID <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={grantChatId}
                    onChange={(e) => setGrantChatId(e.target.value)}
                    placeholder="e.g., chat-123"
                    className="w-full px-4 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Role <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={grantRole}
                    onChange={(e) => setGrantRole(e.target.value as any)}
                    className="w-full px-4 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="viewer">Viewer (Read-only)</option>
                    <option value="member">Member (Read/Write)</option>
                    <option value="admin">Admin (Full Access)</option>
                  </select>
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setShowGrantModal(false)}
                  disabled={grantLoading}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGrantPermission}
                  disabled={grantLoading || !grantUserId.trim() || !grantChatId.trim()}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  {grantLoading ? '⏳ Granting...' : '✅ Grant Permission'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Revoke Confirmation Modal */}
      {revokeConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">
                Confirm Revoke Permission
              </h3>
              
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-gray-700">
                  Are you sure you want to revoke this permission?
                </p>
                <div className="mt-3 space-y-2 text-sm">
                  <div>
                    <span className="font-semibold">User:</span> {revokeConfirm.userId}
                  </div>
                  <div>
                    <span className="font-semibold">Chat:</span> {revokeConfirm.chatId}
                  </div>
                  <div>
                    <span className="font-semibold">Role:</span> {revokeConfirm.role}
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setRevokeConfirm(null)}
                  disabled={revokeLoading}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleRevokePermission(revokeConfirm)}
                  disabled={revokeLoading}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  {revokeLoading ? '⏳ Revoking...' : '🗑️ Revoke'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
