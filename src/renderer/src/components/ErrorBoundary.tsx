import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Shown in the fallback so the operator knows which part failed. */
  area?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer error', error, info.componentStack)
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="m-4 panel p-4">
        <p className="label text-err">Something went wrong{this.props.area ? ` in ${this.props.area}` : ''}</p>
        <p className="mt-2 font-mono text-xs">{this.state.error.message}</p>
        <p className="muted mt-3">Your data on disk is unaffected. Try again; if it repeats, send the log file from Settings.</p>
        <button type="button" className="btn mt-4" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}
