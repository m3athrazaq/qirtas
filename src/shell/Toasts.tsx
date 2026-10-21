import { useStore } from '../data/store'

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className="toast">
          <span>{x.text}</span>
          {x.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                x.action!.run()
                dismiss(x.id)
              }}
            >
              {x.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
