import { NextResponse, type NextRequest } from 'next/server'

// Optimistic check only: bounce visitors without a staff cookie to the PIN screen. The cookie's signature
// is verified by requireStaff() in every admin page and server action.
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/admin/login' || request.cookies.has('nc_admin')) return NextResponse.next()
  return NextResponse.redirect(new URL('/admin/login', request.url))
}

export const config = {
  matcher: '/admin/:path*',
}
