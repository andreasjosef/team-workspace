import { Role } from '@app/shared';
import { Link, NavLink, Outlet, useParams } from 'react-router';
import { useRoles } from './queries.ts';

const taglines: Record<Role, string> = {
  dev: 'Review what the team and its agents propose',
  po: 'Decisions, docs and changes with a preview',
  cs: 'From customer report to proposed fix',
};

// No auth in the demo: the role is picked here and travels in the URL. The
// hub still checks it on every approval against the role policies.
export const Layout = () => {
  const role = Role.safeParse(useParams().role);
  const roles = useRoles().data ?? [];

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          Team Workspace
          {role.success && <small>{taglines[role.data]}</small>}
        </Link>
        <nav className="tabs" aria-label="Role">
          {(roles.length
            ? roles
            : Role.options.map((name) => ({ name, label: name }))
          ).map((r) => (
            <NavLink
              key={r.name}
              to={`/${r.name}`}
              className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}
            >
              {r.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  );
};
