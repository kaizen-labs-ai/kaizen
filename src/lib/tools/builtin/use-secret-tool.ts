/**
 * use-secret — Securely resolves vault secrets and performs actions server-side.
 *
 * The LLM never sees the actual secret value. It calls this tool with a secret
 * label and an action (fill a browser field, return for headers, etc.), and the
 * executor reads from the encrypted vault and performs the action directly.
 *
 * ACL: only secrets linked to the active skill (via SkillVaultEntry) can be used.
 */
import type { ToolExecutionResult, ExecutionContext, ContextualToolExecutorFn } from "../types";
import { prisma } from "@/lib/db/prisma";
import { getSecret } from "@/lib/vault/vault";
import { chromeFillExecutor, chromeClickExecutor, chromeEvaluateExecutor, getCurrentPageUrl } from "./chrome-devtools-tool";
import { parseAuthorizedDomains, isDomainAuthorized } from "@/lib/vault/domain-check";

export const useSecretExecutorFactory: ContextualToolExecutorFn = (ctx: ExecutionContext) => {
  return async (input: Record<string, unknown>): Promise<ToolExecutionResult> => {
    const secretLabel = (input.secretLabel ?? input.secret_label ?? input.label ?? input.name) as string | undefined;
    const action = (input.action as string | undefined) ?? "fill";
    const target = input.target as string | undefined;
    const field = (input.field as string | undefined); // For login: "username" or "password"

    if (!secretLabel) {
      return { success: false, output: null, error: "secretLabel is required — the label of the vault entry to use" };
    }

    // ── 1. Resolve skill from objective ──
    const objective = await prisma.objective.findFirst({
      where: { runs: { some: { id: ctx.runId } } },
      select: { skillId: true },
    });
    const skillId = objective?.skillId;

    if (!skillId) {
      return {
        success: false,
        output: null,
        error: "No skill is linked to this run — use-secret requires a skill with linked vault entries",
      };
    }

    // ── 2. Find vault entry by label ──
    const vaultEntry = await prisma.vaultEntry.findFirst({
      where: { label: { equals: secretLabel } },
    });

    if (!vaultEntry) {
      return {
        success: false,
        output: null,
        error: `Vault entry "${secretLabel}" not found. Check the label matches exactly.`,
      };
    }

    // ── 3. ACL check: is this secret linked to the active skill? ──
    const link = await prisma.skillVaultEntry.findUnique({
      where: {
        skillId_vaultEntryId: {
          skillId,
          vaultEntryId: vaultEntry.id,
        },
      },
    });

    if (!link) {
      return {
        success: false,
        output: null,
        error: `BLOCKED — Access denied: secret "${secretLabel}" is not linked to the active skill. DO NOT retry. Inform the user that they need to link this secret to the skill first.`,
      };
    }

    // ── 4. Read actual value from encrypted vault ──
    let secretValue: string | null;
    if (vaultEntry.category === "login") {
      // Login secrets require the `field` param to distinguish username from password.
      // Without it, the agent might fill the password into the username field.
      if (!field) {
        return {
          success: false,
          output: null,
          error: `Secret "${secretLabel}" is a login secret — you MUST specify field: "username" or field: "password". First fill the username/email field with field: "username", then fill the password field with field: "password".`,
        };
      }
      if (field === "username" || field === "email") {
        const fields = vaultEntry.fields ? JSON.parse(vaultEntry.fields) : {};
        secretValue = fields.username || fields.email || null;
        if (!secretValue) {
          return {
            success: false,
            output: null,
            error: `Secret "${secretLabel}" has no username/email stored. Check the login entry's fields.`,
          };
        }
      } else if (field === "password") {
        secretValue = await getSecret(vaultEntry.vaultKey);
      } else {
        return {
          success: false,
          output: null,
          error: `Unknown field "${field}" for login secret. Use field: "username" or field: "password".`,
        };
      }
    } else if (vaultEntry.category === "address") {
      // Address secrets store JSON — extract specific field or return all
      const raw = await getSecret(vaultEntry.vaultKey);
      if (field && raw) {
        const fields = JSON.parse(raw);
        secretValue = fields[field] ?? null;
        if (!secretValue) {
          // Soft skip — field not set, agent should move on
          return {
            success: true,
            output: {
              message: `Address field "${field}" is not set in secret "${secretLabel}" — skip this field.`,
              skipped: true,
            },
          };
        }
      } else {
        secretValue = raw;
      }
    } else {
      secretValue = await getSecret(vaultEntry.vaultKey);
    }

    if (!secretValue) {
      return {
        success: false,
        output: null,
        error: `Secret "${secretLabel}" exists but has no value stored in the vault.`,
      };
    }

    // ── 5. Perform action ──
    switch (action) {
      case "fill": {
        if (!target) {
          return {
            success: false,
            output: null,
            error: "target (element uid) is required for fill action — use chrome-snapshot first to find the field uid",
          };
        }

        // ── Domain authorization check ──
        // Read authorized domains from encrypted vault (never from plaintext DB)
        const encryptedDomains = await getSecret(`${vaultEntry.vaultKey}_domains`);
        // Fall back to DB service for unmigrated entries
        const authorizedDomains = parseAuthorizedDomains(encryptedDomains || vaultEntry.service);
        if (authorizedDomains.length > 0) {
          const currentUrl = await getCurrentPageUrl();
          if (!currentUrl) {
            return {
              success: false,
              output: null,
              error: `BLOCKED — Cannot verify the current page URL, so the secret "${secretLabel}" cannot be filled for security reasons. DO NOT retry. Tell the user the secret could not be filled because the current page could not be verified against its authorized domains.`,
            };
          }
          if (!isDomainAuthorized(currentUrl, authorizedDomains)) {
            return {
              success: false,
              output: null,
              error: `BLOCKED — The current page is not an authorized domain for secret "${secretLabel}". DO NOT retry. Tell the user the secret cannot be used on this website because it is restricted to specific authorized domains. Do NOT reveal which domains are authorized.`,
            };
          }
        }

        // Determine if this value is sensitive (needs masking + redaction).
        // Passwords, API keys, tokens = sensitive. Usernames, address fields = not sensitive.
        const isSensitive = !(
          (vaultEntry.category === "login" && (field === "username" || field === "email")) ||
          vaultEntry.category === "address"
        );

        // Register sensitive secrets for centralized redaction in agent-loop
        // (catches leaks via chrome-snapshot, chrome-evaluate, etc.)
        if (isSensitive && ctx.filledSecrets && secretValue.length >= 4) {
          ctx.filledSecrets.add(secretValue);
        }

        // For sensitive values: mask the input as type="password" BEFORE filling
        // so the value is never visible as plaintext — not even for a split second.
        // Step 1: click the target to focus it (uid is MCP-internal, not a DOM attr)
        // Step 2: mask document.activeElement to type="password"
        // Step 3: fill the value (already masked, user only sees dots)
        // Best-effort — centralized redaction in agent-loop is the primary defense.
        if (isSensitive) {
          try {
            await chromeClickExecutor({ uid: target });
            await chromeEvaluateExecutor({
              function: `function() {
                var el = document.activeElement;
                if (el && el.tagName === 'INPUT' && el.type !== 'password') {
                  el.type = 'password';
                }
              }`,
            });
          } catch {
            // Non-critical
          }
        }

        // Delegate to chrome-fill with the real secret value
        const fillResult = await chromeFillExecutor({
          uid: target,
          value: secretValue,
        });

        // Sanitize: replace any echo of the actual value in the result
        const sanitized = sanitizeOutput(fillResult, secretValue);
        return {
          success: sanitized.success,
          output: { message: `Secret "${secretLabel}" securely filled into element ${target}` },
          error: sanitized.error ? sanitizeString(sanitized.error, secretValue) : undefined,
        };
      }

      case "header": {
        // Return a sanitized confirmation — the actual value would need to be
        // injected by a higher-level API tool in the future
        return {
          success: true,
          output: {
            message: `Secret "${secretLabel}" resolved for header "${target ?? "Authorization"}"`,
            headerName: target ?? "Authorization",
            // Note: actual value is NOT returned to the LLM
            _secretApplied: true,
          },
        };
      }

      case "value": {
        // Generic "I need the value" — return confirmation without the actual value
        return {
          success: true,
          output: {
            message: `Secret "${secretLabel}" resolved successfully. The value has been applied.`,
            _secretApplied: true,
          },
        };
      }

      default:
        return {
          success: false,
          output: null,
          error: `Unknown action "${action}". Supported actions: fill, header, value`,
        };
    }
  };
};

// ── Helpers ──

/** Replace any occurrence of a secret value in a string */
function sanitizeString(text: string, secret: string): string {
  if (!secret || secret.length < 3) return text;
  return text.replaceAll(secret, "[REDACTED]");
}

/** Sanitize a tool execution result to remove any trace of the secret */
function sanitizeOutput(result: ToolExecutionResult, secret: string): ToolExecutionResult {
  const json = JSON.stringify(result.output ?? "");
  if (json.includes(secret)) {
    return {
      ...result,
      output: JSON.parse(json.replaceAll(secret, "[REDACTED]")),
    };
  }
  return result;
}
