import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { AuthStorage, ModelRegistry, SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

export const dynamic = "force-dynamic";

export async function GET() {
  const nameMap = new Map<string, string>();
  let modelList: { id: string; name: string; provider: string }[] = [];
  let defaultModel: { provider: string; modelId: string } | null = null;
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};

  try {
    const agentDir = getAgentDir();
    const authStorage = AuthStorage.create();
    const registry = ModelRegistry.create(authStorage);

    // Read explicitly configured providers from models.json
    const modelsJsonPath = join(agentDir, "models.json");
    let configuredProviders = new Set<string>();
    if (existsSync(modelsJsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(modelsJsonPath, "utf-8"));
        if (parsed?.providers) {
          configuredProviders = new Set(Object.keys(parsed.providers));
        }
      } catch { /* ignore */ }
    }

    const available = registry.getAvailable();
    const filtered = configuredProviders.size > 0
      ? available.filter((m: { provider: string }) => configuredProviders.has(m.provider))
      : available;

    modelList = filtered.map((m: { id: string; name: string; provider: string }) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
    }));
    for (const m of filtered) {
      const key = `${m.provider}:${m.id}`;
      nameMap.set(key, m.name);
      thinkingLevels[key] = getSupportedThinkingLevels(m);
      if (m.thinkingLevelMap) thinkingLevelMaps[key] = m.thinkingLevelMap;
    }

    const settings = SettingsManager.create(process.cwd(), agentDir);
    const provider = settings.getDefaultProvider();
    const modelId = settings.getDefaultModel();
    if (provider) {
      defaultModel = { provider, modelId: modelId ?? filtered[0]?.id ?? "" };
    }
  } catch { /* return empty */ }

  return Response.json({ models: Object.fromEntries(nameMap), modelList, defaultModel, thinkingLevels, thinkingLevelMaps });
}
