import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Check if the user is authenticated by looking for session tokens
  const session = request.cookies.get('session');

  // List of paths that don't require authentication
  const publicPaths = ['/signin', '/signup'];
  const isPublicPath = publicPaths.some(path => request.nextUrl.pathname.startsWith(path));

  if (!session && !isPublicPath) {
    // Redirect to signin page if not authenticated and trying to access protected route
    const signinUrl = new URL('/signin', request.url);
    signinUrl.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(signinUrl);
  }

  if (session && isPublicPath) {
    // Redirect to home page if authenticated and trying to access auth pages
    return NextResponse.redirect(new URL('/', request.url));
  }

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