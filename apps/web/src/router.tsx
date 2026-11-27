import { Role } from '@app/shared';
import { createBrowserRouter, Navigate, useParams } from 'react-router';
import { Layout } from './Layout.tsx';
import { CsView } from './pages/CsView.tsx';
import { TaskPage } from './pages/TaskPage.tsx';
import { DiffPrototypePage } from './pages/DiffPrototype.prototype.tsx';

// The product is the support rep's view. A task page still works under any
// role's URL (`/dev/tasks/:id`), but only cs has a home. Developers review
// on the pull request, not here.
const RoleHome = () => {
  const role = Role.safeParse(useParams().role);
  if (!role.success || role.data !== 'cs') return <Navigate to="/cs" replace />;
  return <CsView />;
};

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/cs" replace />,
  },
  {
    path: '/:role',
    element: <Layout />,
    children: [
      { index: true, element: <RoleHome /> },
      { path: 'tasks/:id', element: <TaskPage /> },
      // PROTOTYPE, throwaway: Changes tab variants on a sample diff.
      { path: 'prototype/diff', element: <DiffPrototypePage /> },
    ],
  },
]);
