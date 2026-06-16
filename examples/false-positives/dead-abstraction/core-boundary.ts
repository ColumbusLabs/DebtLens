import { join, normalize } from "node:path";

export interface AssetRequest {
  tenantId: string;
  filename: string;
}

export function resolveTenantAsset(rootDir: string, request: AssetRequest): string {
  const safeTenant = request.tenantId.replace(/[^a-z0-9-]/gi, "_");
  const safeFilename = normalize(request.filename).replace(/^(\.\.(\/|\\|$))+/, "");
  return join(rootDir, safeTenant, safeFilename);
}
