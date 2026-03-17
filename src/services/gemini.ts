import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function generateAutomationScript(
  prompt: string, 
  platform: 'kaggle' | 'colab' | 'local',
  context: {
    datasets: any[];
    models: any[];
    gpuEnabled: boolean;
    gpuType?: string;
    gpuCount?: number;
    internetEnabled: boolean;
    venv?: { type: string; name: string };
  }
) {
  const model = ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: `
      You are an AI automation expert for ${platform} notebooks.
      
      CONTEXT:
      - GPU Acceleration: ${context.gpuEnabled ? `ENABLED (${context.gpuCount || 1}x ${context.gpuType || 'T4'})` : 'DISABLED'}
      - Internet Access: ${context.internetEnabled ? 'ENABLED' : 'DISABLED'}
      - Virtual Environment: ${context.venv?.type} (${context.venv?.name})
      
      AVAILABLE DATASETS:
      ${context.datasets.map(d => `- ${d.name} (${d.format})`).join('\n')}
      
      AVAILABLE MODELS:
      ${context.models.map(m => `- ${m.name} (${m.framework})`).join('\n')}

      USER REQUIREMENTS:
      "${prompt}"
      
      Generate a Python script that:
      1. Handles dataset loading (assume they are in the current directory or standard platform paths).
      2. Implements a training loop with error handling (try-except).
      3. Implements periodic autosave to prevent data loss from crashes.
      4. Logs metrics (loss, accuracy, progress) in a format that can be parsed (e.g., JSON lines).
      5. Can resume from a checkpoint if available.
      6. If GPU is enabled, use appropriate acceleration (CUDA/MPS).
      7. If Internet is disabled, do not attempt to download external weights or datasets.
      
      Output ONLY the Python code block.
    `,
  });

  const response = await model;
  return response.text;
}

export async function analyzeError(errorLog: string) {
  const model = ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: `
      Analyze this training error and provide a fix:
      ${errorLog}
      
      Provide a concise explanation and the corrected code snippet.
    `,
  });

  const response = await model;
  return response.text;
}
