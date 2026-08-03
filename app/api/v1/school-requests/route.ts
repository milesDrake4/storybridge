import { createSchoolRequestPostHandler } from "@/app/api/v1/schools/handler";
import { createSchoolRegistryRuntime } from "@/app/api/v1/schools/runtime";
import { createSchoolRequest } from "@/services/schools/school-registry-service";

export async function POST(request: Request): Promise<Response> {
  const { config, dependencies } = await createSchoolRegistryRuntime();
  return createSchoolRequestPostHandler({
    appUrl: config.appUrl,
    create: (input, requestMetadata) =>
      createSchoolRequest(input, requestMetadata, dependencies),
  })(request);
}
