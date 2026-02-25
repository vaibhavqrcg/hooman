import {
  listSkillsFromFs,
  getSkillContent,
  addSkill,
  removeSkills,
  type SkillEntry,
  type SkillsRunResult,
} from "./skills-cli.js";

export interface SkillService {
  list(): Promise<SkillEntry[]>;
  getContent(id: string): Promise<string | null>;
  /** Formatted "Available skills" section for agent system prompt (name + description per skill). */
  getSkillsMetadataSection(): Promise<string>;
  add(options: {
    package: string;
    skills?: string[];
  }): Promise<SkillsRunResult>;
  remove(skillNames: string[]): Promise<SkillsRunResult>;
}

export function createSkillService(): SkillService {
  return {
    async list() {
      return listSkillsFromFs();
    },
    async getContent(id: string) {
      return getSkillContent(id);
    },
    async getSkillsMetadataSection() {
      const skills = await listSkillsFromFs();
      if (skills.length === 0) return "";
      const lines = skills.map(
        (s) => `- **${s.name}**: ${s.description?.trim() || "No description."}`,
      );
      return `\n\nAvailable skills (use when relevant):\n${lines.join("\n")}`;
    },
    async add(options) {
      return addSkill(options);
    },
    async remove(skillNames) {
      return removeSkills(skillNames);
    },
  };
}
