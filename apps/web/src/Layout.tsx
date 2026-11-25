import { Role } from '@app/shared';
import { Link, Outlet, useParams } from 'react-router';

// No auth in the demo: the role travels in the URL, and the hub checks it on
// every approval against the role policies. The support rep's view is the
// product; a developer only lands here from a review link.
export const Layout = () => {
  const role = Role.safeParse(useParams().role);
  const reviewing = role.success && role.data !== 'cs';

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/cs" className="brand">
          Team Workspace
          <small>From customer report to proposed fix</small>
        </Link>
        {reviewing && (
          <span className="topbar-note">Reviewing as {role.data}</span>
        )}
      </header>
      <Outlet />
    </div>
  );
};
