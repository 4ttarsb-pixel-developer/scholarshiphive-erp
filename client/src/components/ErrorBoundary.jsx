import { Component } from 'react';
import { RefreshCw, Home, LifeBuoy } from 'lucide-react';
import { isChunkError, reloadOnceForChunk, reportError } from '../lib/errors.js';

/** Catches crashes inside a page so the rest of the app keeps working. */
export default class ErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    if (isChunkError(error) && reloadOnceForChunk()) return;
    console.error(error);
    reportError(error, { component: String(info?.componentStack || '').slice(0, 600) });
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkError(error);
    return (
      <div className="card card-pad crash-card" role="alert">
        <div className="crash-icon"><LifeBuoy /></div>
        <h3>{chunk ? 'A new version of the ERP is available' : 'Something went wrong on this page'}</h3>
        <p className="muted">{chunk ? 'Please reload to continue.' : 'Your data is safe. Reload the page; if it happens again, tell admin what you clicked.'}</p>
        {!chunk && <p className="small muted" data-no-translate style={{ wordBreak: 'break-word' }}>{String(error.message || error).slice(0, 200)}</p>}
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => window.location.reload()}><RefreshCw />Reload page</button>
          {!this.props.full && <button className="btn" onClick={() => { this.setState({ error: null }); window.location.assign('/'); }}><Home />Go to dashboard</button>}
        </div>
      </div>
    );
  }
}
