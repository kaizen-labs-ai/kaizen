import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const objectives = await prisma.objective.findMany({
    include: { skill: true, runs: { orderBy: { sequence: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(objectives);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { title, description, skillId, config } = body;

  if (!title || !description) {
    return NextResponse.json(
      { error: "title and description are required" },
      { status: 400 }
    );
  }

  const objective = await prisma.objective.create({
    data: {
      title,
      description,
      skillId: skillId ?? null,
      config: config ? JSON.stringify(config) : "{}",
    },
  });

  return NextResponse.json(objective, { status: 201 });
}
