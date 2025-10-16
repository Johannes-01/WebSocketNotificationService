/**
 * Permissions Service
 * Handles all permission-related API calls
 */

export interface Permission {
  userId: string;
  chatId: string;
  role: 'admin' | 'member' | 'viewer';
  grantedAt: string;
  grantedBy: string;
}

export interface ListPermissionsResponse {
  permissions: Permission[];
  count: number;
  scannedCount: number;
  nextStartKey?: string;
}

export interface GrantPermissionRequest {
  targetUserId: string;
  chatId: string;
  role: 'admin' | 'member' | 'viewer';
}

export interface RevokePermissionRequest {
  userId: string;
  chatId: string;
}

class PermissionsService {
  private getApiUrl(): string {
    const endpoint = process.env.NEXT_PUBLIC_HTTP_PUBLISH_ENDPOINT;
    if (!endpoint) {
      throw new Error('NEXT_PUBLIC_HTTP_PUBLISH_ENDPOINT not configured');
    }
    // Extract base URL (remove /publish if present)
    return endpoint.replace(/\/publish$/, '');
  }

  /**
   * List permissions for a user
   * @param userId - User ID to list permissions for
   * @param token - Cognito JWT token
   * @param startKey - Optional pagination token
   * @param limit - Optional limit (default 50, max 100)
   */
  async listPermissions(
    userId: string,
    token: string,
    startKey?: string,
    limit: number = 50
  ): Promise<ListPermissionsResponse> {
    const baseUrl = this.getApiUrl();
    const params = new URLSearchParams({
      userId,
      limit: limit.toString(),
    });

    if (startKey) {
      params.append('startKey', startKey);
    }

    const response = await fetch(`${baseUrl}/permissions?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list permissions: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Grant permission to a user for a chat
   * @param request - Permission grant request
   * @param token - Cognito JWT token
   */
  async grantPermission(
    request: GrantPermissionRequest,
    token: string
  ): Promise<{ message: string }> {
    const baseUrl = this.getApiUrl();

    const response = await fetch(`${baseUrl}/permissions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to grant permission: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Revoke permission from a user for a chat
   * @param request - Permission revoke request
   * @param token - Cognito JWT token
   */
  async revokePermission(
    request: RevokePermissionRequest,
    token: string
  ): Promise<{ message: string }> {
    const baseUrl = this.getApiUrl();
    const params = new URLSearchParams({
      userId: request.userId,
      chatId: request.chatId,
    });

    const response = await fetch(`${baseUrl}/permissions?${params.toString()}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to revoke permission: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Get all permissions for multiple users (batch)
   * Note: This makes multiple API calls - use sparingly
   */
  async batchListPermissions(
    userIds: string[],
    token: string
  ): Promise<Map<string, Permission[]>> {
    const results = new Map<string, Permission[]>();

    await Promise.all(
      userIds.map(async (userId) => {
        try {
          const response = await this.listPermissions(userId, token);
          results.set(userId, response.permissions);
        } catch (error) {
          console.error(`Failed to fetch permissions for ${userId}:`, error);
          results.set(userId, []);
        }
      })
    );

    return results;
  }
}

export const permissionsService = new PermissionsService();
