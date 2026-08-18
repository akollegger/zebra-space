// Throwaway spike script — SPIKE-004 (RFC-003 Appendix §9.4).
// Tests schema-constrained LLM extraction (via @openrouter/sdk) against SPIKE-001's
// stratified sample, on two models, and tests per-clue vs per-puzzle batching.
import { OpenRouter } from "@openrouter/sdk";

const openRouter = new OpenRouter();

const MODELS = {
  frontier: "anthropic/claude-sonnet-4.5",
  cheap: "google/gemini-2.5-flash-lite",
};

async function extract(model, text, schemaName, schema) {
  const result = await openRouter.chat.send({
    chatRequest: {
      model,
      messages: [
        {
          role: "system",
          content: "Extract structured data from the puzzle clue text exactly per the provided JSON schema. Do not infer facts not stated in the text.",
        },
        { role: "user", content: text },
      ],
      responseFormat: {
        type: "json_schema",
        jsonSchema: { name: schemaName, schema, strict: true },
      },
    },
  });
  const content = result.choices[0].message.content;
  try {
    return JSON.parse(content);
  } catch {
    return { _raw: content };
  }
}

async function section(title, model, text, schemaName, schema) {
  console.log(`\n=== ${title} [${model}] ===`);
  console.log(`- "${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"`);
  try {
    const out = await extract(model, text, schemaName, schema);
    console.log("  ->", JSON.stringify(out));
  } catch (err) {
    console.log("  !! error:", err.message);
  }
}

const houseAssignmentSchema = {
  type: "object",
  properties: {
    nationality: { type: "string" },
    house_color: { type: "string" },
  },
  required: ["nationality", "house_color"],
  additionalProperties: false,
};

const relationSchema = {
  type: "object",
  properties: {
    country_a: { type: "string" },
    country_b: { type: "string" },
    relation: { type: "string" },
  },
  required: ["country_a", "country_b", "relation"],
  additionalProperties: false,
};

const metaRuleSchema = {
  type: "object",
  properties: {
    subject: { type: "string" },
    condition: { type: "string" },
    requirement: { type: "string" },
  },
  required: ["subject", "condition", "requirement"],
  additionalProperties: false,
};

const gridPuzzleSchema = {
  type: "object",
  properties: {
    grid_rows: { type: "integer" },
    grid_cols: { type: "integer" },
    target_sum: { type: "integer" },
    given_cells: {
      type: "array",
      items: {
        type: "object",
        properties: { position: { type: "string" }, value: { type: "integer" } },
        required: ["position", "value"],
        additionalProperties: false,
      },
    },
  },
  required: ["grid_rows", "grid_cols", "target_sum", "given_cells"],
  additionalProperties: false,
};

const thresholdRuleSchema = {
  type: "object",
  properties: {
    derived_variable: { type: "string" },
    comparison: { type: "string" },
    outcome: { type: "string" },
  },
  required: ["derived_variable", "comparison", "outcome"],
  additionalProperties: false,
};

const ruleReferenceSchema = {
  type: "object",
  properties: {
    referenced_rules: { type: "array", items: { type: "string" } },
    outcome: { type: "string" },
  },
  required: ["referenced_rules", "outcome"],
  additionalProperties: false,
};

const personFactsSchema = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: { person: { type: "string" }, value: { type: "string" } },
        required: ["person", "value"],
        additionalProperties: false,
      },
    },
  },
  required: ["facts"],
  additionalProperties: false,
};

const dietaryRequirementsSchema = {
  type: "object",
  properties: {
    requirements: {
      type: "array",
      items: {
        type: "object",
        properties: { person: { type: "string" }, requirement: { type: "string" } },
        required: ["person", "requirement"],
        additionalProperties: false,
      },
    },
  },
  required: ["requirements"],
  additionalProperties: false,
};

const restaurantRowSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    vegan_friendly: { type: "string" },
    nut_free: { type: "string" },
    gluten_free: { type: "string" },
    price: { type: "string" },
  },
  required: ["name", "vegan_friendly", "nut_free", "gluten_free", "price"],
  additionalProperties: false,
};

for (const [tier, model] of Object.entries(MODELS)) {
  console.log(`\n\n########## MODEL TIER: ${tier} (${model}) ##########`);

  // Shape A/B/C/D baseline (PZL-0001) — isolated sentence.
  await section(
    "Shapes A/B/C/D: attribute-assignment (isolated)",
    model,
    "The Englishman lives in the red house.",
    "house_assignment",
    houseAssignmentSchema
  );

  // Shape E: relation + meta-rule (PZL-0005)
  await section(
    "Shape E: relation extraction",
    model,
    "Avalon and Borealis share a border.",
    "relation",
    relationSchema
  );
  await section(
    "Shape E: meta-rule decomposition",
    model,
    "Two countries that share a border must be colored differently.",
    "meta_rule",
    metaRuleSchema
  );

  // Shape F: implicit grid constraints (PZL-0008) — full combined text (needs the whole passage).
  await section(
    "Shape F: implicit grid constraints (full passage)",
    model,
    "Fill a 3-by-3 grid with each of the digits 1 through 9, using each digit exactly once, " +
      "so that every row, every column, and both diagonals add up to the same total: 15. " +
      "The top-left cell is 4. The top-middle cell is 9. The center cell is 5.",
    "grid_puzzle",
    gridPuzzleSchema
  );

  // Shapes H/I: numeric threshold + rule-chain (PZL-0011) — isolated vs combined (batching test).
  await section(
    "Shapes H/I: threshold rule (ISOLATED single sentence)",
    model,
    "If that score is below 600, the loan is Denied.",
    "threshold_rule",
    thresholdRuleSchema
  );
  await section(
    "Shapes H/I: threshold rule (COMBINED with other clues, batching test)",
    model,
    "The couple's credit tier uses the lower of their two individual credit scores. " +
      "If that score is below 600, the loan is Denied. " +
      "If not denied by rules 1-2, and the requested amount is within policy limits for " +
      "their combined income, the loan is Approved. " +
      "Priya's credit score is 680; Sam's credit score is 750.",
    "threshold_rule",
    thresholdRuleSchema
  );
  await section(
    "Shapes H/I: rule cross-reference (COMBINED)",
    model,
    "If not denied by rules 1-2, and the requested amount is within policy limits for " +
      "their combined income, the loan is Approved.",
    "rule_reference",
    ruleReferenceSchema
  );
  await section(
    "Shapes H/I: compound person facts (COMBINED)",
    model,
    "Priya's credit score is 680; Sam's credit score is 750.",
    "person_facts",
    personFactsSchema
  );

  // Shape K: vocabulary-mapping preferences + raw table row (PZL-0013)
  await section(
    "Shape K: dietary requirements (vocabulary mapping)",
    model,
    "Amara is vegan. Ben has a nut allergy and needs a nut-free kitchen. " +
      "Cora needs gluten-free options.",
    "dietary_requirements",
    dietaryRequirementsSchema
  );
  await section(
    "Shape K: raw markdown table row",
    model,
    "| Thai Palace | No | No | Yes | $$ |",
    "restaurant_row",
    restaurantRowSchema
  );
}
