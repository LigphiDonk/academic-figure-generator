import promptSource from '../../../../backend/app/core/prompts/system_prompt.py?raw';

function extractPrompt(name: 'ACADEMIC_FIGURE_SYSTEM_PROMPT' | 'TEMPLATE_FIGURE_SYSTEM_PROMPT'): string {
  const pattern = new RegExp(`${name}\\s*=\\s*"""([\\s\\S]*?)"""`);
  const match = promptSource.match(pattern);
  if (!match) {
    throw new Error(`Unable to load ${name} from backend/app/core/prompts/system_prompt.py`);
  }
  return match[1].trim();
}

export const ACADEMIC_FIGURE_SYSTEM_PROMPT = extractPrompt('ACADEMIC_FIGURE_SYSTEM_PROMPT');
export const TEMPLATE_FIGURE_SYSTEM_PROMPT = extractPrompt('TEMPLATE_FIGURE_SYSTEM_PROMPT');
