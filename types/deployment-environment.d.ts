declare module "@/scripts/validate-deployment-environment.mjs" {
  export function validateDeploymentEnvironment(
    environment: Record<string, string | undefined>,
  ): string[];
}
