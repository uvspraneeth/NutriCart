import { redirect } from 'next/navigation'
import { LockKeyhole } from 'lucide-react'
import { LoginForm } from '@/components/admin/login-form'
import { isStaff, missingAdminConfig } from '@/lib/admin/session'

export default async function AdminLoginPage() {
  if (await isStaff()) redirect('/admin')
  const missing = missingAdminConfig()
  return (
    <section className="screen narrow-screen admin-login">
      <div className="pulse-ring"><LockKeyhole size={30} /></div>
      <h1>Staff sign-in</h1>
      <p className="lead">Enter the store PIN to register products and manage stock.</p>
      {missing.length ? (
        <p className="admin-alert">Admin access isn’t set up yet. Add {missing.join(', ')} to the server environment and restart.</p>
      ) : <LoginForm />}
    </section>
  )
}
