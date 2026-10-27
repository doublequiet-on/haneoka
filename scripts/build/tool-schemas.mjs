// L3 — GEB
// Input: 配队引擎与公开工具的 TypeScript 契约。
// Output: 工具请求与结果的 JSON Schema。
// Pos: [Map](L2-2.md)；从实际类型生成可供 Agent 读取的计算契约。
// Effects/Dependencies: TypeScript 类型读取；由 public-tools 构建写入生成目录。
import ts from "typescript";
import path from "node:path";
export function toolSchemas(root) {
  const files = ["src/lib/team-builder/engine/api.ts", "src/lib/team-builder/engine/protocol.ts", "src/lib/public-tools/image-contract.ts"];
  const program = ts.createProgram(files.map(file => path.join(root, file)), {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    strictNullChecks: true, skipLibCheck: true, allowImportingTsExtensions: true,
  });
  const checker = program.getTypeChecker();
  const definitions = {}, seen = new Map();
  function schema(type) {
    if (type.isUnion()) return { anyOf: type.types.filter(value => !(value.flags & ts.TypeFlags.Undefined)).map(schema) };
    if (type.flags & ts.TypeFlags.StringLiteral) return { type: "string", const: type.value };
    if (type.flags & ts.TypeFlags.NumberLiteral) return { type: "number", const: type.value };
    if (type.flags & ts.TypeFlags.BooleanLiteral) return { type: "boolean", const: type.intrinsicName === "true" };
    if (type.flags & ts.TypeFlags.Null) return { type: "null" };
    if (type.flags & ts.TypeFlags.StringLike) return { type: "string" };
    if (type.flags & ts.TypeFlags.NumberLike) return { type: "number" };
    if (type.flags & ts.TypeFlags.BooleanLike) return { type: "boolean" };
    if (!(type.flags & ts.TypeFlags.Object)) return {};
    if (checker.isArrayType(type) || checker.isTupleType(type) || type.symbol?.name === "ReadonlyArray") {
      const args = checker.getTypeArguments(type);
      return checker.isTupleType(type)
        ? { type: "array", prefixItems: args.map(schema), minItems: args.length, maxItems: args.length }
        : { type: "array", items: schema(args[0]) };
    }
    if (seen.has(type)) return { $ref: `#/$defs/${seen.get(type)}` };
    const key = `T${seen.size + 1}`; seen.set(type, key);
    const result = { type: "object", properties: {}, required: [] };
    definitions[key] = result;
    for (const property of checker.getPropertiesOfType(type)) {
      const declaration = property.valueDeclaration || property.declarations?.[0];
      if (!declaration) continue;
      result.properties[property.name] = schema(checker.getTypeOfSymbolAtLocation(property, declaration));
      if (!(property.flags & ts.SymbolFlags.Optional)) result.required.push(property.name);
    }
    const index = checker.getIndexTypeOfType(type, ts.IndexKind.String);
    result.additionalProperties = index ? schema(index) : true;
    return { $ref: `#/$defs/${key}` };
  }
  for (const file of files) {
    const source = program.getSourceFile(path.join(root, file));
    const symbol = checker.getSymbolAtLocation(source);
    for (const entry of checker.getExportsOfModule(symbol)) {
      if (!["EngineRequest", "EngineResponse", "GrowthResult", "TeamEvaluation", "Timeline", "EvaluateRequest", "ExplainRequest", "ResourceImageRequest", "TeamImageOptions", "GachaImageInput", "GachaHistoryReport", "StampImageOptions", "CustomChartImageOptions", "Live2DImageOptions", "SpineImageOptions", "ImageAppearance"].includes(entry.name)) continue;
      definitions[entry.name] = schema(checker.getDeclaredTypeOfSymbol(entry.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(entry) : entry));
    }
  }
  return { $schema: "https://json-schema.org/draft/2020-12/schema", $id: "https://haneoka.org/tools/schema.json", title: "Haneoka public tools", $defs: definitions };
}
