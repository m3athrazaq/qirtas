// A failure while drawing part of the screen must never blank the whole app.
import { Component, type ReactNode } from 'react'
import { t } from '../lib/i18n'

/** For helpers drawn over the editor (table handles, toolbars): hide on error, try again a moment
 *  later (a few times; after that they stay hidden until the page is opened again). */
export class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  private timer = 0
  private failures = 0

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('[qirtas] overlay failed', error)
    clearTimeout(this.timer)
    if (++this.failures <= 3) this.timer = window.setTimeout(() => this.setState({ failed: false }), 1000)
  }

  componentWillUnmount() {
    clearTimeout(this.timer)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** Last line of defence for the whole app: a short message and a reload button. Pages are saved on the device. */
export class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('[qirtas] app failed', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="app-crash" role="alert">
        <p>{t('appCrashed')}</p>
        <button type="button" className="btn btn-primary" onClick={() => location.reload()}>
          {t('reload')}
        </button>
      </div>
    )
  }
}
