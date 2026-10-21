import { contextBridge, ipcRenderer } from 'electron'

interface NoteRefInput {
  refType: 'point' | 'carrier'
  refId: string
}

contextBridge.exposeInMainWorld('sublate', {
  getPlugins: () => ipcRenderer.invoke('kernel:plugins'),
  demoPing: () => ipcRenderer.invoke('kernel:demo-ping'),
  library: {
    list: () => ipcRenderer.invoke('library:list', {}),
    pickFiles: () => ipcRenderer.invoke('library:pick-files'),
    importFiles: (paths: string[]) => ipcRenderer.invoke('library:import-files', paths),
    importUrl: (url: string) => ipcRenderer.invoke('library:import-url', { url }),
    detail: (id: string) => ipcRenderer.invoke('carrier:detail', { id }),
    file: (id: string) => ipcRenderer.invoke('carrier:file', { id }),
    pages: (id: string, from: number, to: number) =>
      ipcRenderer.invoke('carrier:pages', { id, from, to }),
    saveReadPosition: (id: string, pageNo: number, scrollRatio: number) =>
      ipcRenderer.invoke('carrier:read-position', { id, pageNo, scrollRatio }),
    remove: (id: string) => ipcRenderer.invoke('carrier:delete', { id }),
    restore: (id: string) => ipcRenderer.invoke('carrier:restore', { id }),
    trash: () => ipcRenderer.invoke('trash:list'),
    search: (text: string) => ipcRenderer.invoke('search:query', { text }),
  },
  knowledge: {
    list: (carrierId: string) => ipcRenderer.invoke('knowledge:list', { carrierId }),
    extract: (carrierId: string) => ipcRenderer.invoke('knowledge:extract', { carrierId }),
    confirm: (ids: string[]) => ipcRenderer.invoke('knowledge:confirm', { ids }),
    reject: (ids: string[]) => ipcRenderer.invoke('knowledge:reject', { ids }),
    setAnchor: (id: string, pageStart: number, pageEnd: number) =>
      ipcRenderer.invoke('knowledge:anchor', { id, pageStart, pageEnd }),
    merge: (ids: string[]) => ipcRenderer.invoke('knowledge:merge', { ids }),
    split: (id: string, splitPage: number) =>
      ipcRenderer.invoke('knowledge:split', { id, splitPage }),
  },
  course: {
    list: () => ipcRenderer.invoke('course:list', {}),
    create: (title: string, description?: string, dailyMinutes?: number) =>
      ipcRenderer.invoke('course:create', { title, description, dailyMinutes }),
    update: (id: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('course:update', { id, ...patch }),
    remove: (id: string) => ipcRenderer.invoke('course:delete', { id }),
    detail: (id: string) => ipcRenderer.invoke('course:detail', { id }),
    createUnit: (courseId: string, title: string) =>
      ipcRenderer.invoke('course:unit-create', { courseId, title }),
    updateUnit: (id: string, title: string) =>
      ipcRenderer.invoke('course:unit-update', { id, title }),
    removeUnit: (id: string) => ipcRenderer.invoke('course:unit-delete', { id }),
    addPoints: (courseId: string, unitId: string | null, pointIds: string[]) =>
      ipcRenderer.invoke('course:points-add', { courseId, unitId, pointIds }),
    removePoints: (ids: string[]) => ipcRenderer.invoke('course:points-remove', { ids }),
    movePoint: (id: string, patch: { unitId?: string | null; position?: number }) =>
      ipcRenderer.invoke('course:point-move', { id, ...patch }),
    setDepends: (id: string, dependsOn: string[]) =>
      ipcRenderer.invoke('course:depends', { id, dependsOn }),
    availablePoints: (id: string) => ipcRenderer.invoke('course:available-points', { id }),
  },
  planner: {
    goals: (courseId: string) => ipcRenderer.invoke('goal:list', { courseId }),
    createGoal: (courseId: string, title: string, targetDate?: string, dailyMinutes?: number) =>
      ipcRenderer.invoke('goal:create', { courseId, title, targetDate, dailyMinutes }),
    updateGoal: (id: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('goal:update', { id, ...patch }),
    deleteGoal: (id: string) => ipcRenderer.invoke('goal:delete', { id }),
    plans: (courseId: string) => ipcRenderer.invoke('plan:list', { courseId }),
    planDetail: (id: string) => ipcRenderer.invoke('plan:detail', { id }),
    generatePlan: (input: {
      courseId: string
      goalId?: string
      startDate?: string
      days?: number
      dailyMinutes?: number
    }) => ipcRenderer.invoke('plan:generate', input),
    replan: (id: string, dailyMinutes: number) =>
      ipcRenderer.invoke('plan:replan', { id, dailyMinutes }),
    deletePlan: (id: string) => ipcRenderer.invoke('plan:delete', { id }),
    setItemStatus: (id: string, status: 'pending' | 'done' | 'skipped') =>
      ipcRenderer.invoke('plan:item-status', { id, status }),
    moveItem: (id: string, date: string, position?: number) =>
      ipcRenderer.invoke('plan:item-move', { id, date, position }),
    today: (date?: string) => ipcRenderer.invoke('plan:today', { date }),
  },
  review: {
    queue: (limit?: number) => ipcRenderer.invoke('review:queue', { limit }),
    submit: (pointId: string, rating: 1 | 2 | 3 | 4) =>
      ipcRenderer.invoke('review:submit', { pointId, rating }),
    stats: () => ipcRenderer.invoke('review:stats', {}),
    overview: () => ipcRenderer.invoke('review:overview', {}),
    history: (pointId: string) => ipcRenderer.invoke('review:history', { pointId }),
  },
  agent: {
    start: (goal: string, budgetTokens?: number) =>
      ipcRenderer.invoke('agent:start', { goal, budgetTokens }),
    step: (sessionId: string, approved?: boolean) =>
      ipcRenderer.invoke('agent:step', { sessionId, approved }),
    cancel: (sessionId: string) => ipcRenderer.invoke('agent:cancel', { sessionId }),
    sessions: () => ipcRenderer.invoke('agent:sessions', {}),
    session: (id: string) => ipcRenderer.invoke('agent:session', { id }),
  },
  notes: {
    list: (options?: { includeDeleted?: boolean; query?: string }) =>
      ipcRenderer.invoke('note:list', options ?? {}),
    trash: () => ipcRenderer.invoke('note:trash', {}),
    detail: (id: string) => ipcRenderer.invoke('note:detail', { id }),
    create: (input: { title: string; body?: string; refs?: NoteRefInput[] }) =>
      ipcRenderer.invoke('note:create', input),
    update: (id: string, patch: { title?: string; body?: string; refs?: NoteRefInput[] }) =>
      ipcRenderer.invoke('note:update', { id, ...patch }),
    remove: (id: string) => ipcRenderer.invoke('note:delete', { id }),
    restore: (id: string) => ipcRenderer.invoke('note:restore', { id }),
    purge: (id: string) => ipcRenderer.invoke('note:purge', { id }),
    forRef: (refType: 'point' | 'carrier', refId: string) =>
      ipcRenderer.invoke('note:for-ref', { refType, refId }),
    refOptions: () => ipcRenderer.invoke('note:ref-options', {}),
  },
  sets: {
    list: () => ipcRenderer.invoke('set:list', {}),
    detail: (id: string) => ipcRenderer.invoke('set:detail', { id }),
    create: (title: string, description?: string) =>
      ipcRenderer.invoke('set:create', { title, description }),
    update: (id: string, patch: { title?: string; description?: string }) =>
      ipcRenderer.invoke('set:update', { id, ...patch }),
    remove: (id: string) => ipcRenderer.invoke('set:delete', { id }),
    addNodes: (id: string, nodes: { kind: 'point' | 'carrier'; refId: string }[]) =>
      ipcRenderer.invoke('set:add-nodes', { id, nodes }),
    removeNode: (id: string, nodeId: string) =>
      ipcRenderer.invoke('set:remove-node', { id, nodeId }),
    addEdge: (
      id: string,
      input: { sourceId: string; targetId: string; kind: 'prereq' | 'related' },
    ) => ipcRenderer.invoke('set:add-edge', { id, ...input }),
    removeEdge: (id: string, edgeId: string) =>
      ipcRenderer.invoke('set:remove-edge', { id, edgeId }),
    options: () => ipcRenderer.invoke('set:options', {}),
  },
})
