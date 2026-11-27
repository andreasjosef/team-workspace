import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, unwrap } from './api.ts';
import { mine, useMyTaskIds } from './myTasks.ts';

// The shared reads every view uses. Lists poll: simple, and plenty for a
// demo with a handful of tasks. A single task's live log uses the WebSocket.

export const useRoles = () =>
  useQuery({
    queryKey: ['roles'],
    queryFn: async () => unwrap(await api.roles()),
    staleTime: Infinity,
  });

export const useDocs = () =>
  useQuery({
    queryKey: ['docs'],
    queryFn: async () => unwrap(await api.docs()),
  });

export const useIncidents = () =>
  useQuery({
    queryKey: ['incidents'],
    queryFn: async () => unwrap(await api.incidents()),
  });

export const useTasks = () =>
  useQuery({
    queryKey: ['tasks'],
    queryFn: async () => unwrap(await api.tasks()),
    refetchInterval: 1500,
  });

// The tasks this browser forwarded (see myTasks.ts).
export const useMyTasks = () => {
  const { data } = useTasks();
  const ids = useMyTaskIds();
  return useMemo(() => mine(data ?? [], ids), [data, ids]);
};

export const useTask = (id: string) =>
  useQuery({
    queryKey: ['task', id],
    queryFn: async () => unwrap(await api.task(id)),
    refetchInterval: 1000,
  });

export const useDiff = (id: string, enabled: boolean, version: string) =>
  useQuery({
    queryKey: ['diff', id, version],
    queryFn: async () => unwrap(await api.diff(id)),
    enabled,
  });
