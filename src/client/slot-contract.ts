/**
 * The `settings.plugin.item` slot type, declared locally so the dsh-fff
 * client bundle type-checks without depending on the package that declares it
 * at runtime (`@deepseek-ai/dsh-client-ui-settings-plugins`). The slot is
 * keyed by settings namespace and has no owner props; the card renders its
 * own internals. This mirrors the declarer's contract.
 */

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.plugin.item': { kind: 'keyed'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}
