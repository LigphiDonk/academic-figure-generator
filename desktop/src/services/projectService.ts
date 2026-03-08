import { isoNow } from '../lib/utils';
import type { Project } from '../types/models';
import { mutateSnapshot, readSnapshot } from './storage';

function hydrateProject(snapshotProject: Project, snapshot: Awaited<ReturnType<typeof readSnapshot>>): Project {
  return {
    ...snapshotProject,
    documentCount: snapshot.documents.filter((item) => item.projectId === snapshotProject.id).length,
    promptCount: snapshot.prompts.filter((item) => item.projectId === snapshotProject.id).length,
    imageCount: snapshot.images.filter((item) => item.projectId === snapshotProject.id).length,
  };
}

export class ProjectService {
  async listProjects(): Promise<Project[]> {
    const snapshot = await readSnapshot();
    return snapshot.projects.filter((project) => project.status === 'active').map((project) => hydrateProject(project, snapshot)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getProject(id: string): Promise<Project | null> {
    const snapshot = await readSnapshot();
    const project = snapshot.projects.find((item) => item.id === id && item.status !== 'deleted');
    return project ? hydrateProject(project, snapshot) : null;
  }

  async createProject(input: { name: string; description?: string; paperField?: string; colorScheme?: string }): Promise<Project> {
    return mutateSnapshot((snapshot) => {
      const timestamp = isoNow();
      const project: Project = {
        id: crypto.randomUUID(),
        name: input.name,
        description: input.description,
        paperField: input.paperField,
        colorScheme: input.colorScheme ?? 'okabe-ito',
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
        documentCount: 0,
        promptCount: 0,
        imageCount: 0,
      };
      snapshot.projects.push(project);
      return project;
    });
  }

  async updateProject(id: string, input: Partial<Pick<Project, 'name' | 'description' | 'paperField' | 'colorScheme'>>): Promise<Project> {
    return mutateSnapshot((snapshot) => {
      const project = snapshot.projects.find((item) => item.id === id && item.status !== 'deleted');
      if (!project) throw new Error('项目不存在');
      Object.assign(project, input);
      project.updatedAt = isoNow();
      return hydrateProject(project, snapshot);
    });
  }

  async deleteProject(id: string): Promise<void> {
    await mutateSnapshot((snapshot) => {
      snapshot.projects = snapshot.projects.filter((item) => item.id !== id);
      snapshot.documents = snapshot.documents.filter((item) => item.projectId !== id);
      snapshot.prompts = snapshot.prompts.filter((item) => item.projectId !== id);
      snapshot.images = snapshot.images.filter((item) => item.projectId !== id);
      snapshot.usageLogs = snapshot.usageLogs.filter((item) => item.projectId !== id);
    });
  }

  async touchProject(id: string): Promise<void> {
    await mutateSnapshot((snapshot) => {
      const project = snapshot.projects.find((item) => item.id === id);
      if (project) project.updatedAt = isoNow();
    });
  }
}

export const projectService = new ProjectService();
