# Builds the `make seed-test` catalogue items from scripts/seed-catalogue.json:
# one PutItem request per ingredient and recipe (DESIGN §4), each only if the
# item doesn't exist yet, as an array for `jq -c '.[]'` and
# `aws dynamodb put-item --cli-input-json`. Run with
#   jq --arg table <table> --slurpfile user <admin-get-user JSON>
#      -f scripts/seed-catalogue.jq scripts/seed-catalogue.json
# The IDs are fixed, so seeding again doesn't duplicate anything. Recipe
# lines name their ingredient, and an unknown name is an error.

def s: {S: .};
def n: {N: tostring};

($user[0].UserAttributes | map(select(.Name == "sub"))[0].Value
    // error("admin-get-user returned no sub")) as $sub
| (now * 1000 | floor) as $millis
| (($millis / 1000 | floor) | strftime("%Y-%m-%dT%H:%M:%S")
    + "." + ($millis % 1000 | tostring | ("00" + .)[-3:]) + "Z") as $updatedAt
| {version: (1 | n), updatedAt: ($updatedAt | s), updatedBy: ($sub | s)} as $versioned
| (.ingredients | map({key: .name, value: .id}) | from_entries) as $ingredientIds
| def put: {TableName: $table, Item: (. + $versioned), ConditionExpression: "attribute_not_exists(PK)"};
[
  (.ingredients[] | {
    PK: ("CATALOGUE" | s), SK: ("INGREDIENT#" + .id | s), type: ("ingredient" | s),
    id: (.id | s), name: (.name | s), unit: (.unit | s),
    shopSection: (.shopSection | s), deleted: {BOOL: false}
  } | put),
  (.recipes[] | .name as $recipe | {
    PK: ("CATALOGUE" | s), SK: ("RECIPE#" + .id | s), type: ("recipe" | s),
    id: (.id | s), name: (.name | s), servings: (.servings | n),
    lines: {L: [.lines[] | {M: {
      ingredientId: ($ingredientIds[.ingredient]
        // error("\($recipe): no seeded ingredient \(.ingredient)") | s),
      quantity: (.quantity | n)
    }}]},
    notes: (.notes | s), deleted: {BOOL: false}
  } | put)
]
