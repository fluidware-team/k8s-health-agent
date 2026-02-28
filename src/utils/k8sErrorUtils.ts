// Extract a human-readable message from a K8s API error.
// Tries multiple paths where the K8s client may place the error message.
export function extractK8sErrorMessage(e: any, fallbackContext: string): string {
  // Try e.body (string containing JSON with a "message" field)
  if (typeof e.body === 'string') {
    try {
      const parsed = JSON.parse(e.body);
      if (parsed?.message) return parsed.message;
      // JSON parsed but no message field — fall through to other strategies
    } catch {
      // Not valid JSON, return the raw string body
      return e.body;
    }
  }

  // Try e.response.body.message
  if (e.response?.body?.message) return e.response.body.message;

  // Try e.message
  if (e.message) return e.message;

  return `Unknown error for ${fallbackContext}`;
}
