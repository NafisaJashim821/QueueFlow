import { Link } from 'react-router-dom';
import { ConnectionBadge } from './ui.jsx';

export default function PublicHeader({ name, connection, lastUpdated }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand"><span className="brand-mark">Q</span>{name || 'QueueFlow'}</Link>
        <span className="spacer" />
        <ConnectionBadge connection={connection} lastUpdated={lastUpdated} />
        <Link to="/staff" className="btn btn-small">Staff</Link>
      </div>
    </header>
  );
}
