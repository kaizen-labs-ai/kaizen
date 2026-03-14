import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { getPluginDir, resolvePluginScript, toRelativePath } from "@/lib/workspace";
import { getAllPlugins } from "@/lib/plugins/queries";

export async function GET() {
  const result = await getAllPlugins();
  return NextResponse.json(result);
}

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  python: ".py",
  node: ".js",
  bash: ".sh",
  typescript: ".ts",
  ruby: ".rb",
};

const STARTER_TEMPLATES: Record<string, string> = {
  python: `import json, sys

input_data = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}

# Your plugin logic here
result = {"message": "Hello from plugin!"}

print(json.dumps(result))
`,
  node: `const input = JSON.parse(process.argv[2] || '{}');

// Your plugin logic here
const result = { message: "Hello from plugin!" };

console.log(JSON.stringify(result));
`,
  typescript: `const input = JSON.parse(process.argv[2] || '{}');

// Your plugin logic here
const result = { message: "Hello from plugin!" };

console.log(JSON.stringify(result));
`,
  bash: `#!/bin/bash

# Your plugin logic here
echo '{"message": "Hello from plugin!"}'
`,
};

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, description, language } = body;

  if (!name || !description || !language) {
    return NextResponse.json({ error: "name, description, and language are required" }, { status: 400 });
  }

  const existing = await prisma.tool.findUnique({ where: { name } });
  if (existing) {
    return NextResponse.json({ error: `A plugin named "${name}" already exists` }, { status: 409 });
  }

  const ext = LANGUAGE_EXTENSIONS[language] ?? `.${language}`;
  const filename = `main${ext}`;
  const pluginDir = await getPluginDir(name);
  const scriptPath = resolvePluginScript(pluginDir, filename);

  await fs.writeFile(scriptPath, STARTER_TEMPLATES[language] ?? "", "utf-8");

  const relativePath = toRelativePath(scriptPath);
  const config = { language, scriptPath: relativePath, timeout: 60000, dependencies: [] };

  const tool = await prisma.tool.create({
    data: {
      name,
      description,
      type: "plugin",
      config: JSON.stringify(config),
      inputSchema: JSON.stringify({ type: "object", properties: {} }),
      enabled: true,
      createdBy: "user",
    },
  });

  return NextResponse.json({ id: tool.id }, { status: 201 });
}
