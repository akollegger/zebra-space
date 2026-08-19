"""Throwaway spike script — SPIKE-003 (RFC-003 Appendix Section 9.3).
Tests GLiNER2's native schema-driven extraction against SPIKE-001's stratified sample.
"""
from gliner2 import GLiNER2

print("Loading fastino/gliner2-base-v1 ...")
model = GLiNER2.from_pretrained("fastino/gliner2-base-v1")


def section(title):
    print(f"\n=== {title} ===")


# --- Shapes A/B/C/D (simple) - PZL-0001 ---
section("Shapes A/B/C/D: attribute-assignment, positional, negation, ordering (PZL-0001)")
entities = model.extract_entities(
    "The Englishman lives in the red house. The Ukrainian drinks tea. "
    "The green house is immediately to the right of the ivory house. "
    "The Norwegian lives next to the blue house. Coffee is drunk in the green house.",
    ["person nationality", "beverage", "house color", "spatial relation"],
)
print(entities)

structured = model.extract_json(
    "The Englishman lives in the red house.",
    {"house_assignment": ["nationality::str::the person's nationality",
                           "house_color::str::the color of the house they live in"]},
)
print(structured)

# --- Shape E: relational fact + generative meta-rule - PZL-0005 ---
section("Shape E: symmetric relation + derived meta-rule (PZL-0005)")
rel = model.extract_relations(
    "Avalon and Borealis share a border. Two countries that share a border must be "
    "colored differently. Avalon is colored Red.",
    ["shares border with"],
)
print(rel)
struct_e = model.extract_json(
    "Two countries that share a border must be colored differently.",
    {"coloring_rule": ["subject::str::what the rule applies to",
                        "condition::str::the triggering condition",
                        "requirement::str::what must hold if the condition is true"]},
)
print(struct_e)

# --- Shape F: implicit grid constraints from a named problem type - PZL-0008 ---
section("Shape F: implicit grid constraints from problem framing (PZL-0008)")
struct_f = model.extract_json(
    "Fill a 3-by-3 grid with each of the digits 1 through 9, using each digit exactly once, "
    "so that every row, every column, and both diagonals add up to the same total: 15. "
    "The top-left cell is 4. The top-middle cell is 9. The center cell is 5.",
    {"grid_puzzle": ["grid_size::str::the dimensions of the grid",
                      "target_sum::str::the total each row/column/diagonal must sum to",
                      "given_cells::list::each stated cell position and its value"]},
)
print(struct_f)

# --- Shapes H/I: numeric threshold + derived variable + rule-chain - PZL-0011 ---
section("Shapes H/I: numeric threshold + derived variable + rule chain (PZL-0011)")
struct_hi = model.extract_json(
    "The couple's credit tier uses the lower of their two individual credit scores. "
    "If that score is below 600, the loan is Denied. "
    "If not denied by rules 1-2, and the requested amount is within policy limits for "
    "their combined income, the loan is Approved. "
    "Priya's credit score is 680; Sam's credit score is 750.",
    {"threshold_rule": ["derived_variable::str::how the checked value is computed",
                         "comparison::str::the threshold comparison applied",
                         "outcome::str::the result if the comparison is true"],
     "rule_reference": ["referenced_rules::list::which earlier rules this rule depends on",
                         "outcome::str::the result of this rule"],
     "person_fact": ["person::str::the named person", "value::str::their stated numeric value"]},
)
print(struct_hi)

# --- Shape K: embedded table + vocabulary-mapping preference - PZL-0013 ---
section("Shape K: preference statement + table row (PZL-0013)")
struct_k = model.extract_json(
    "Amara is vegan. Ben has a nut allergy and needs a nut-free kitchen. "
    "Cora needs gluten-free options.",
    {"dietary_requirement": ["person::str::the named person",
                              "requirement::str::their dietary or allergy requirement"]},
)
print(struct_k)

table_row = model.extract_json(
    "| Thai Palace | No | No | Yes | $$ |",
    {"restaurant_row": ["name::str::restaurant name",
                         "vegan_friendly::str::vegan-friendly column value",
                         "nut_free::str::nut-free kitchen column value",
                         "gluten_free::str::gluten-free options column value",
                         "price::str::price column value"]},
)
print(table_row)
