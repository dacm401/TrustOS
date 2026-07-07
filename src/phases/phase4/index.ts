/**
 * Phase 4 stub — Permission Layer + Data Classifier.
 * Minimal type export for llm-native-router.ts type inference.
 * Full implementation deferred to Phase 4 authorization.
 */

export class DataClassifier {
  classify(_s: string, _ctx: unknown) {
    return {} as any;
  }
}

export class PermissionChecker {
  // Full implementation in Phase 4
}

export function getPhase4() {
  return { DataClassifier, PermissionChecker };
}
