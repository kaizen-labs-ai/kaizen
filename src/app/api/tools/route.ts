import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAllTools } from "@/lib/tools/queries";

export async function GET() {
  const tools = await getAllTools();
  return NextResponse.json(tools);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, description, type, config, inputSchema, outputSchema } = body;

  if (!name || !description || !type) {
    return NextResponse.json(
      { error: "name, description, and type are required" },
      { status: 400 }
    );
  }

  const tool = await prisma.tool.create({
    data: {
      name,
      description,
      type,
      config: config ? JSON.stringify(config) : "{}",
      inputSchema: inputSchema ? JSON.stringify(inputSchema) : "{}",
      outputSchema: outputSchema ? JSON.stringify(outputSchema) : "{}",
    },
  });

  return NextResponse.json(tool, { status: 201 });
}
