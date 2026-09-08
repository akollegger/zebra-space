import { Schema } from "effect"
import { Tool } from "effect/unstable/ai"

const WithNullOr = Tool.make("WithNullOr", {
  parameters: { variable: Schema.NullOr(Schema.String) },
  success: Schema.Void,
})
console.log("tool defined OK")

const jsonSchema = Tool.getJsonSchema(WithNullOr, {})
console.log(JSON.stringify(jsonSchema, null, 2))
