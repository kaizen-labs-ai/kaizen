import { prisma } from "@/lib/db/prisma";

export async function getGuardrailsForSkill(skillId: string) {
  return prisma.guardrail.findMany({
    where: { skillId },
    orderBy: { createdAt: "asc" },
  });
}

export async function createGuardrail(data: {
  skillId: string;
  rule: string;
  type: string;
  editableBy?: string;
}) {
  return prisma.guardrail.create({
    data: {
      skillId: data.skillId,
      rule: data.rule,
      type: data.type,
      editableBy: data.editableBy ?? "both",
    },
  });
}

export async function updateGuardrail(
  id: string,
  data: { rule?: string; type?: string; editableBy?: string }
) {
  return prisma.guardrail.update({ where: { id }, data });
}

export async function deleteGuardrail(id: string) {
  return prisma.guardrail.delete({ where: { id } });
}
