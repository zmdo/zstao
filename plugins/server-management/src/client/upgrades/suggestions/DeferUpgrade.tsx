import { Dialog, DialogButton } from '@smp/console-kit/dialog'
import type { UpgradeSuggestionsModel } from './useUpgradeSuggestions.ts'

export function DeferUpgrade(props: { model: UpgradeSuggestionsModel }) {
  const { busy, c, commands, defer, remindAt, setDefer, setRemindAt } = props.model
  return (
    <Dialog
      open={defer}
      title={c.defer}
      closeLabel={c.close}
      onClose={() => setDefer('')}
      footer={
        <>
          <DialogButton onClick={() => setDefer('')}>{c.close}</DialogButton>
          <DialogButton onClick={() => void commands.remindNow()}>{c.remindNow}</DialogButton>
          <DialogButton variant="primary" disabled={busy || !remindAt} onClick={() => void commands.defer()}>
            {c.defer}
          </DialogButton>
        </>
      }
    >
      <p>{c.remindHint}</p>
      <label className="field">
        {c.remindAt}
        <input type="datetime-local" value={remindAt} onChange={(e) => setRemindAt(e.target.value)} />
      </label>
    </Dialog>
  )
}
