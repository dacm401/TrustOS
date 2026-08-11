/**
 * TRST-2C Model Registry
 *
 * Maps model names to providers using prefix-based routing.
 * Supports multiple providers with per-provider base URL and API key.
 */

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  /** Cost per token (input, output) in USD */
  cost?: {
    inputPerToken: number;
    outputPerToken: number;
  };
}

export interface ModelRoutingRule {
  /** Model name pattern (prefix match, supports * wildcard) */
  pattern: string;
  /** Provider id to route to */
  provider: string;
}

export interface ModelRegistryConfig {
  providers: Record<string, Omit<ProviderConfig, "id">>;
  routing: ModelRoutingRule[];
  defaultProvider: string;
}

export class ModelRegistry {
  private providers: Map<string, ProviderConfig>;
  private routing: ModelRoutingRule[];
  private defaultProvider: string;

  constructor(config: ModelRegistryConfig) {
    this.providers = new Map();
    for (const [id, cfg] of Object.entries(config.providers)) {
      this.providers.set(id, { id, ...cfg });
    }
    this.routing = config.routing;
    this.defaultProvider = config.defaultProvider;
  }

  /**
   * Resolve a model name to its provider config.
   * Uses prefix matching against routing rules, falls back to default.
   */
  resolveProvider(model: string): ProviderConfig {
    // Match against routing rules (first match wins)
    for (const rule of this.routing) {
      if (this.matches(model, rule.pattern)) {
        const provider = this.providers.get(rule.provider);
        if (provider) return provider;
      }
    }

    // Fall back to default provider
    const defaultProv = this.providers.get(this.defaultProvider);
    if (defaultProv) return defaultProv;

    throw new Error(
      `No provider found for model "${model}" and default provider "${this.defaultProvider}" not configured`,
    );
  }

  /**
   * Check if a model name matches a pattern.
   * Supports: exact match, prefix match (ends with *), wildcard (*).
   */
  private matches(model: string, pattern: string): boolean {
    if (pattern === "*") return true;
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      return model.startsWith(prefix);
    }
    return model === pattern;
  }

  /**
   * Get all registered provider IDs.
   */
  getProviderIds(): string[] {
    return [...this.providers.keys()];
  }

  /**
   * Build a default single-provider registry from env-style config.
   * Used for backward compatibility with TRUSTOS_UPSTREAM_BASE_URL / _API_KEY.
   */
  static fromSingleProvider(baseUrl: string, apiKey: string): ModelRegistry {
    return new ModelRegistry({
      providers: {
        default: {
          name: "default",
          baseUrl,
          apiKey,
        },
      },
      routing: [{ pattern: "*", provider: "default" }],
      defaultProvider: "default",
    });
  }

  /**
   * Build from a JSON config string (TRUSTOS_MODELS_CONFIG env var).
   */
  static fromJson(configJson: string, resolveEnv: (key: string) => string | undefined): ModelRegistry {
    const raw = JSON.parse(configJson);
    const providers: Record<string, Omit<ProviderConfig, "id">> = {};

    for (const [id, cfg] of Object.entries(raw.providers ?? {})) {
      const p = cfg as Record<string, unknown>;
      const apiKeyEnv = p.api_key_env as string | undefined;
      const apiKey = apiKeyEnv ? (resolveEnv(apiKeyEnv) ?? "") : (p.api_key as string ?? "");
      const baseUrl = (p.base_url as string) ?? "";

      providers[id] = {
        name: (p.name as string) ?? id,
        baseUrl,
        apiKey,
        cost: p.cost_per_1k ? {
          inputPerToken: (p.cost_per_1k as Record<string, number>).input ?? 0 / 1000,
          outputPerToken: (p.cost_per_1k as Record<string, number>).output ?? 0 / 1000,
        } : undefined,
      };
    }

    return new ModelRegistry({
      providers,
      routing: (raw.routing as ModelRoutingRule[]) ?? [{ pattern: "*", provider: Object.keys(providers)[0] }],
      defaultProvider: (raw.default_provider as string) ?? Object.keys(providers)[0] ?? "default",
    });
  }
}
