import { Component, type ReactNode } from 'react';

/** If a screen crashes, say so plainly and offer a reload instead of showing a blank page. Data is in IndexedDB and unaffected. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-[560px] px-4 min-h-[100dvh] flex flex-col justify-center" role="alert">
        <div className="border-t border-border py-4 space-y-3">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p>This screen couldn't load. Your data is still saved on this device.</p>
          <button onClick={() => { window.location.hash = '#/today'; window.location.reload(); }}
            className="w-full min-h-[56px] rounded-btn bg-primary text-on-primary font-semibold">Reload</button>
          <p className="text-xs text-muted break-words">{String(this.state.error.message)}</p>
        </div>
      </div>
    );
  }
}
