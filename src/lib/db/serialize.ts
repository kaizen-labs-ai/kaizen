/**
 * Serialize Prisma results for passing as RSC props.
 * Converts Date objects to ISO strings, matching JSON.stringify behavior.
 * This ensures initialData shape exactly matches what fetch().json() returns.
 */
export function serialize<T>(data: T): T {
  return JSON.parse(JSON.stringify(data));
}
