// services/ollama.service.js
import "dotenv/config";

const getOllamaBaseUrl = () =>
  (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");

/**
 * Quick reachability check for Ollama.
 */
export const isOllamaReachable = async (timeoutMs = 2000) => {
  const baseUrl = getOllamaBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * Checks whether Ollama is reachable and whether configured models exist.
 * Prints the exact `ollama pull <model>` command if a model is missing.
 */
export const checkOllamaHealth = async () => {
  const baseUrl = getOllamaBaseUrl();
  const llmModel = process.env.OLLAMA_LLM_MODEL || "qwen2.5:7b";
  const embeddingModel =
    process.env.OLLAMA_EMBEDDING_MODEL || "embeddinggemma-2:270m";

  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000)
    });

    if (!res.ok) {
      console.error(
        `\n[OLLAMA HEALTH] Ollama at ${baseUrl} responded with HTTP ${res.status}.`
      );
      return { reachable: false, missingModels: [] };
    }

    const data = await res.json();
    const available = (data.models || []).map((m) => m.name || m.model || "");

    const modelExists = (target) => {
      if (!target) return true;
      const targetWithLatest = target.includes(":") ? target : `${target}:latest`;
      return available.some((name) => {
        const nameWithLatest = name.includes(":") ? name : `${name}:latest`;
        return (
          name === target ||
          nameWithLatest === targetWithLatest ||
          name.startsWith(`${target}:`)
        );
      });
    };

    const missing = [];
    if (!modelExists(llmModel)) {
      missing.push(llmModel);
    }
    if (!modelExists(embeddingModel)) {
      missing.push(embeddingModel);
    }

    if (missing.length > 0) {
      console.error("\n=======================================================");
      console.error("[OLLAMA HEALTH CHECK] ⚠️ Missing required model(s):");
      for (const m of missing) {
        console.error(`  - Missing: ${m}`);
        console.error(`    Run: ollama pull ${m}`);
      }
      console.error("=======================================================\n");
      return { reachable: true, missingModels: missing };
    }

    console.log(
      `[Ollama] Health check passed (${llmModel}, ${embeddingModel})`
    );
    return { reachable: true, missingModels: [] };
  } catch (err) {
    console.error("\n=======================================================");
    console.error(`[OLLAMA HEALTH CHECK] ⚠️ Ollama is NOT reachable at ${baseUrl}`);
    console.error(`Error: ${err.message}`);
    console.error("Please make sure Ollama is installed and running.");
    console.error("Required models:");
    console.error(`  ollama pull ${llmModel}`);
    console.error(`  ollama pull ${embeddingModel}`);
    console.error("=======================================================\n");
    return { reachable: false, missingModels: [llmModel, embeddingModel] };
  }
};

