import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Since we're using Cognito with client-side authentication (localStorage),
  // we can't reliably check auth state in middleware (which runs server-side).
  // Authentication checks are handled client-side in the AuthProvider and page components.
  
  // We only handle basic redirects here for better UX
  return NextResponse.next();
}

export const config = {
  // Specify which paths this middleware will run on
  matcher: [
    /*
     * Match all paths except:
     * 1. /api routes
     * 2. /_next (Next.js internals)
     * 3. /static (public files)
     * 4. all files in public folder
     */
    '/((?!api|_next|static|favicon.ico|.*\\.(?:jpg|jpeg|gif|png|svg|ico)).*)',
  ],
};