/**
 * The watch toggle card. Renders nothing while the `dsh-fff` namespace is not
 * served, and disables the switch while the Host document is read-only.
 */

import type { FffCardProps } from './index.tsx'
import css from './WatchCard.module.css'

/** Render the watch card. @param props - the card snapshot and toggle action. */
export function WatchCard(props: FffCardProps) {
  const state = props.useFffCard(snapshot => snapshot)
  if (!state.available) return null
  return (
    <li className={css.card}>
      <div className={css.head}>
        <span className={css.title}>fff 文件搜索</span>
        <span className={css.description}>控制常驻 fff 索引是否实时监听工作区文件变动</span>
      </div>
      <div className={css.body}>
        <label className={css.row}>
          <input
            type="checkbox"
            checked={state.enabled}
            disabled={!state.writable || state.saving}
            onChange={() => { props.toggle() }}
          />
          <span className={css.rowText}>
            <span className={css.label}>启用文件监听（watch）</span>
            <span className={css.hint}>
              开启后工作区内文件增删改会实时反映到搜索结果；关闭则为快照语义（切换工作区时重建索引）。
            </span>
          </span>
        </label>
        {state.failed
          ? <p className={css.failed} role="status">保存失败，请重试</p>
          : null}
      </div>
    </li>
  )
}
