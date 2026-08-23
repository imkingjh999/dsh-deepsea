/**
 * Client half of dsh-deepsea: mounts the Deep-Sea Fishing floating window.
 *
 * Static inject: `sessions` is a core web-app service (always present), so a
 * hard edge is safe here and gives us the projections feed directly. The
 * locale service stays a soft runtime fiber (absent → zh fallback) exactly
 * like dsh-shorts-wall: a missing locale must never block the window.
 */
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { attachLocale } from './locale.ts'
import { FloatingShell } from './shell.tsx'

interface ClientContext {
  effect(callback: () => () => void, label?: string): () => void
  inject(dependencies: string[], callback: (ctx: InjectedContext) => void): unknown
}
interface InjectedContext {
  effect(callback: () => () => void, label?: string): () => void
  locale?: import('./locale.ts').LocaleService
  sessions?: SessionsLike
}

/** The slice of ctx.sessions the ocean needs (harness contract/sessions.ts). */
export interface SessionsLike {
  list: { getSnapshot(): { current?: string }, subscribe?(fn: () => void): () => void }
  binding(id: string): { session?: SessionLike } | undefined
}
export interface SessionLike {
  subscribe(fn: () => void): () => void
  getSnapshot(): { running?: boolean }
  projections?: {
    faceOf(key: string): { getSnapshot(): unknown, subscribe(fn: () => void): () => void } | undefined
  }
}

/** Late-bound service reference (the sessions fiber may arrive after mount). */
export interface SessionsRef { get(): SessionsLike | undefined }

export function apply(ctx: ClientContext): void {
  let sessions: SessionsLike | undefined

  ctx.inject(['locale'], (lctx) => {
    lctx.effect(() => attachLocale(lctx.locale), 'deepsea: attach locale')
  })

  ctx.inject(['sessions'], (sctx) => {
    sessions = sctx.sessions
  })

  ctx.effect(() => {
    const host = document.createElement('div')
    host.setAttribute('data-dsh-deepsea', '')
    document.body.appendChild(host)
    const sessionsRef: SessionsRef = { get: () => sessions }
    const root = createRoot(host)
    root.render(<FloatingShell sessionsRef={sessionsRef} />)
    return () => {
      try { root.unmount() } catch { /* already gone */ }
      host.remove()
    }
  }, 'deepsea: floating window')
}
