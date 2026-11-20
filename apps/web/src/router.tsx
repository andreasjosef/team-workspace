import { Role } from '@app/shared';
import { createBrowserRouter, Navigate, useParams } from 'react-router';
import { Layout } from './Layout.tsx';
import { CsView } from './pages/CsView.tsx';
import { DevView } from './pages/DevView.tsx';
import { PoView } from './pages/PoView.tsx';
import { TaskPage } from './pages/TaskPage.tsx';

const views = { dev: DevView, po: PoView, cs: CsView } satisfies Record<
  Role,
  () => unknown
>;

const RoleHome = () => {
  const role = Role.safeParse(useParams().role);
  if (!role.success) return <Navigate to="/cs" replace />;
  const View = views[role.data];
  return <View />;
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
    ],
  },
]);
