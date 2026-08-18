/**
 * @slothtron/dsh-fff browser half: the settings card that flips the helper's
 * background file watcher on and off at runtime.
 *
 * The card registers into the shared `settings.plugin.item` slot keyed by the
 * `dsh-fff` settings namespace the Host half serves. It reads and writes only
 * through `ctx.settingsScope`, so the Host remains the authority on whether a
 * change landed. The card is self-contained: it does not import the shipped
 * plugin-card chrome (a client bundle purity gate forbids value imports across
 * plugins), so it renders its own minimal controls.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactElement } from 'react'
import type {} from './slot-contract.ts'
import { WatchCard } from './WatchCard.tsx'

/** Settings namespace the Host half registers; the slot key matches it. */
const NS = 'dsh-fff'

/** The one knob the card edits. */
interface FffSettings {
  enableWatch?: boolean
}

/** Card state the component reads through the bound snapshot store. */
export interface FffCardState {
  available: boolean
  writable: boolean
  enabled: boolean
  saving: boolean
  failed: boolean
}

/** Registration face the slot entry injects. */
export interface FffCardFace {
  hooks: {
    fffCard: SnapshotStore<FffCardState>
  }
  toggle: () => void
}

/** Props the renderer binds for the card. */
export type FffCardProps =
  PropsRuntime<'settings.plugin.item'>
  & InjectFace<FffCardFace>

/** Bridge the `dsh-fff` settings scope onto the card's staged state. */
class FffCardController {
  private readonly store: SnapshotStore<FffCardState>
  private saving = false
  private failed = false

  constructor(private readonly scope: SettingsScope<FffSettings>) {
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => { this.publish() })
  }

  private snapshot(): SettingsScopeSnapshot<FffSettings> {
    return this.scope.getSnapshot()
  }

  private projection(): FffCardState {
    const s = this.snapshot()
    return {
      available: s.status === 'ready',
      writable: s.writable,
      enabled: s.value?.enableWatch === true,
      saving: this.saving,
      failed: this.failed,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  /** Flip the watch switch and persist through the settings scope. */
  async toggle(): Promise<void> {
    if (this.saving) return
    const current = this.projection().enabled
    this.saving = true
    this.failed = false
    this.publish()
    try {
      await this.scope.set('enableWatch', !current)
      this.failed = this.projection().enabled === current
    } catch {
      this.failed = true
    }
    this.saving = false
    this.publish()
  }

  inject(): FffCardFace {
    return {
      hooks: { fffCard: this.store },
      toggle: () => { void this.toggle() },
    }
  }
}

/** Required browser services: the slots registry and the settings scope. */
export const inject = ['slots', 'settingsScope']

/**
 * Mount the settings card. The card joins the shared plugin configuration
 * tab; the Host half's namespace registration is what makes the tab dispatch
 * this key at all.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  const scope = ctx.settingsScope.bind<FffSettings>({ namespace: NS })
  const controller = new FffCardController(scope)
  const face = controller.inject()
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: NS,
    inject: () => face,
  }, ((props: FffCardProps): ReactElement => <WatchCard {...props} />)))
}
