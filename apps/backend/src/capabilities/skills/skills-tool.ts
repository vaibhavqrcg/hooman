import { tool, jsonSchema } from "ai";
import { getSkillContent } from "./skills-cli.js";

export const readSkillTool = tool({
  description:
    "Read the full instructions (SKILL.md) for an installed skill by its id. Use when you need to follow a skill's procedures. Pass the skill_id (e.g. pptx, pdf, docx) from the available skills list.",
  inputSchema: jsonSchema({
    type: "object",
    properties: {
      skill_id: {
        type: "string",
        description: "The skill id (directory name, e.g. pptx, pdf, docx)",
      },
    },
    required: ["skill_id"],
    additionalProperties: true,
  }),
  execute: async (input: unknown) => {
    const skillId =
      typeof (input as { skill_id?: string })?.skill_id === "string"
        ? (input as { skill_id: string }).skill_id.trim()
        : "";
    if (!skillId) return "Error: skill_id is required.";
    const content = await getSkillContent(skillId);
    return content ?? "Skill not found.";
  },
});
