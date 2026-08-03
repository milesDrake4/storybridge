import { createSchoolsGetHandler } from "@/app/api/v1/schools/handler";
import { createSchoolRegistryRuntime } from "@/app/api/v1/schools/runtime";
import { searchSchools } from "@/services/schools/school-registry-service";

export async function GET(request: Request): Promise<Response> {
  const { dependencies } = await createSchoolRegistryRuntime();
  return createSchoolsGetHandler({
    search: (input) => searchSchools(input, dependencies),
  })(request);
}
