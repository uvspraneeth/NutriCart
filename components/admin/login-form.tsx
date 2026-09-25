'use client'

import { useActionState } from 'react'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { login, type LoginState } from '@/app/admin/actions'

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, {} as LoginState)
  return (
    <form action={formAction} className="form-panel admin-login-form">
      <label>PIN<input name="pin" type="password" inputMode="numeric" autoComplete="current-password" required autoFocus /></label>
      {state.error && <p className="admin-error" role="alert">{state.error}</p>}
      <button className="primary-action" disabled={pending}>{pending ? <LoaderCircle className="spin" size={18} /> : <>Sign in <ArrowRight size={18} /></>}</button>
    </form>
  )
}
