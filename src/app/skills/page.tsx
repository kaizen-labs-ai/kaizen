import { getAllSkillsAdmin } from "@/lib/skills/registry";
import { serialize } from "@/lib/db/serialize";
import { SkillsPageClient } from "./skills-page-client";

export default async function SkillsPage() {
  const skills = await getAllSkillsAdmin();
  return <SkillsPageClient initialData={serialize(skills)} />;
}
