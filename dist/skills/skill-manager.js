import { readdir } from "fs/promises";
import { join } from "path";

export class SkillManager {
    skills = new Map();
    claudeClient = null;

    constructor() {}

    setClaudeClient(client) {
        this.claudeClient = client;
    }

    /**
     * Auto-discovery et chargement de tous les skills
     */
    async loadSkills() {
        const skillsDir = "/opt/diva-embedded/dist/skills";
        const files = await readdir(skillsDir);
        
        for (const file of files) {
            if (file.endsWith(".js") && file !== "skill-manager.js") {
                const skillPath = join(skillsDir, file);
                try {
                    const skillModule = await import(`file://${skillPath}`);
                    const skill = skillModule.default || skillModule.skill;
                    
                    if (skill && skill.name) {
                        this.skills.set(skill.name, skill);
                        
                        // Enregistrer les tools du skill
                        if (skill.tools && this.claudeClient) {
                            for (const tool of skill.tools) {
                                this.claudeClient.registerTool(tool.name, (input) => 
                                    skill.handler(tool.name, input)
                                );
                            }
                        }
                        
                        console.log(`[Skills] Loaded ${skill.name}: ${skill.description}`);
                    }
                } catch (err) {
                    console.error(`[Skills] Failed to load ${file}:`, err.message);
                }
            }
        }
        
        console.log(`[Skills] Loaded ${this.skills.size} skills total`);
    }

    /**
     * Obtenir un skill par nom
     */
    getSkill(name) {
        return this.skills.get(name);
    }

    /**
     * Lister tous les skills
     */
    listSkills() {
        return Array.from(this.skills.values());
    }
}

export const skillManager = new SkillManager();
