/**
 * The persistent floating shell — a thin wrapper around the shared
 * dsh-float-window component, laid out exactly like dsh-shorts-wall's
 * shell: text-labelled minimize button, a declared boss-key combo (the
 * registry keeps windows from colliding), and children-as-function so the
 * ocean pauses while the window is minimized instead of remounting.
 */
import type { ReactNode } from 'react'
import { FloatWindow } from 'dsh-float-window'
import { tr } from './locale.ts'
import type { SessionsRef } from './index.tsx'
import { OceanApp } from './ocean.tsx'

const ACCENT = '#7fc4ff'

export function FloatingShell(props: { sessionsRef: SessionsRef }): ReactNode {
  return (
    <FloatWindow
      storageKey="dsh-deepsea:shell"
      title={tr('shell.title')}
      accent={ACCENT}
      launcherGlyph="🎣"
      defaultW={430}
      defaultH={720}
      minW={320}
      minH={420}
      defaultMode="float"
      bossKey="Alt+X"
      labels={{
        openTitle: tr('shell.open'),
        expandTitle: tr('shell.expand'),
        minimizeTitle: tr('shell.minimize'),
        modeToggleTip: tr('shell.modeToggle'),
        floatText: tr('shell.floatText'),
        bossKeyText: tr('shell.bossKey'),
        maximizeTitle: tr('shell.maximize'),
        restoreTitle: tr('shell.restore'),
      }}
    >
      {(visible: boolean) => (
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <OceanApp sessionsRef={props.sessionsRef} visible={visible} />
        </div>
      )}
    </FloatWindow>
  )
}