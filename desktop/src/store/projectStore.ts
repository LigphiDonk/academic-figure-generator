import { create } from 'zustand';
import type { Project } from '../types/models';
import { projectService } from '../services/projectService';

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  isLoading: boolean;
  refreshProjects: () => Promise<void>;
  openProject: (id: string) => Promise<Project | null>;
  setCurrentProject: (project: Project | null) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProject: null,
  isLoading: false,
  refreshProjects: async () => {
    set({ isLoading: true });
    const projects = await projectService.listProjects();
    set({ projects, isLoading: false });
  },
  openProject: async (id) => {
    set({ isLoading: true });
    const project = await projectService.getProject(id);
    set({ currentProject: project, isLoading: false });
    return project;
  },
  setCurrentProject: (project) => set({ currentProject: project }),
}));
